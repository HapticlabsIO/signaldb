import { Collection, type Selector, type BaseItem } from '@signaldb/core'

interface UndoRedoable {
  forward(): void,
  backward(): void,
}

class InsertOperation<T extends BaseItem<I>, I> implements UndoRedoable {
  private item: T
  private collection: Collection<T, I>

  public constructor(item: T, collection: Collection<T, I>) {
    this.item = { ...item }
    this.collection = collection
  }

  public forward(): void {
    this.collection.insert(this.item)
  }

  public backward(): void {
    this.collection.removeOne({
      id: this.item.id,
    } as Selector<T>)
  }
}

class UpdateOperation<
  T extends BaseItem<I> = BaseItem,
  I = any,
> implements UndoRedoable {
  private before: T
  private after: T
  private collection: Collection<T, I, any>

  public constructor(before: T, after: T, collection: Collection<T, I, any>) {
    this.before = { ...before }
    this.after = { ...after }
    this.collection = collection
  }

  public forward(): void {
    this.collection.updateOne({ id: this.before.id } as Selector<T>, {
      $set: this.after,
    })
  }

  public backward(): void {
    this.collection.updateOne({ id: this.after.id } as Selector<T>, {
      $set: this.before,
    })
  }
}

class RemoveOperation<T extends BaseItem<I> = BaseItem, I = any>
  extends InsertOperation<T, I>
  implements UndoRedoable {
  public forward(): void {
    super.backward()
  }

  public backward(): void {
    super.forward()
  }
}

export class SignalDBHistory {
  private history: UndoRedoable[][] = []

  private activeGlobalBatchCount = 0
  private activeCollectionBatchCount = 0
  private currentBatch: UndoRedoable[] = []

  private globalPauseDepth = 0
  private collectionPauseDepths: Map<Collection<any, any, any>, number>
    = new Map()

  private undoneSteps = 0
  private isUndoingOrRedoing = false
  private readonly maxHistoryLength: number

  // Destruction support
  private removeStaticListeners: () => void
  private removeCollectionListeners: Map<
    Collection<any, any, any>,
    () => void
  > = new Map()

  public constructor(maxHistoryLength = 100) {
    this.maxHistoryLength = maxHistoryLength
    const startGlobalBatchListener = this.startGlobalBatch.bind(this)
    const endGlobalBatchListener = this.endGlobalBatch.bind(this)
    Collection.staticEvents.on('static.batch.start', startGlobalBatchListener)
    Collection.staticEvents.on('static.batch.end', endGlobalBatchListener)
    this.removeStaticListeners = () => {
      Collection.staticEvents.off(
        'static.batch.start',
        startGlobalBatchListener,
      )
      Collection.staticEvents.off('static.batch.end', endGlobalBatchListener)
    }
  }

  public doPaused<T>(fn: () => T): T {
    this.pauseAll()
    try {
      return fn()
    } finally {
      this.resumeAll()
    }
  }

  public async doPausedAsync<T>(fn: () => Promise<T>): Promise<T> {
    this.pauseAll()
    try {
      return await fn()
    } finally {
      this.resumeAll()
    }
  }

  public doWithPausedCollection<TItem extends BaseItem<TId>, TId, T>(
    collection: Collection<TItem, TId, any>,
    fn: () => T,
  ): T {
    const hasBeenPaused = this.pauseCollection(collection)

    try {
      return fn()
    } finally {
      if (hasBeenPaused) {
        this.resumeCollection(collection)
      }
    }
  }

  public async doWithPausedCollectionAsync<TItem extends BaseItem<TId>, TId, T>(
    collection: Collection<TItem, TId, any>,
    fn: () => Promise<T>,
  ): Promise<T> {
    const hasBeenPaused = this.pauseCollection(collection)

    try {
      return await fn()
    } finally {
      if (hasBeenPaused) {
        this.resumeCollection(collection)
      }
    }
  }

  public pauseAll(): void {
    this.globalPauseDepth++
  }

  public resumeAll(): void {
    if (this.globalPauseDepth === 0) {
      // eslint-disable-next-line no-console
      console.error('Cannot resume all, not currently paused.')
      return
    }
    this.globalPauseDepth--
  }

  public pauseCollection<TItem extends BaseItem<TId>, TId>(
    collection: Collection<TItem, TId, any>,
  ): boolean {
    const currentDepth = this.collectionPauseDepths.get(collection)
    if (currentDepth === undefined) {
      // eslint-disable-next-line no-console
      console.error('Collection is not added to the history manager.')
      return false
    }
    this.collectionPauseDepths.set(collection, currentDepth + 1)
    return true
  }

  public resumeCollection<TItem extends BaseItem<TId>, TId>(
    collection: Collection<TItem, TId, any>,
  ): boolean {
    const currentDepth = this.collectionPauseDepths.get(collection)
    if (currentDepth === undefined) {
      // eslint-disable-next-line no-console
      console.error('Collection is not added to the history manager.')
      return false
    }
    if (currentDepth === 0) {
      // eslint-disable-next-line no-console
      console.error('Cannot resume collection, not currently paused.')
      return false
    }
    this.collectionPauseDepths.set(collection, currentDepth - 1)
    return true
  }

  public destroy(): void {
    for (const removeCollectionListener of this.removeCollectionListeners.values()) {
      removeCollectionListener()
    }
    this.removeCollectionListeners.clear()
    this.removeStaticListeners()
  }

  public addCollection<TItem extends BaseItem<TId>, TId>(
    collection: Collection<TItem, TId, any>,
  ): void {
    if (this.removeCollectionListeners.has(collection)) {
      // eslint-disable-next-line no-console
      console.error(
        'Collection is already added to the history manager.',
        collection,
      )
      return
    }

    const addedListener = (item: TItem) => {
      // Ignore events while paused
      if (
        this.globalPauseDepth !== 0
        || this.collectionPauseDepths.get(collection) !== 0
      ) {
        return
      }
      this.pushToBatch(new InsertOperation(item, collection))
    }
    const changedListener = (newItem: TItem, change: any, oldItem: TItem) => {
      // Ignore events while paused
      if (
        this.globalPauseDepth !== 0
        || this.collectionPauseDepths.get(collection) !== 0
      ) {
        return
      }
      this.pushToBatch(new UpdateOperation(oldItem, newItem, collection))
    }
    const removedListener = (item: TItem) => {
      // Ignore events while paused
      if (
        this.globalPauseDepth !== 0
        || this.collectionPauseDepths.get(collection) !== 0
      ) {
        return
      }
      this.pushToBatch(new RemoveOperation(item, collection))
    }
    const batchStartListener = this.startCollectionBatch.bind(this)
    const batchEndListener = this.endCollectionBatch.bind(this)

    collection.on('added', addedListener)
    collection.on('changed', changedListener)
    collection.on('removed', removedListener)
    collection.on('batch.start', batchStartListener)
    collection.on('batch.end', batchEndListener)

    this.removeCollectionListeners.set(collection, () => {
      collection.off('added', addedListener)
      collection.off('changed', changedListener)
      collection.off('removed', removedListener)
      collection.off('batch.start', batchStartListener)
      collection.off('batch.end', batchEndListener)
    })
    this.collectionPauseDepths.set(collection, 0)
  }

  public removeCollection<TItem extends BaseItem<TId>, TId>(
    collection: Collection<TItem, TId, any>,
  ): void {
    const removeListeners = this.removeCollectionListeners.get(collection)
    if (removeListeners) {
      removeListeners()
    }
    this.removeCollectionListeners.delete(collection)
    this.collectionPauseDepths.delete(collection)
  }

  private startGlobalBatch(): void {
    this.activeGlobalBatchCount++
  }

  private endGlobalBatch(): void {
    if (this.activeGlobalBatchCount <= 0) {
      throw new Error(
        'Cannot end global batch while none is  open.',
      )
    }
    this.activeGlobalBatchCount--
    if (this.activeGlobalBatchCount === 0 && this.activeCollectionBatchCount === 0) {
      this.commitBatch()
    }
  }

  private startCollectionBatch(): void {
    this.activeCollectionBatchCount++
  }

  private endCollectionBatch(): void {
    if (this.activeCollectionBatchCount <= 0) {
      throw new Error('Cannot end a collection batch while none is open.')
    }
    this.activeCollectionBatchCount--
    if (!this.activeGlobalBatchCount && this.activeCollectionBatchCount === 0) {
      this.commitBatch()
    }
  }

  private commitBatch(): void {
    if (this.currentBatch.length === 0) {
      // Don't push empty batches to the history
      return
    }

    // Cut the branch before pushing
    if (this.undoneSteps > 0) {
      this.history.splice(
        this.history.length - this.undoneSteps,
        this.undoneSteps,
      )
      this.undoneSteps = 0
    }

    this.history.push(this.currentBatch)
    this.currentBatch = []

    if (this.history.length > this.maxHistoryLength) {
      this.history.shift()
    }
  }

  private pushToBatch(operation: UndoRedoable): void {
    // Don't record operations that are already in the history
    if (this.isUndoingOrRedoing) {
      return
    }

    this.currentBatch.push(operation)

    if (!this.activeGlobalBatchCount && this.activeCollectionBatchCount === 0) {
      // No batch, immediately commit
      this.commitBatch()
    }
  }

  public undo(): void {
    if (this.undoneSteps === this.history.length) {
      // Nothing to undo left
      return
    } else {
      const operation
        = this.history[this.history.length - 1 - this.undoneSteps]
      this.isUndoingOrRedoing = true
      try {
        Collection.batch(() => {
          for (let i = operation.length - 1; i >= 0; i--) {
            operation[i].backward()
          }
        })
        this.undoneSteps++
      } finally {
        this.isUndoingOrRedoing = false
      }
    }
  }

  public redo(): void {
    if (this.undoneSteps === 0) {
      // Nothing to redo left
      return
    } else {
      const operation = this.history[this.history.length - this.undoneSteps]
      this.isUndoingOrRedoing = true
      try {
        Collection.batch(() => {
          operation.forEach(op => op.forward())
        })
        this.undoneSteps--
      } finally {
        this.isUndoingOrRedoing = false
      }
    }
  }
}
