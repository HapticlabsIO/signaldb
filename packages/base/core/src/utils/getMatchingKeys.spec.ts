import { describe, it, expect } from 'vitest'
import getMatchingKeys from './getMatchingKeys'

describe('getMatchingKeys', () => {
  it('should return null if the selector field is an instance of RegExp', () => {
    const field = 'name'
    const selector = { name: /John/ }

    const result = getMatchingKeys(field, selector)

    expect(result.include).toBeNull()
    expect(result.exclude).toBeNull()
  })

  it('should return null if the selector field is null or undefined', () => {
    const field = 'name'
    const selector1 = { name: null }
    const selector2 = { name: undefined }

    const result1 = getMatchingKeys(field, selector1)
    const result2 = getMatchingKeys(field, selector2)

    expect(result1.include).toBeNull()
    expect(result1.exclude).toBeNull()
    expect(result2.include).toBeNull()
    expect(result2.exclude).toBeNull()
  })

  it('should return an array of matching keys if the selector field is a single value', () => {
    const field = 'name'
    const selector = { name: 'John' }

    const result = getMatchingKeys(field, selector)

    expect(result.include).toEqual(['John'])
    expect(result.exclude).toBeNull()
  })

  it('should return an array of matching keys if the selector field is an $in expression', () => {
    const field = 'name'
    const selector = { name: { $in: ['John', 'Jane'] } }

    const result = getMatchingKeys(field, selector)

    expect(result.include).toEqual(['John', 'Jane'])
    expect(result.exclude).toBeNull()
  })

  it('should return no matching keys if the selector field is an empty $in expression', () => {
    const result = getMatchingKeys('name', { name: { $in: [] } })

    expect(result.include).toEqual([])
    expect(result.exclude).toBeNull()
  })

  it('should return an array of matching keys if the selector field is a single negated value', () => {
    const field = 'name'
    const selector = { name: { $ne: 'John' } }

    const result = getMatchingKeys(field, selector)

    expect(result.include).toBeNull()
    expect(result.exclude).toEqual(['John'])
  })

  it('should return an array of non-matching keys if the selector field is an $nin expression', () => {
    const field = 'name'
    const selector = { name: { $nin: ['John', 'Jane'] } }

    const result = getMatchingKeys(field, selector)

    expect(result.include).toBeNull()
    expect(result.exclude).toEqual(['John', 'Jane'])
  })

  it('should not optimize an empty $nin expression', () => {
    const result = getMatchingKeys('name', { name: { $nin: [] } })

    expect(result.include).toBeNull()
    expect(result.exclude).toBeNull()
  })

  it('should report the keys of a value or of a single operator as exact', () => {
    expect(getMatchingKeys('name', { name: 'John' }).isExact).toBe(true)
    expect(getMatchingKeys('name', { name: { $in: ['John'] } }).isExact).toBe(true)
    expect(getMatchingKeys('name', { name: { $in: [] } }).isExact).toBe(true)
    expect(getMatchingKeys('name', { name: { $ne: 'John' } }).isExact).toBe(true)
    expect(getMatchingKeys('name', { name: { $nin: ['John'] } }).isExact).toBe(true)
  })

  it('should not report the keys as exact if the field has more operators', () => {
    const age = { $in: [1, 2], $gt: 1 }
    expect(getMatchingKeys('age', { age })).toEqual({ include: ['1', '2'], exclude: null, isExact: false })
    expect(getMatchingKeys('age', { age: { $nin: [3], $gt: 5 } }))
      .toEqual({ include: null, exclude: ['3'], isExact: false })
    expect(getMatchingKeys('age', { age: { $ne: 3, $in: [3, 6] } }))
      .toEqual({ include: null, exclude: ['3'], isExact: false })
    expect(getMatchingKeys('age', { age: { $ne: null, $in: [1] } }))
      .toEqual({ include: ['1'], exclude: null, isExact: false })
  })
})
