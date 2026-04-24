import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Collection, type BaseItem } from '@signaldb/core'
import { SignalDBHistory } from '../src/index'

interface TestItem extends BaseItem<number> {
  id: number,
  value: string,
  status?: string,
  count?: number,
}

/**
 * Sets up a collection for the test
 * @returns the collection
 */
function createCollection() {
  const collection = new Collection<TestItem, number>()
  return collection
}

/**
 * Registers a collection with the history manager for the test.
 * @param history The history instance under test.
 * @param collection The collection to register.
 * @returns The registered collection wrapper.
 */
function registerCollection(
  history: SignalDBHistory,
  collection: Collection<TestItem, number>,
) {
  return history.addCollection(collection)
}

describe('SignalDBHistory', () => {
  let history: SignalDBHistory
  let collection: Collection<TestItem, number>
  let registeredCollection: ReturnType<typeof registerCollection>
  let item: TestItem

  beforeEach(() => {
    history = new SignalDBHistory(10)
    collection = createCollection()
    registeredCollection = registerCollection(history, collection)
    item = { id: 1, value: 'a' }
  })

  it('should record insert operation and undo/redo', () => {
    collection.insert(item)
    expect(collection.findOne({ id: 1 })?.value).toBe('a')
    history.undo()
    expect(collection.findOne({ id: 1 })).toBeUndefined()
    history.redo()
    expect(collection.findOne({ id: 1 })?.value).toBe('a')
  })

  it('should record update operation and undo/redo', () => {
    collection.insert(item)
    collection.updateOne({ id: 1 }, { $set: { value: 'b' } })
    expect(collection.findOne({ id: 1 })?.value).toBe('b')
    history.undo()
    expect(collection.findOne({ id: 1 })?.value).toBe('a')
    history.redo()
    expect(collection.findOne({ id: 1 })?.value).toBe('b')
  })

  it('should record remove operation and undo/redo', () => {
    collection.insert(item)
    collection.removeOne({ id: 1 })
    expect(collection.findOne({ id: 1 })).toBeUndefined()
    history.undo()
    expect(collection.findOne({ id: 1 })?.value).toBe('a')
    history.redo()
    expect(collection.findOne({ id: 1 })).toBeUndefined()
  })

  it('should handle batch operations', () => {
    Collection.batch(() => {
      collection.insert({ id: 2, value: 'x' })
      collection.insert({ id: 3, value: 'y' })
    })
    expect(collection.findOne({ id: 2 })?.value).toBe('x')
    expect(collection.findOne({ id: 3 })?.value).toBe('y')
    history.undo()
    expect(collection.findOne({ id: 2 })).toBeUndefined()
    expect(collection.findOne({ id: 3 })).toBeUndefined()
    history.redo()
    expect(collection.findOne({ id: 2 })?.value).toBe('x')
    expect(collection.findOne({ id: 3 })?.value).toBe('y')
  })

  it('should not exceed max history length', () => {
    for (let i = 0; i < 12; i++) {
      collection.insert({ id: i, value: `${i}` })
    }
    expect(history['history'].length).toBeLessThanOrEqual(10)
  })

  it('should cut branch when operating after undo', () => {
    collection.insert(item)
    // Insert should be added to history
    expect(history['history'].length).toBe(1)
    history.undo()
    // Undoing should not affect history, only position in history
    expect(history['history'].length).toBe(1)
    // Creating new operation after undo should cut the branch and add to history
    collection.insert({ id: 2, value: 'b' })
    expect(history['history'].length).toBe(1)
  })

  it('should destroy global listeners', () => {
    const offSpy = vi.spyOn(Collection.staticEvents, 'off')

    history.destroy()

    expect(offSpy).toHaveBeenCalled()
  })

  it('should destroy collection listeners through the registered collection', () => {
    const offSpy = vi.spyOn(collection, 'off')

    registeredCollection.destructor()

    expect(offSpy).toHaveBeenCalled()
  })

  it('should handle multiple undos/redos', () => {
    collection.insert({ id: 1, value: 'a' })
    collection.insert({ id: 2, value: 'b' })
    collection.insert({ id: 3, value: 'c' })
    history.undo()
    history.undo()
    expect(collection.findOne({ id: 3 })).toBeUndefined()
    expect(collection.findOne({ id: 2 })).toBeUndefined()
    expect(collection.findOne({ id: 1 })?.value).toBe('a')
    history.redo()
    expect(collection.findOne({ id: 2 })?.value).toBe('b')
    history.redo()
    expect(collection.findOne({ id: 3 })?.value).toBe('c')
  })

  it('should not undo if nothing left', () => {
    collection.insert(item)
    history.undo()
    history.undo()
    expect(collection.findOne({ id: 1 })).toBeUndefined()
  })

  it('should not redo if nothing left', () => {
    collection.insert(item)
    history.undo()
    history.redo()
    history.redo()
    expect(collection.findOne({ id: 1 })?.value).toBe('a')
  })

  it('should execute doPaused and not record history', () => {
    collection.insert(item)
    history.doPaused(() => {
      collection.insert({ id: 2, value: 'b' })
      collection.updateOne({ id: 1 }, { $set: { value: 'z' } })
      collection.removeOne({ id: 2 })
    })
    // History should only have the initial insert
    expect(history['history'].length).toBe(1)
    expect(collection.findOne({ id: 1 })?.value).toBe('z')
    expect(collection.findOne({ id: 2 })).toBeUndefined()
    history.undo()
    expect(collection.findOne({ id: 1 })).toBeUndefined()
  })

  it('should execute doPausedAsync and not record history', async () => {
    collection.insert(item)
    await history.doPausedAsync(async () => {
      collection.insert({ id: 2, value: 'b' })
      await new Promise(resolve => setTimeout(resolve, 10))
      collection.updateOne({ id: 1 }, { $set: { value: 'y' } })
      collection.removeOne({ id: 2 })
    })
    // History should only have the initial insert
    expect(history['history'].length).toBe(1)
    expect(collection.findOne({ id: 1 })?.value).toBe('y')
    expect(collection.findOne({ id: 2 })).toBeUndefined()
    history.undo()
    expect(collection.findOne({ id: 1 })).toBeUndefined()
  })

  it('should execute doPaused on a registered collection and only pause the target collection', () => {
    const secondCollection = createCollection()
    registerCollection(history, secondCollection)

    collection.insert(item)
    secondCollection.insert({ id: 2, value: 'b' })

    registeredCollection.doPaused(() => {
      collection.insert({ id: 3, value: 'c' })
      collection.updateOne({ id: 1 }, { $set: { value: 'z' } })
      secondCollection.insert({ id: 4, value: 'd' })
    })

    expect(history['history'].length).toBe(3)
    expect(collection.findOne({ id: 1 })?.value).toBe('z')
    expect(collection.findOne({ id: 3 })?.value).toBe('c')
    expect(secondCollection.findOne({ id: 4 })?.value).toBe('d')

    history.undo()
    expect(secondCollection.findOne({ id: 4 })).toBeUndefined()
    expect(collection.findOne({ id: 1 })?.value).toBe('z')
    expect(collection.findOne({ id: 3 })?.value).toBe('c')
  })

  it('should execute doPausedAsync on a registered collection and only pause the target collection', async () => {
    const secondCollection = createCollection()
    registerCollection(history, secondCollection)

    collection.insert(item)
    secondCollection.insert({ id: 2, value: 'b' })

    await registeredCollection.doPausedAsync(async () => {
      collection.insert({ id: 3, value: 'c' })
      await new Promise(resolve => setTimeout(resolve, 10))
      collection.updateOne({ id: 1 }, { $set: { value: 'y' } })
      secondCollection.insert({ id: 4, value: 'd' })
    })

    expect(history['history'].length).toBe(3)
    expect(collection.findOne({ id: 1 })?.value).toBe('y')
    expect(collection.findOne({ id: 3 })?.value).toBe('c')
    expect(secondCollection.findOne({ id: 4 })?.value).toBe('d')

    history.undo()
    expect(secondCollection.findOne({ id: 4 })).toBeUndefined()
    expect(collection.findOne({ id: 1 })?.value).toBe('y')
    expect(collection.findOne({ id: 3 })?.value).toBe('c')
  })

  it('should record history for a collection again after registered doPaused is finished', () => {
    collection.insert(item)

    registeredCollection.doPaused(() => {
      collection.insert({ id: 2, value: 'b' })
    })

    collection.insert({ id: 3, value: 'c' })

    expect(history['history'].length).toBe(2)
    history.undo()
    expect(collection.findOne({ id: 3 })).toBeUndefined()
    expect(collection.findOne({ id: 2 })?.value).toBe('b')
  })

  it('should record history for a collection again after registered doPausedAsync is finished', async () => {
    collection.insert(item)

    await registeredCollection.doPausedAsync(async () => {
      collection.insert({ id: 2, value: 'b' })
      await new Promise(resolve => setTimeout(resolve, 5))
    })

    collection.insert({ id: 3, value: 'c' })

    expect(history['history'].length).toBe(2)
    history.undo()
    expect(collection.findOne({ id: 3 })).toBeUndefined()
    expect(collection.findOne({ id: 2 })?.value).toBe('b')
  })

  it('should defer history commits for batched columns until the batch is committed', () => {
    collection.insert({ id: 1, value: 'a', status: 'draft' })

    const batch = registeredCollection.startBatch(1, ['value'])

    collection.updateOne({ id: 1 }, { $set: { value: 'b' } })
    collection.updateOne({ id: 1 }, { $set: { value: 'c' } })

    expect(history['history'].length).toBe(1)
    expect(collection.findOne({ id: 1 })?.value).toBe('c')

    batch.commitAndUnregister()

    expect(history['history'].length).toBe(2)
    history.undo()
    expect(collection.findOne({ id: 1 })?.value).toBe('a')
    history.redo()
    expect(collection.findOne({ id: 1 })?.value).toBe('c')
  })

  it('should keep non-batched column changes separate from the batched update', () => {
    collection.insert({ id: 1, value: 'a', status: 'draft', count: 0 })

    const batch = registeredCollection.startBatch(1, ['value'])

    collection.updateOne({ id: 1 }, { $set: { value: 'b' } })
    collection.updateOne({ id: 1 }, { $set: { status: 'published' } })
    collection.updateOne({ id: 1 }, { $set: { value: 'c' } })

    batch.commitAndUnregister()

    expect(history['history'].length).toBe(3)
    expect(collection.findOne({ id: 1 })).toMatchObject({
      value: 'c',
      status: 'published',
    })

    history.undo()
    expect(collection.findOne({ id: 1 })).toMatchObject({
      value: 'a',
      status: 'published',
    })

    history.undo()
    expect(collection.findOne({ id: 1 })).toMatchObject({
      value: 'a',
      status: 'draft',
    })
  })

  it('should record history after doPaused is finished', () => {
    collection.insert(item)
    history.doPaused(() => {
      collection.insert({ id: 2, value: 'b' })
    })
    collection.insert({ id: 3, value: 'c' })
    expect(history['history'].length).toBe(2)
    history.undo()
    expect(collection.findOne({ id: 3 })).toBeUndefined()
    expect(collection.findOne({ id: 1 })?.value).toBe('a')
  })

  it('should record history after doPausedAsync is finished', async () => {
    collection.insert(item)
    await history.doPausedAsync(async () => {
      collection.insert({ id: 2, value: 'b' })
      await new Promise(resolve => setTimeout(resolve, 5))
    })
    collection.insert({ id: 4, value: 'd' })
    expect(history['history'].length).toBe(2)
    history.undo()
    expect(collection.findOne({ id: 4 })).toBeUndefined()
    expect(collection.findOne({ id: 1 })?.value).toBe('a')
  })
})
