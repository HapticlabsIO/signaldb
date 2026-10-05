import { describe, it, expect } from 'vitest'
import match, { createMatcher } from './match'

describe('match', () => {
  it('should match an item that satisfies the selector', () => {
    const item = { name: 'John', age: 30, hobbies: ['reading', 'gaming'] }
    const selector = { name: 'John' }
    expect(match(item, selector)).toBe(true)
  })

  it('should not match an item that does not satisfy the selector', () => {
    const item = { name: 'John', age: 30 }
    const selector = { name: 'Jane' }
    expect(match(item, selector)).toBe(false)
  })

  it('should match using comparison operators', () => {
    const item = { age: 30 }
    expect(match(item, { age: { $gt: 20 } })).toBe(true)
    expect(match(item, { age: { $lt: 40 } })).toBe(true)
    expect(match(item, { age: { $gte: 30 } })).toBe(true)
    expect(match(item, { age: { $lte: 30 } })).toBe(true)
    expect(match(item, { age: { $ne: 25 } })).toBe(true)
  })

  it('should match with logical operators', () => {
    const item = { name: 'John', age: 30 }
    expect(match(item, { $and: [{ name: 'John' }, { age: 30 }] })).toBe(true)
    expect(match(item, { $or: [{ name: 'Jane' }, { age: 30 }] })).toBe(true)
    expect(match(item, { $nor: [{ name: 'Jane' }, { age: 40 }] })).toBe(true)
  })

  it('should match with array operators', () => {
    const item = { hobbies: ['reading', 'gaming', 'hiking'] }
    expect(match(item, { hobbies: { $in: ['gaming'] } })).toBe(true)
    expect(match(item, { hobbies: { $nin: ['swimming'] } })).toBe(true)
    expect(match(item, { hobbies: { $all: ['reading', 'gaming'] } })).toBe(true)
    expect(match(item, { hobbies: { $size: 3 } })).toBe(true)
  })

  it('should handle $exists operator', () => {
    expect(match({ name: 'John' }, { name: { $exists: true } })).toBe(true)
    expect(match({} as { name?: string }, { name: { $exists: false } })).toBe(true)
    expect(match({ name: undefined }, { name: { $exists: false } })).toBe(true)
    expect(match({ name: null }, { name: { $exists: false } })).toBe(false)
  })

  it('should handle null and undefined values', () => {
    expect(match({ name: null }, { name: null })).toBe(true)
    expect(match({ name: undefined }, { name: undefined })).toBe(true)
    expect(match({ name: null }, { name: { $ne: null } })).toBe(false)
    expect(match({ name: null }, { name: { $ne: undefined } })).toBe(false)
    expect(match({ name: undefined }, { name: { $ne: undefined } })).toBe(false)
    expect(match({ name: undefined as null | undefined }, { name: { $ne: null } })).toBe(false)
    expect(match({ name: undefined as null | undefined }, { name: null })).toBe(true)
  })
})

describe('createMatcher', () => {
  it('should test every item against the selector', () => {
    const matchesAdults = createMatcher<{ age: number }>({ age: { $gte: 18 } })

    expect([{ age: 17 }, { age: 18 }, { age: 40 }].map(item => matchesAdults(item)))
      .toEqual([false, true, true])
  })

  it('should give the same answers as match', () => {
    const selector = { $or: [{ name: 'John' }, { age: { $lt: 20 } }] }
    const matchesSelector = createMatcher<{ name: string, age: number }>(selector)

    for (const item of [{ name: 'John', age: 30 }, { name: 'Jane', age: 30 }, { name: 'Jane', age: 10 }]) {
      expect(matchesSelector(item)).toBe(match(item, selector))
    }
  })

  it('should not compile the selector before an item is tested', () => {
    // mingo refuses an unknown operator when it compiles the selector
    // @ts-expect-error - the selector uses an operator that does not exist
    const matches = createMatcher<{ age: number }>({ age: { $unknownOperator: 1 } })

    expect(matches).toBeTypeOf('function')
    expect(() => matches({ age: 1 })).toThrowError('unknown query operator $unknownOperator')
  })
})
