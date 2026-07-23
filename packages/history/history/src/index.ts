import {
  Collection,
  type Selector,
  type BaseItem,
  isEqual,
} from '@signaldb/core'

interface UndoRedoable {
  forward(): void,
  backward(): void,
}

class InsertOperation<T extends BaseItem<I>, I> implements UndoRedoable {
  private item: T

  public constructor(
    item: T,
    private collection: Collection<T, I>,
    private overrides: () => Partial<T> = () => ({}),
  ) {
    this.item = { ...item }
  }

  public forward(): void {
    this.collection.insert({ ...this.item, ...this.overrides() })
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

  public constructor(
    before: T,
    after: T,
    private collection: Collection<T, I, any>,
    private overrides: () => Partial<T> = () => ({}),
  ) {
    this.before = { ...before }
    this.after = { ...after }
  }

  public forward(): void {
    this.collection.updateOne({ id: this.before.id } as Selector<T>, {
      $set: { ...this.after, ...this.overrides() },
    })
  }

  public backward(): void {
    this.collection.updateOne({ id: this.after.id } as Selector<T>, {
      $set: { ...this.before, ...this.overrides() },
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

export class BatchUpdate<T extends { id: unknown }> {
  private batchedColumns: Set<keyof T>
  private state?: {
    before: T,
    after: T,
    collection: Collection<T, T['id'], any>,
  } = undefined

  private push: (operation: UndoRedoable) => void
  private unregisterSelf: () => void

  public constructor(
    columns: (keyof T)[],
    push: (operation: UndoRedoable) => void,
    unregisterSelf: () => void,
    private overrides: () => Partial<T> = () => ({}),
  ) {
    this.batchedColumns = new Set(columns)
    this.push = push
    this.unregisterSelf = unregisterSelf
  }

  public update(before: T, after: T, collection: Collection<T, T['id']>): void {
    let currentState = this.state
    if (!currentState) {
      currentState = {
        before: { ...before },
        after: { ...before },
        collection,
      }
      this.state = currentState
    }

    // Update the before state
    const updatedBefore = { ...after }
    // Preserve the batched columns from the original before state
    this.batchedColumns.forEach((column) => {
      updatedBefore[column] = currentState.before[column]
    })

    // Update the current state
    currentState.before = { ...updatedBefore }
    currentState.after = { ...updatedBefore }

    // Update the batched columns in the after state
    this.batchedColumns.forEach((column) => {
      currentState.after[column] = after[column]
    })

    // Filter out the changes to the batched columns for the operation
    const afterWithoutBatched = { ...after }
    const beforeWithoutBatched = { ...before }
    this.batchedColumns.forEach((column) => {
      beforeWithoutBatched[column] = currentState.before[column]
      afterWithoutBatched[column] = currentState.before[column]
    })

    if (isEqual(beforeWithoutBatched, afterWithoutBatched)) {
      // No changes outside of the batched columns, don't push an operation
      return
    }

    this.push(new UpdateOperation(
      beforeWithoutBatched,
      afterWithoutBatched,
      collection,
      this.overrides,
    ))
  }

  public commitAndUnregister(): void {
    if (this.state) {
      this.push(
        new UpdateOperation(
          this.state.before,
          this.state.after,
          this.state.collection,
          this.overrides,
        ),
      )
    }
    this.unregisterSelf()
  }
}

class HistoryRegisteredCollection<TItem extends { id: unknown }> {
  protected pauseDepth: number = 0
  protected removeListeners: () => void
  protected batchUpdateMap: Map<TItem['id'], BatchUpdate<TItem>> = new Map()

  public constructor(
    protected readonly collection: Collection<TItem, TItem['id']>,
    protected readonly history: {
      startCollectionBatch(): void,
      endCollectionBatch(): void,
      pushToBatch(operation: UndoRedoable): void,
    },
    protected readonly overrides: () => Partial<TItem> = () => ({}),
  ) {
    const addedListener = this.onAdded.bind(this)
    const changedListener = this.onChanged.bind(this)
    const removedListener = this.onRemoved.bind(this)
    const batchStartListener = this.history.startCollectionBatch.bind(
      this.history,
    )
    const batchEndListener = this.history.endCollectionBatch.bind(this.history)

    collection.on('added', addedListener)
    collection.on('changed', changedListener)
    collection.on('removed', removedListener)
    collection.on('batch.start', batchStartListener)
    collection.on('batch.end', batchEndListener)

    this.removeListeners = () => {
      collection.off('added', addedListener)
      collection.off('changed', changedListener)
      collection.off('removed', removedListener)
      collection.off('batch.start', batchStartListener)
      collection.off('batch.end', batchEndListener)
    }
  }

  public destructor() {
    this.removeListeners()
  }

  public pause(): () => void {
    this.pauseDepth++
    return () => {
      this.pauseDepth--
    }
  }

  public doPaused<T>(fn: () => T): T {
    const unPause = this.pause()

    try {
      return fn()
    } finally {
      unPause()
    }
  }

  public async doPausedAsync<T>(fn: () => Promise<T>): Promise<T> {
    const unPause = this.pause()

    try {
      return await fn()
    } finally {
      unPause()
    }
  }

  protected onAdded(item: TItem): void {
    // Ignore events while paused
    if (this.pauseDepth !== 0) {
      return
    }
    this.history.pushToBatch(new InsertOperation(item, this.collection, this.overrides))
  }

  protected onChanged(newItem: TItem, change: any, oldItem: TItem): void {
    // Ignore events while paused
    if (this.pauseDepth !== 0) {
      return
    }
    const batch = this.batchUpdateMap.get(newItem.id)
    if (batch) {
      batch.update(oldItem, newItem, this.collection)
      return
    }

    this.history.pushToBatch(
      new UpdateOperation(oldItem, newItem, this.collection, this.overrides),
    )
  }

  protected onRemoved(item: TItem): void {
    // Ignore events while paused
    if (this.pauseDepth !== 0) {
      return
    }
    this.history.pushToBatch(new RemoveOperation(item, this.collection, this.overrides))
  }

  public startBatch(
    id: TItem['id'],
    columns: (keyof TItem)[],
  ): BatchUpdate<TItem> {
    const existingBatch = this.batchUpdateMap.get(id)
    if (existingBatch) {
      // eslint-disable-next-line no-console
      console.error('Batch for item is already started.')
      return existingBatch
    }

    const batch = new BatchUpdate(
      columns,
      this.history.pushToBatch.bind(this.history),
      () => this.batchUpdateMap.delete(id),
      this.overrides,
    )

    this.batchUpdateMap.set(id, batch)
    return batch
  }
}

export class SignalDBHistory {
  private history: UndoRedoable[][] = []

  private activeGlobalBatchCount = 0
  private activeCollectionBatchCount = 0
  private currentBatch: UndoRedoable[] = []

  private globalPauseDepth = 0

  private undoneSteps = 0
  private isUndoingOrRedoing = false
  private readonly maxHistoryLength: number

  // Destruction support
  private removeStaticListeners: () => void

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

  public destroy(): void {
    this.removeStaticListeners()
  }

  public addCollection<TItem extends { id: unknown }>(
    collection: Collection<TItem, TItem['id']>,
    overrides: () => Partial<TItem> = () => ({}),
  ): HistoryRegisteredCollection<TItem> {
    return new HistoryRegisteredCollection(collection, {
      startCollectionBatch: this.startCollectionBatch.bind(this),
      endCollectionBatch: this.endCollectionBatch.bind(this),
      pushToBatch: this.pushToBatch.bind(this),
    }, overrides)
  }

  private startGlobalBatch(): void {
    this.activeGlobalBatchCount++
  }

  private endGlobalBatch(): void {
    if (this.activeGlobalBatchCount <= 0) {
      throw new Error('Cannot end global batch while none is  open.')
    }
    this.activeGlobalBatchCount--
    if (
      this.activeGlobalBatchCount === 0
      && this.activeCollectionBatchCount === 0
    ) {
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

    // Don't record operations while paused
    if (this.globalPauseDepth !== 0) {
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
