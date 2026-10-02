import { Query } from 'mingo'
import type Selector from '../types/Selector'

type BaseItem = Record<string, any>

/**
 * Creates a function that tests items against a selector. The selector is compiled once, when the
 * first item is tested, and not for every item: compiling a selector costs more than testing an
 * item against it, which makes testing many items against one selector many times slower otherwise.
 * @template T - The type of the items being tested.
 * @param selector - The query selector the items are tested against.
 * @returns A function that tells whether an item matches the selector.
 */
export function createMatcher<T extends BaseItem = BaseItem>(selector: Selector<T>) {
  let query: Query | undefined
  return (item: T) => {
    query ??= new Query(selector)
    return query.test(item)
  }
}

/**
 * Tests whether a given item matches a specified selector.
 * Uses the `mingo` library to evaluate the query.
 * To test many items against the same selector, use `createMatcher`.
 * @template T - The type of the item being tested.
 * @param item - The item to test against the selector.
 * @param selector - The query selector used to match the item.
 * @returns A boolean indicating whether the item matches the selector.
 */
export default function match<T extends BaseItem = BaseItem>(
  item: T,
  selector: Selector<T>,
) {
  return createMatcher(selector)(item)
}
