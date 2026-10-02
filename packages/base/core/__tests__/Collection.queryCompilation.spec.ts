import { describe, it, expect, vi, beforeEach } from 'vitest'
import type * as MingoModule from 'mingo'
import { Collection, createIndex } from '../src'

const compiled = vi.hoisted(() => ({ selectors: 0 }))

// Counts how often a selector is compiled
vi.mock('mingo', async (importOriginal) => {
  const mingo = await importOriginal<typeof MingoModule>()
  class CountingQuery extends mingo.Query {
    constructor(...parameters: ConstructorParameters<typeof mingo.Query>) {
      super(...parameters)
      compiled.selectors += 1
    }
  }
  return { ...mingo, Query: CountingQuery }
})

type Person = { id: string, name: string, age: number }

describe('Collection query compilation', () => {
  let collection: Collection<Person>

  beforeEach(() => {
    collection = new Collection<Person>()
    collection.insertMany(Array.from({ length: 100 }, (_, index) => ({
      id: `id-${index}`,
      name: index % 2 === 0 ? 'John' : 'Jane',
      age: index,
    })))
    compiled.selectors = 0
  })

  it('should compile the selector once for all items it is tested against', () => {
    expect(collection.find({ name: 'John' }).fetch()).toHaveLength(50)

    expect(compiled.selectors).toBe(1)
  })

  it('should compile the selector once to find one item', () => {
    expect(collection.findOne({ age: 99 })).toEqual({ id: 'id-99', name: 'Jane', age: 99 })

    expect(compiled.selectors).toBe(1)
  })

  it('should compile the selector once to update one item', () => {
    expect(collection.updateOne({ age: 99 }, { $set: { name: 'Jerry' } })).toBe(1)

    expect(compiled.selectors).toBe(1)
  })

  it('should compile the selector once to remove many items', () => {
    expect(collection.removeMany({ name: 'John' })).toBe(50)

    expect(compiled.selectors).toBe(1)
  })

  it('should not compile the selector for a collection without items', () => {
    const empty = new Collection<Person>()
    compiled.selectors = 0

    expect(empty.find({ name: 'John' }).fetch()).toEqual([])

    expect(compiled.selectors).toBe(0)
  })

  it('should not compile a selector that an index answers completely', () => {
    const indexed = new Collection<Person>({ indices: [createIndex('name')] })
    indexed.insertMany([{ name: 'John', age: 1 }, { name: 'Jane', age: 2 }])
    compiled.selectors = 0

    expect(indexed.find({ name: 'John' }).fetch()).toHaveLength(1)

    expect(compiled.selectors).toBe(0)
  })
})
