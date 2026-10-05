import type { BaseItem } from '../Collection/types'
import type { FlatSelector } from '../types/Selector'
import isFieldExpression from './isFieldExpression'
import serializeValue from './serializeValue'

type KeyResult = {
  include: (string | null)[] | null,
  exclude: (string | null)[] | null,
  /**
   * Whether the keys describe the selector of the field completely. If not, the keys only narrow
   * down the items that can match, and the selector of the field has to be tested on them.
   */
  isExact: boolean,
}

/**
 * Extracts the matching and excluded keys for a given field in a selector.
 * Supports serialized values and `$in`/`$nin` field expressions for optimization.
 * Returns `null` for include/exclude if the field cannot be optimized. The keys are taken from
 * a single operator, so that they are not exact if the field has others.
 * @template T - The type of the items in the selector.
 * @template I - The type of the unique identifier for the items.
 * @param field - The name of the field to extract matching keys for.
 * @param selector - The selector object containing query criteria.
 * @returns An object containing arrays of serialized included and excluded keys,
 *   or `null` if the field cannot be optimized.
 */
export default function getMatchingKeys<
  T extends BaseItem<I> = BaseItem, I = any,
>(field: string, selector: FlatSelector<T>): KeyResult {
  const result: KeyResult = { include: null, exclude: null, isExact: false }
  const fieldSelector = (selector as Record<string, any>)[field]

  if (fieldSelector instanceof RegExp) return result
  if (fieldSelector == null) return result

  if (isFieldExpression(fieldSelector)) {
    const isExact = Object.keys(fieldSelector).length === 1

    // Handle $ne operator
    if (fieldSelector.$ne != null) {
      result.exclude = [serializeValue(fieldSelector.$ne)]
      result.isExact = isExact
      return result
    }

    // Handle $in operator. An empty list includes no key, so that no item can match.
    if (Array.isArray(fieldSelector.$in)) {
      result.include = fieldSelector.$in.map(serializeValue)
      result.isExact = isExact
      return result
    }

    // Handle $nin operator
    if (Array.isArray(fieldSelector.$nin) && fieldSelector.$nin.length > 0) {
      result.exclude = fieldSelector.$nin.map(serializeValue)
      result.isExact = isExact
      return result
    }

    // If there are other operators, we can't optimize
    return { include: null, exclude: null, isExact: false }
  }

  // Direct value match
  result.include = [serializeValue(fieldSelector)]
  result.isExact = true
  return result
}
