import { describe, it, expect, vi } from 'vitest'
import { Collection, createIndex, createIndexProvider } from '../src'

type Person = { id: string, name: string, age: number }

describe('Collection indices with several operators on one field', () => {
  const people: Person[] = [
    { id: '1', name: 'John', age: 3 },
    { id: '2', name: 'Jane', age: 6 },
    { id: '3', name: 'Jerry', age: 9 },
    { id: '4', name: 'Jessica', age: 12 },
  ]
  const idsOf = (found: Person[]) => found.map(person => person.id).toSorted()

  it('should apply the operators of an indexed field that the index does not serve', () => {
    const col = new Collection<Person>({ indices: [createIndex('age')] })
    people.forEach(person => col.insert(person))

    expect(idsOf(col.find({ age: { $in: [3, 6, 9], $gt: 5 } }).fetch())).toEqual(['2', '3'])
    expect(idsOf(col.find({ age: { $nin: [12], $gt: 5 } }).fetch())).toEqual(['2', '3'])
    expect(idsOf(col.find({ age: { $ne: 3, $lt: 10 } }).fetch())).toEqual(['2', '3'])
    expect(idsOf(col.find({ age: { $ne: 3, $in: [3, 6] } }).fetch())).toEqual(['2'])
  })

  it('should apply the operators of an indexed field to the queries that are made inside of a batch', () => {
    const col = new Collection<Person>({ indices: [createIndex('age')] })

    col.batch(() => {
      people.forEach(person => col.insert(person))

      expect(idsOf(col.find({ age: { $in: [3, 6, 9], $gt: 5 } }).fetch())).toEqual(['2', '3'])
    })
  })

  it('should apply the operators of an indexed field within $and', () => {
    const col = new Collection<Person>({ indices: [createIndex('age')] })
    people.forEach(person => col.insert(person))

    expect(idsOf(col.find({
      $and: [{ age: { $nin: [12], $gt: 5 } }, { name: { $ne: 'Jane' } }],
    }).fetch())).toEqual(['3'])
  })

  it('should still find nothing for an empty $in next to other operators', () => {
    const col = new Collection<Person>({ indices: [createIndex('age')] })
    people.forEach(person => col.insert(person))

    expect(col.find({ age: { $in: [], $gt: 5 } }).fetch()).toEqual([])
  })
})

describe('Collection indices in a batch', () => {
  it('should consult the indices for a query made after a write in a batch', () => {
    const query = vi.fn(() => ({ matched: false as const }))
    const rebuild = vi.fn()
    const col = new Collection<Person>({
      indices: [createIndexProvider({ query, rebuild })],
    })

    col.batch(() => {
      col.insert({ id: '1', name: 'John', age: 30 })
      query.mockClear()

      col.find({ name: 'John' }).fetch()

      expect(query).toHaveBeenCalledTimes(1)
    })
  })

  it('should rebuild stale indices once for the queries that follow a write', () => {
    const rebuild = vi.fn()
    const col = new Collection<Person>({
      indices: [createIndexProvider({ query: () => ({ matched: false as const }), rebuild })],
    })

    col.batch(() => {
      col.insert({ id: '1', name: 'John', age: 30 })
      rebuild.mockClear()

      col.find({ name: 'John' }).fetch()
      col.find({ name: 'Jane' }).fetch()
      col.find({ age: 30 }).fetch()

      expect(rebuild).toHaveBeenCalledTimes(1)
    })
  })

  it('should not rebuild the indices for a write that no query follows', () => {
    const rebuild = vi.fn()
    const col = new Collection<Person>({
      indices: [createIndexProvider({ query: () => ({ matched: false as const }), rebuild })],
    })
    rebuild.mockClear()

    col.batch(() => {
      col.insert({ id: '1', name: 'John', age: 30 })
      col.insert({ id: '2', name: 'Jane', age: 25 })
      col.updateOne({ id: '1' }, { $set: { age: 31 } })

      expect(rebuild).not.toHaveBeenCalled()
    })

    // It is done once, when the batch ends
    expect(rebuild).toHaveBeenCalledTimes(1)
  })

  it('should not rebuild the indices again at the end of the batch if nothing was written since', () => {
    const rebuild = vi.fn()
    const col = new Collection<Person>({
      indices: [createIndexProvider({ query: () => ({ matched: false as const }), rebuild })],
    })

    col.batch(() => {
      col.insert({ id: '1', name: 'John', age: 30 })
      col.find({ name: 'John' }).fetch()
      rebuild.mockClear()
    })

    expect(rebuild).not.toHaveBeenCalled()
  })

  it('should answer queries after writes in a batch like a collection without indices does', () => {
    const names = ['John', 'Jane', 'Jerry', 'Jessica']
    const indexed = new Collection<Person>({ indices: [createIndex('name'), createIndex('age')] })
    const plain = new Collection<Person>()

    // A fixed sequence of pseudo random operations, so that a failure can be reproduced
    let seed = 42
    const random = (maximum: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648
      return seed % maximum
    }
    const pick = <T>(values: T[]) => values[random(values.length)]
    const ids = Array.from({ length: 30 }, (_, index) => `id-${index}`)
    const byId = (a: Person, b: Person) => a.id.localeCompare(b.id)

    const selectors = () => [
      { name: pick(names) },
      { name: { $in: [pick(names), pick(names)] } },
      { name: { $nin: [pick(names)] } },
      { age: random(5) },
      { name: pick(names), age: random(5) },
      { $or: [{ name: pick(names) }, { age: random(5) }] },
      { id: pick(ids) },
      { id: { $in: [pick(ids), pick(ids), pick(ids)] } },
      { name: { $in: [] } },
      { age: { $in: [random(5), random(5), random(5)], $gt: random(5) } },
      { age: { $nin: [random(5)], $gte: random(5) } },
      { name: { $ne: pick(names), $in: [pick(names), pick(names)] } },
    ]

    Collection.batch(() => {
      for (let step = 0; step < 300; step += 1) {
        const id = pick(ids)
        const operation = random(4)
        for (const col of [indexed, plain]) {
          const exists = col.findOne({ id }) !== undefined
          if (operation === 0 && !exists) {
            col.insert({ id, name: names[step % names.length], age: step % 5 })
          } else if (operation === 1) {
            col.updateOne({ id }, { $set: { name: names[(step + 1) % names.length] } })
          } else if (operation === 2) {
            col.removeOne({ id })
          } else if (operation === 3 && exists) {
            col.replaceOne({ id }, { name: names[(step + 2) % names.length], age: step % 5 })
          }
        }

        for (const selector of selectors()) {
          // The selector is part of what is compared, so that a failure names it
          const answerOf = (col: Collection<Person>) => ({
            selector: JSON.stringify(selector),
            found: col.find(selector).fetch().toSorted(byId),
          })
          expect(answerOf(indexed)).toEqual(answerOf(plain))
        }
      }
    })
  })
})
