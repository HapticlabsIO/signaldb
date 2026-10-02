import { describe, it, expect } from 'vitest'
import getIndexInfo from './getIndexInfo'
import createIndex from './createIndex'

describe('getIndexInfo', () => {
  it('should not match when selector is an empty object', () => {
    expect(getIndexInfo([], {})).toEqual({
      matched: false,
      positions: [],
      optimizedSelector: {},
    })
  })

  it('should not match if there are no index providers', () => {
    expect(getIndexInfo([], {
      name: 'John',
      age: 30,
    })).toEqual({
      matched: false,
      positions: [],
      optimizedSelector: {
        name: 'John',
        age: 30,
      },
    })

    expect(getIndexInfo([], {
      $and: [
        { name: 'John' },
        { age: 30 },
      ],
    })).toEqual({
      matched: false,
      positions: [],
      optimizedSelector: {
        $and: [
          { name: 'John' },
          { age: 30 },
        ],
      },
    })

    expect(getIndexInfo([], {
      $or: [
        { name: 'John' },
        { age: 30 },
      ],
    })).toEqual({
      matched: false,
      positions: [],
      optimizedSelector: {
        $or: [
          { name: 'John' },
          { age: 30 },
        ],
      },
    })
  })

  it('should return the correct result when using single index provider', () => {
    const idIndex = createIndex('id')
    idIndex.rebuild([{ id: '0' }, { id: '1' }, { id: '2' }])

    // without match, flat selector
    expect(getIndexInfo([idIndex], {
      name: 'John',
      age: 30,
    })).toEqual({
      matched: false,
      positions: [],
      optimizedSelector: {
        name: 'John',
        age: 30,
      },
    })

    // without match, $and selector
    expect(getIndexInfo([idIndex], {
      $and: [
        { name: 'John' },
        { age: 30 },
      ],
    })).toEqual({
      matched: false,
      positions: [],
      optimizedSelector: {
        $and: [
          { name: 'John' },
          { age: 30 },
        ],
      },
    })

    // without match, $or selector
    expect(getIndexInfo([idIndex], {
      $or: [
        { name: 'John' },
        { age: 30 },
      ],
    })).toEqual({
      matched: false,
      positions: [],
      optimizedSelector: {
        $or: [
          { name: 'John' },
          { age: 30 },
        ],
      },
    })

    // with match, flat selector
    expect(getIndexInfo([idIndex], {
      id: '0',
    })).toEqual({
      matched: true,
      positions: [0],
      optimizedSelector: {},
    })

    // with $in, flat selector
    expect(getIndexInfo([idIndex], {
      id: { $in: ['0', '1'] },
    })).toEqual({
      matched: true,
      positions: [0, 1],
      optimizedSelector: {},
    })

    // with $nin, flat selector
    expect(getIndexInfo([idIndex], {
      id: { $nin: ['0', '1'] },
    })).toEqual({
      matched: true,
      positions: [2],
      optimizedSelector: {},
    })

    // with match, $and selector
    expect(getIndexInfo([idIndex], {
      $and: [
        { id: '0' },
        { id: '1' },
      ],
    })).toEqual({
      matched: true,
      positions: [],
      optimizedSelector: {},
    })
    expect(getIndexInfo([idIndex], {
      $and: [
        { id: '0' },
        { name: 'John' },
        { age: 30 },
      ],
    })).toEqual({
      matched: true,
      positions: [0],
      optimizedSelector: {
        $and: [
          { name: 'John' },
          { age: 30 },
        ],
      },
    })

    // with match, $or selector
    expect(getIndexInfo([idIndex], {
      $or: [
        { id: '0' },
        { id: '1' },
      ],
    })).toEqual({
      matched: true,
      positions: [0, 1],
      optimizedSelector: {},
    })
    expect(getIndexInfo([idIndex], {
      $or: [
        { id: '0' },
        { name: 'John' },
        { age: 30 },
      ],
    })).toEqual({
      matched: false,
      positions: [],
      optimizedSelector: {
        $or: [
          { id: '0' },
          { name: 'John' },
          { age: 30 },
        ],
      },
    })

    const nameIndex = createIndex<{ id: string, name?: string | null }>('name')
    nameIndex.rebuild([
      { id: '0', name: '0' },
      { id: '1', name: '1' },
      { id: '2', name: null },
      { id: '3', name: undefined },
      { id: '4' },
    ])
    expect(getIndexInfo([nameIndex], {
      $and: [{
        $or: [
          { name: null },
          { name: { $exists: false } },
        ],
      }],
    })).toEqual({
      matched: true,
      positions: [2, 3, 4],
      optimizedSelector: {
        $and: [{
          $or: [
            { name: null },
            { name: { $exists: false } },
          ],
        }],
      },
    })
  })

  it('should return the correct result when using multiple index providers', () => {
    const comments = [{
      id: '0',
      authorId: '0',
      postId: '1',
      text: 'Lorem ipsum',
    }, {
      id: '1',
      authorId: '0',
      postId: '0',
      text: 'Lorem ipsum',
    }, {
      id: '2',
      authorId: '1',
      postId: '0',
      text: 'Lorem ipsum',
    }]
    const authorIndex = createIndex('authorId')
    const postIndex = createIndex('postId')
    authorIndex.rebuild(comments)
    postIndex.rebuild(comments)

    // without match, flat selector
    expect(getIndexInfo([authorIndex, postIndex], {
      title: 'Lorem ipsum',
    })).toEqual({
      matched: false,
      positions: [],
      optimizedSelector: {
        title: 'Lorem ipsum',
      },
    })

    // without match, $and selector
    expect(getIndexInfo([authorIndex, postIndex], {
      $and: [
        { title: 'Lorem ipsum' },
        { id: '0' },
      ],
    })).toEqual({
      matched: false,
      positions: [],
      optimizedSelector: {
        $and: [
          { title: 'Lorem ipsum' },
          { id: '0' },
        ],
      },
    })

    // without match, $or selector
    expect(getIndexInfo([authorIndex, postIndex], {
      $or: [
        { title: 'Lorem ipsum' },
        { id: '0' },
      ],
    })).toEqual({
      matched: false,
      positions: [],
      optimizedSelector: {
        $or: [
          { title: 'Lorem ipsum' },
          { id: '0' },
        ],
      },
    })

    // with match, flat selector
    expect(getIndexInfo([authorIndex, postIndex], {
      authorId: '0',
      postId: '0',
    })).toEqual({
      matched: true,
      positions: [1],
      optimizedSelector: {},
    })

    // with match, $and selector
    expect(getIndexInfo([authorIndex, postIndex], {
      $and: [
        { authorId: '0' },
        { postId: '1' },
      ],
    })).toEqual({
      matched: true,
      positions: [0],
      optimizedSelector: {},
    })
    expect(getIndexInfo([authorIndex, postIndex], {
      $and: [
        { postId: '0' },
        { title: 'Lorem ipsum' },
        { id: '0' },
      ],
    })).toEqual({
      matched: true,
      positions: [1, 2],
      optimizedSelector: {
        $and: [
          { title: 'Lorem ipsum' },
          { id: '0' },
        ],
      },
    })

    // with match, $or selector
    expect(getIndexInfo([authorIndex, postIndex], {
      $or: [
        { postId: '0' },
        { authorId: '1' },
      ],
    })).toEqual({
      matched: true,
      positions: [1, 2],
      optimizedSelector: {},
    })
    expect(getIndexInfo([authorIndex, postIndex], {
      $or: [
        { authorId: '0' },
        { name: 'John' },
        { age: 30 },
      ],
    })).toEqual({
      matched: false,
      positions: [],
      optimizedSelector: {
        $or: [
          { authorId: '0' },
          { name: 'John' },
          { age: 30 },
        ],
      },
    })

    // with match, $and and $or selector
    expect(getIndexInfo([authorIndex, postIndex], {
      $or: [
        {
          $and: [
            { id: '0', postId: '0' },
            { id: '1' },
          ],
        },
        { postId: '0', authorId: '0' },
        { authorId: '0' },
      ],
      $and: [
        {
          $or: [
            { id: '0' },
            { id: '1' },
          ],
        },
        { authorId: '0' },
        { postId: '0' },
      ],
    })).toEqual({
      matched: true,
      positions: [1],
      optimizedSelector: {
        $and: [
          {
            $or: [
              { id: '0' },
              { id: '1' },
            ],
          },
        ],
        // A branch of the $or has a condition left over, so that all branches are tested again
        $or: [
          {
            $and: [
              { id: '0', postId: '0' },
              { id: '1' },
            ],
          },
          { postId: '0', authorId: '0' },
          { authorId: '0' },
        ],
      },
    })
  })

  it('should return unique positions', () => {
    const idIndex = createIndex('id')
    idIndex.rebuild([{ id: '0' }, { id: '1' }, { id: '2' }])

    // without match, flat selector
    expect(getIndexInfo([idIndex], {
      id: { $in: ['0', '0', '0'] },
    })).toEqual({
      matched: true,
      positions: [0],
      optimizedSelector: {},
    })
  })

  it('should handle mixed index/non-index fields in $or', () => {
    const idIndex = createIndex('id')
    idIndex.rebuild([{ id: '0' }, { id: '1' }, { id: '2' }])

    expect(getIndexInfo([idIndex], {
      $or: [
        { id: '0' },
        { name: 'John' },
        { age: 30 },
      ],
    })).toEqual({
      matched: false,
      positions: [],
      optimizedSelector: {
        $or: [
          { id: '0' },
          { name: 'John' },
          { age: 30 },
        ],
      },
    })
  })

  it('should keep the operators of a field that the index did not use', () => {
    const ageIndex = createIndex('age')
    ageIndex.rebuild([{ id: '0', age: 3 }, { id: '1', age: 6 }, { id: '2', age: 9 }])

    expect(getIndexInfo([ageIndex], { age: { $in: [3, 6], $gt: 5 }, name: 'John' })).toEqual({
      matched: true,
      positions: [0, 1],
      optimizedSelector: { age: { $in: [3, 6], $gt: 5 }, name: 'John' },
    })

    // The operator the index served is not tested again
    expect(getIndexInfo([ageIndex], { age: { $in: [3, 6] }, name: 'John' })).toEqual({
      matched: true,
      positions: [0, 1],
      optimizedSelector: { name: 'John' },
    })
  })

  it('should test the branches of an $or again if the indices left a condition over for one of them', () => {
    const people = [
      { id: '0', age: 3, name: 'John' },
      { id: '1', age: 5, name: 'John' },
      { id: '2', age: 5, name: 'Jane' },
    ]
    const ageIndex = createIndex('age')
    ageIndex.rebuild(people)
    const selector = { $or: [{ age: 3 }, { age: 5, name: 'John' }] }

    expect(getIndexInfo([ageIndex], selector)).toEqual({
      matched: true,
      positions: [0, 1, 2],
      optimizedSelector: selector,
    })
  })

  it('should only keep the positions of an $or that match the rest of the selector as well', () => {
    const people = [
      { id: '0', age: 3, name: 'John' },
      { id: '1', age: 5, name: 'John' },
      { id: '2', age: 5, name: 'Jane' },
      { id: '3', age: 7, name: 'Jane' },
    ]
    const ageIndex = createIndex('age')
    const nameIndex = createIndex('name')
    ageIndex.rebuild(people)
    nameIndex.rebuild(people)

    expect(getIndexInfo([ageIndex, nameIndex], {
      name: 'John',
      $or: [{ age: 3 }, { age: 7 }],
    })).toEqual({
      matched: true,
      positions: [0],
      optimizedSelector: {},
    })
  })
})
