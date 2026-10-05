import { describe, it, expect, vi } from 'vitest'
import { Collection, createIndex, createIndexProvider } from '../src'

type Person = { id: string, name: string, age: number }

/**
 * Creates pseudo random numbers from a fixed seed, so that a failure can be reproduced.
 * @param seed the number that decides on the sequence of numbers
 * @returns functions to get a number below a maximum and to pick one of some values
 */
function createRandom(seed: number) {
  let state = seed
  const random = (maximum: number) => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648
    return state % maximum
  }
  const pick = <T>(values: T[]) => values[random(values.length)]
  return { random, pick }
}

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

  it('should apply the operators of an indexed field within $and and $or', () => {
    const col = new Collection<Person>({ indices: [createIndex('age')] })
    people.forEach(person => col.insert(person))

    expect(idsOf(col.find({
      $or: [{ age: { $in: [3, 6], $gt: 5 } }, { age: 12 }],
    }).fetch())).toEqual(['2', '4'])
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

describe('Collection indices with nested selectors', () => {
  type Place = { id: string, name: string, age: number, city: string }

  it('should answer selectors that nest $and and $or like a collection without indices does', () => {
    const names = ['John', 'Jane', 'Jerry', 'Jessica']
    const cities = ['Berlin', 'Rome', 'Paris']
    // The city is not indexed, so that some of the conditions are served by the indices only partly
    const indexed = new Collection<Place>({ indices: [createIndex('name'), createIndex('age')] })
    const plain = new Collection<Place>()
    for (let index = 0; index < 60; index += 1) {
      const place = {
        id: `id-${index}`,
        name: names[index % names.length],
        age: index % 5,
        city: cities[index % cities.length],
      }
      indexed.insert(place)
      plain.insert(place)
    }

    const { random, pick } = createRandom(7)
    const condition = () => pick([
      () => ({ name: pick(names) }),
      () => ({ age: random(5) }),
      () => ({ city: pick(cities) }),
      () => ({ name: pick(names), age: random(5) }),
      () => ({ age: random(5), city: pick(cities) }),
      () => ({ name: { $in: [pick(names), pick(names)] } }),
      () => ({ age: { $in: [random(5), random(5)], $gt: random(5) } }),
    ])()
    const selectors = () => [
      { $or: [condition(), condition()] },
      { ...condition(), $or: [condition(), condition()] },
      { $and: [condition(), { $or: [condition(), condition()] }] },
      { $or: [{ $and: [condition(), condition()] }, condition()] },
      { $and: [condition(), condition()] },
    ]
    const byId = (a: Place, b: Place) => a.id.localeCompare(b.id)

    for (let round = 0; round < 600; round += 1) {
      for (const selector of selectors()) {
        // The selector is part of what is compared, so that a failure names it
        const answerOf = (col: Collection<Place>) => ({
          selector: JSON.stringify(selector),
          found: col.find(selector).fetch().toSorted(byId),
        })
        expect(answerOf(indexed)).toEqual(answerOf(plain))
      }
    }
  })

  it('should find the items that one branch of an $or has conditions left for next to others', () => {
    const col = new Collection<Person>({ indices: [createIndex('age')] })
    col.insert({ id: '1', name: 'Jane', age: 3 })
    col.insert({ id: '2', name: 'Jane', age: 5 })
    col.insert({ id: '3', name: 'John', age: 5 })

    const found = col.find({ $or: [{ age: 3 }, { age: 5, name: 'John' }] }).fetch()

    expect(found.map(person => person.id).toSorted()).toEqual(['1', '3'])
  })

  it('should only find the items of an $or that match the rest of the selector as well', () => {
    const col = new Collection<Person>({ indices: [createIndex('age'), createIndex('name')] })
    col.insert({ id: '1', name: 'John', age: 3 })
    col.insert({ id: '2', name: 'Jane', age: 3 })
    col.insert({ id: '3', name: 'John', age: 7 })

    const found = col.find({ name: 'John', $or: [{ age: 3 }, { age: 5 }] }).fetch()

    expect(found.map(person => person.id)).toEqual(['1'])
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

    const { random, pick } = createRandom(42)
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
