import { it, expectTypeOf } from 'vitest'
import type Selector from './Selector'
import type { FieldExpression, FlatSelector } from './Selector'

interface TestUser {
  name: string | number,
  age: number,
  tags: string[],
  address: {
    street: string,
    city: string,
  },
  scores: {
    math: number,
    science: number,
    deep: {
      nested: boolean,
    },
  }[],
  deep: {
    nested: {
      value: boolean,
    },
  },
}

it('should allow basic field queries', () => {
  expectTypeOf<Selector<TestUser>>().toExtend<{
    name?: string | number | FieldExpression<string | number> | RegExp,
    age?: number | FieldExpression<number>,
  }>()
})

it('should allow union types for fields', () => {
  expectTypeOf<Selector<{ status: 'active' | 'inactive' }>>().toExtend<{
    status?: 'active' | 'inactive' | FieldExpression<'active' | 'inactive'> | RegExp,
  }>()
  expectTypeOf<FieldExpression<'active' | 'inactive'>>().toExtend<{
    $eq?: 'active' | 'inactive',
    $in?: ('active' | 'inactive')[],
  }>()
})

it('should allow array queries', () => {
  expectTypeOf<Selector<TestUser>>().toExtend<{
    'tags'?: string | RegExp | FieldExpression<string> | string[] | FieldExpression<string[]>,
    'tags.$'?: string | RegExp | FieldExpression<string>,
  }>()
  expectTypeOf<FlatSelector<TestUser>['tags']>().toEqualTypeOf<string | RegExp | FieldExpression<string> | string[] | FieldExpression<string[]> | undefined>()
})

it('should allow logical operators', () => {
  expectTypeOf<Selector<TestUser>>().toExtend<{
    $or?: Selector<TestUser>[],
    $and?: Selector<TestUser>[],
    $nor?: Selector<TestUser>[],
  }>()
})
