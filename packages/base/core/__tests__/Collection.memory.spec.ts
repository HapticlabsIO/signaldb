import { describe, it, expect, beforeEach } from 'vitest'
import { Collection } from '../src'
import type { MemoryAdapter } from '../src'

type Person = { id: string, name: string }

/** An array that counts the calls the collection makes to search and copy it */
class ObservedMemory<T> extends Array<T> {
  public findIndexCalls = 0
  public mapCalls = 0

  // Arrays that are made from this one, such as the result of `map`, are plain arrays
  static get [Symbol.species]() {
    return Array
  }

  public override findIndex(...parameters: Parameters<Array<T>['findIndex']>) {
    this.findIndexCalls += 1
    return super.findIndex(...parameters)
  }

  public override map<U>(...parameters: Parameters<Array<T>['map']> extends [infer Callback, ...infer Rest]
    ? [Callback & ((value: T, index: number, array: T[]) => U), ...Rest]
    : never): U[] {
    this.mapCalls += 1
    return super.map(...parameters)
  }
}

/** A memory that is not an array, such as an adapter around another data structure */
class ListMemory<T> implements MemoryAdapter<T> {
  public findIndexCalls = 0
  private readonly items: T[] = []

  push(item: T) {
    this.items.push(item)
  }

  pop() {
    return this.items.pop()
  }

  splice(start: number, deleteCount?: number, ...items: T[]) {
    return this.items.splice(start, deleteCount as number, ...items)
  }

  map<U>(callbackfn: (value: T, index: number, array: T[]) => U) {
    return this.items.map(callbackfn)
  }

  find(predicate: (value: T, index: number, object: T[]) => boolean) {
    return this.items.find(predicate)
  }

  filter(predicate: (value: T, index: number, array: T[]) => unknown) {
    return this.items.filter(predicate)
  }

  findIndex(predicate: (value: T, index: number, object: T[]) => boolean) {
    this.findIndexCalls += 1
    return this.items.findIndex(predicate)
  }
}

describe('Collection memory', () => {
  let memory: ObservedMemory<Person>
  let collection: Collection<Person>

  beforeEach(() => {
    memory = new ObservedMemory<Person>()
    collection = new Collection<Person>({ memory })
    collection.insertMany(Array.from({ length: 50 }, (_, index) => ({
      id: `id-${index}`,
      name: `Person ${index}`,
    })))
  })

  describe('inserting', () => {
    it('should not search the memory for the position of the inserted item', () => {
      expect(memory).toHaveLength(50)
      expect(memory.findIndexCalls).toBe(0)
    })

    it('should find every inserted item at its position', () => {
      collection.insert({ id: 'last', name: 'Last' })

      expect(collection.findOne({ id: 'last' })).toEqual({ id: 'last', name: 'Last' })
      expect(collection.findOne({ id: 'id-0' })).toEqual({ id: 'id-0', name: 'Person 0' })
      expect(collection.findOne({ id: 'id-49' })).toEqual({ id: 'id-49', name: 'Person 49' })
    })
  })

  describe('looking items up', () => {
    it('should not copy the memory to look an item up by id', () => {
      memory.mapCalls = 0

      expect(collection.findOne({ id: 'id-10' })).toEqual({ id: 'id-10', name: 'Person 10' })

      expect(memory.mapCalls).toBe(0)
    })

    it('should not copy the memory to look items up by several ids', () => {
      memory.mapCalls = 0

      expect(collection.find({ id: { $in: ['id-1', 'id-2'] } }).fetch()).toHaveLength(2)

      expect(memory.mapCalls).toBe(0)
    })

    it('should not copy the memory to find the item to update', () => {
      // writing outside of a batch rebuilds the indices, which copies the memory
      collection.batch(() => {
        const copiesBefore = memory.mapCalls

        collection.updateOne({ id: 'id-5' }, { $set: { name: 'Changed' } })

        expect(memory.mapCalls).toBe(copiesBefore)
      })

      expect(collection.findOne({ id: 'id-5' })?.name).toBe('Changed')
    })
  })

  describe('changing every item at once', () => {
    it('should report the items as they were before an update to the listeners', () => {
      const namesBefore: string[] = []
      collection.on('changed', (_after, _modifier, before) => {
        namesBefore.push(before.name)
      })

      collection.updateMany({}, { $set: { name: 'Everyone' } })

      expect(namesBefore).toEqual(Array.from({ length: 50 }, (_, index) => `Person ${index}`))
      expect(collection.find({ name: 'Everyone' }).count()).toBe(50)
    })

    it('should remove every item with the content it had', () => {
      const removed: string[] = []
      collection.on('removed', (item) => {
        removed.push(item.name)
      })

      expect(collection.removeMany({})).toBe(50)

      expect(removed).toEqual(Array.from({ length: 50 }, (_, index) => `Person ${index}`))
      expect(memory).toHaveLength(0)
    })
  })

  describe('with a memory that is not an array', () => {
    it('should insert, find, update and remove items', () => {
      const listMemory = new ListMemory<Person>()
      const col = new Collection<Person>({ memory: listMemory })

      col.insertMany([{ id: '1', name: 'John' }, { id: '2', name: 'Jane' }, { id: '3', name: 'Jerry' }])
      col.updateOne({ id: '2' }, { $set: { name: 'Janet' } })
      col.removeOne({ id: '1' })

      expect(col.find().fetch()).toEqual([{ id: '2', name: 'Janet' }, { id: '3', name: 'Jerry' }])
      expect(col.findOne({ id: '3' })).toEqual({ id: '3', name: 'Jerry' })
    })

    it('should search the memory for the position of an inserted item', () => {
      const listMemory = new ListMemory<Person>()
      const col = new Collection<Person>({ memory: listMemory })

      col.insert({ id: '1', name: 'John' })

      expect(listMemory.findIndexCalls).toBe(1)
    })
  })
})
