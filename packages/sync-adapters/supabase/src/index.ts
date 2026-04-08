import { SyncManager } from '@signaldb/sync'
import type { BaseItem, Changeset, LoadResponse } from '@signaldb/core/index'
import type {
  RealtimePostgresChangesPayload,
  SupabaseClient,
} from '@supabase/supabase-js'
import type { Change } from '@signaldb/sync/types'

export const createSupabaseViewSyncManager = <
  TLocalItem extends BaseItem,
  TRemoteItem,
>(
  identifier: string,
  supabaseToLocal: (loaded: {
    items: TRemoteItem[],
  }) => Promise<{ items: TLocalItem[] }>,
  selectAll: () => Promise<TRemoteItem[]>,
  persistenceAdapter: ConstructorParameters<
    typeof SyncManager<any>
  >[0]['persistenceAdapter'],
) =>
  new SyncManager<any, TLocalItem>({
    id: identifier,
    onError: (options, error) => {
      // eslint-disable-next-line no-console
      console.error(options, error)
    },
    persistenceAdapter,
    async pull() {
      return await selectAll().then(items => supabaseToLocal({ items }))
    },
    async push() {
      // eslint-disable-next-line no-console
      console.error('Push does not make sense on views')
    },
  })

interface PushSecondParameter<TItem, TIdentifier> {
  rawChanges: Omit<Change, 'id' | 'collectionName'>[],
  changes: Changeset<TItem> & {
    modifiedFields: Map<TIdentifier, string[]>,
  },
}

type CleanupFunction = (() => void | Promise<void>) | void

export const createSupabaseSyncManager = <
  TLocalItem extends BaseItem,
  TLocalIdType extends TLocalItem['id'],
  TRemoteItem,
>(
  persistenceAdapter: ConstructorParameters<
    typeof SyncManager<any>
  >[0]['persistenceAdapter'],
) =>
  new SyncManager<
    {
      pull: (
        collectionOptions: any,
        pullParameters: {
          lastFinishedSyncStart?: number,
          lastFinishedSyncEnd?: number,
        },
      ) => Promise<LoadResponse<TRemoteItem>>,

      push: (
        collectionOptions: any,
        pushParameters: PushSecondParameter<TRemoteItem, TLocalIdType>,
      ) => Promise<void>,

      /**
       * A hook to transform the changeset before it's pushed to Supabase.
       *
       * Can be used to, for example, add _deleted and _modified properties.
       */
      beforeUpload: (
        changeset: Parameters<
          ConstructorParameters<
            typeof SyncManager<any, TLocalItem, TLocalIdType>
          >[0]['push']
        >[1],
      ) => Promise<PushSecondParameter<TRemoteItem, TLocalIdType>>,

      /**
       * A hook to transform the items after they're pulled from Supabase,
       * before they're applied to the collection.
       */
      afterDownload: (
        changeset: LoadResponse<TRemoteItem>,
      ) => Promise<LoadResponse<TLocalItem>>,

      startListening?: (
        collectionOptions: any,
        onChange: (data?: LoadResponse<TRemoteItem>) => Promise<void>,
      ) => CleanupFunction | Promise<CleanupFunction>,
    } & {},
    TLocalItem,
    TLocalIdType
  >({
    id: 'supabase-sync-manager',
    onError: (options, error) => {
      // eslint-disable-next-line no-console
      console.error(options, error)
    },
    persistenceAdapter,
    async registerRemoteChange(configuration, onChange) {
      return await configuration.startListening?.(
        configuration,
        async (changes) => {
          if (changes === undefined) return
          return await configuration.afterDownload(changes).then(onChange)
        },
      )
    },
    async pull(configuration, lastPullTiming) {
      const fromSupabase = await configuration.pull(
        configuration,
        lastPullTiming,
      )
      return await configuration.afterDownload(fromSupabase)
    },
    async push(configuration, allChanges) {
      const changes = await configuration.beforeUpload(allChanges)
      await configuration.push(configuration, changes)
    },
  })

/**
 *
 * @param changes
 * @param onChange
 */
export function handleTableChanges<TRemoteItem extends { [key: string]: any }>(
  changes: RealtimePostgresChangesPayload<TRemoteItem>,
  onChange: (data?: LoadResponse<TRemoteItem>) => Promise<void>,
): void {
  const newIsDeleted
    = 'deleted' in changes.new && changes.new?._deleted === true
  const oldWasDeleted
    = 'deleted' in changes.old && changes.old?._deleted === true
  switch (changes.eventType) {
    case 'INSERT': {
      void onChange({
        changes: {
          added: newIsDeleted ? [] : [changes.new],
          modified: [],
          removed: newIsDeleted ? [changes.new] : [],
        },
      })
      break
    }
    case 'UPDATE': {
      void onChange({
        changes: {
          modified: !oldWasDeleted && !newIsDeleted ? [changes.new] : [],
          removed: !oldWasDeleted && newIsDeleted ? [changes.new] : [],
          added: oldWasDeleted && !newIsDeleted ? [changes.new] : [],
        },
      })
      break
    }
    case 'DELETE': {
      void onChange({
        changes: {
          removed: oldWasDeleted ? [] : [changes.old],
          added: [],
          modified: [],
        },
      })
      break
    }
  }
}

/**
 *
 * @param supabase
 * @param schemaName
 * @param tableName
 */
export function startListeningToTableChanges<
  TRemoteItem extends { [key: string]: any },
>(
  supabase: SupabaseClient,
  schemaName: string,
  tableName: string,
): (collectionOptions: any,
  onChange: (data?: LoadResponse<TRemoteItem>) => Promise<void>)
=> CleanupFunction | Promise<CleanupFunction> {
  return (config, onChange) => {
    const channel = supabase
      .channel('room1')
      .on(
        'postgres_changes',
        { event: '*', schema: schemaName, table: tableName },
        (changes: RealtimePostgresChangesPayload<TRemoteItem>) => {
          handleTableChanges(changes, onChange)
        },
      )
      .subscribe()
    return async () => {
      await channel.unsubscribe()
    }
  }
}

/**
 *
 * @param supabase
 * @param schemaName
 * @param tableName
 */
export function baseQueryFromSupabase<
  TDatabase,
  TSchemaName extends string & Exclude<keyof TDatabase, '__InternalSupabase'>,
  TTableName extends string & TDatabase[TSchemaName] extends {
    Tables: infer Tables,
  }
    ? keyof Tables
    : never,
>(
  supabase: SupabaseClient<TDatabase>,
  schemaName: TSchemaName,
  tableName: TTableName,
) {
  return supabase.schema(schemaName).from(tableName)
}

/**
 *
 * @param supabase
 * @param schemaName
 * @param tableName
 */
export function baseSelectFromSupabase<
  TDatabase,
  TSchemaName extends string & Exclude<keyof TDatabase, '__InternalSupabase'>,
  TTableName extends string & TDatabase[TSchemaName] extends {
    Tables: infer Tables,
  }
    ? keyof Tables
    : never,
>(
  supabase: SupabaseClient<TDatabase>,
  schemaName: TSchemaName,
  tableName: TTableName,
) {
  return () => baseQueryFromSupabase(supabase, schemaName, tableName).select()
}

export type TableWithFieldName<
  TDatabase,
  TSchemaName extends string & Exclude<keyof TDatabase, '__InternalSupabase'>,
  Shape extends object,
> = TDatabase[TSchemaName] extends { Tables: infer Tables }
  ? {
    [K in keyof Tables]: Tables[K] extends {
      Row: infer Row,
      Insert: infer Insert,
      Update: infer Update,
    }
      ? Row extends Shape
        ? Insert extends Partial<Shape>
          ? Update extends Partial<Shape>
            ? K
            : never
          : never
        : never
      : never;
  }[keyof Tables]
  : never

/**
 *
 * @param baseSelect
 */
export function filterOutDeletedFromSupabase<
  TDatabase,
  TSchemaName extends string & Exclude<keyof TDatabase, '__InternalSupabase'>,
  TTableName extends TableWithFieldName<
    TDatabase,
    TSchemaName,
    { _deleted: boolean }
  >,
>(
  baseSelect: ReturnType<
    typeof baseSelectFromSupabase<TDatabase, TSchemaName, TTableName>
  >,
) {
  // @ts-expect-error We know that the table has a _deleted field, so this is safe
  return () => baseSelect().eq('_deleted', false)
}

/**
 *
 * @param baseSelect
 */
export function filterOutUnmodifiedFromSupabase<
  TDatabase,
  TSchemaName extends string & Exclude<keyof TDatabase, '__InternalSupabase'>,
  TTableName extends TableWithFieldName<
    TDatabase,
    TSchemaName,
    { _modified: string }
  >,
>(
  baseSelect: ReturnType<
    typeof baseSelectFromSupabase<TDatabase, TSchemaName, TTableName>
  >,
) {
  return (modifiedAfter?: string) =>
    modifiedAfter ? baseSelect().gt('_modified', modifiedAfter) : baseSelect()
}

/**
 *
 * @param select
 */
export function executeSelectFromSupabase<
  TDatabase,
  TSchemaName extends string & Exclude<keyof TDatabase, '__InternalSupabase'>,
  TTableName extends string & TDatabase[TSchemaName] extends {
    Tables: infer Tables,
  }
    ? keyof Tables
    : never,
>(
  select:
    | ReturnType<
        typeof baseSelectFromSupabase<TDatabase, TSchemaName, TTableName>
    >
    | ReturnType<
        typeof filterOutUnmodifiedFromSupabase<
          TDatabase,
          TSchemaName,
          TTableName
        >
    >,
) {
  return async ({
    lastFinishedSyncEnd,
    lastFinishedSyncStart,
  }: {
    lastFinishedSyncStart?: number | undefined,
    lastFinishedSyncEnd?: number | undefined,
  }) => {
    const changesStart = lastFinishedSyncEnd ?? lastFinishedSyncStart
    const supabaseResponse = await select(
      changesStart ? new Date(changesStart).toISOString() : undefined,
    )
    const items = supabaseResponse.data ?? []
    if (supabaseResponse.error) {
      // eslint-disable-next-line no-console
      console.error(
        'Error pulling changes from Supabase',
        supabaseResponse.error,
      )
    }
    return items
  }
}

/**
 *
 * @param array
 */
function removeSyncProperties<
  T extends { _deleted?: unknown, _modified?: unknown },
>(array: T[]) {
  array.forEach((item) => {
    delete item._deleted
    delete item._modified
  })
}

/**
 *
 * @param items
 * @param generator
 */
export function postProcessFullPull<TRemoteItem, TParameters extends any[]>(
  generator: (...parameters: TParameters) => Promise<TRemoteItem[]>,
): (
  ...parameters: TParameters
) => Promise<{ items: Omit<TRemoteItem, '_deleted' | '_modified'>[] }> {
  return async (...parameters: TParameters) => {
    const items = await generator(...parameters)
    if (
      items.every(
        item =>
          typeof item === 'object'
          && item !== null
          && '_deleted' in item
          && '_modified' in item,
      )
    ) {
      removeSyncProperties(items)
    }
    return { items }
  }
}

/**
 *
 * @param items
 * @param generator
 */
export function postProcessChangesPull<
  TRemoteItem extends { _deleted: boolean, _modified: unknown },
  TParameters extends any[],
>(generator: (...parameters: TParameters) => Promise<TRemoteItem[]>) {
  return async (...parameters: TParameters) => {
    const items = await generator(...parameters)
    const modified: TRemoteItem[] = []
    const removed: TRemoteItem[] = []

    items.forEach((item) => {
      if (item._deleted) {
        removed.push(item)
      } else {
        modified.push(item)
      }
    })

    removeSyncProperties(modified)
    removeSyncProperties(removed)

    return {
      changes: {
        modified,
        removed,
        // We can't distinguish between added and modified
        added: [],
      },
    }
  }
}

interface PushMethods<TRemoteItem> {
  upsert: (item: TRemoteItem) => Promise<{ error?: unknown }>,
  insert: (item: TRemoteItem) => Promise<{ error?: unknown }>,
  update: (item: TRemoteItem) => Promise<{ error?: unknown }>,
  remove: (item: TRemoteItem) => Promise<{ error?: unknown }>,
}

/**
 *
 * @param root0
 * @param root0.upsert
 * @param root0.insert
 * @param root0.update
 * @param root0.remove
 */
export function createDeletedModifiedTrackingPusher<
  TRemoteItem extends { _deleted: boolean, _modified: string },
>({
  upsert,
  update,
}: PushMethods<
  Omit<TRemoteItem, '_deleted' | '_modified'> & {
    _deleted: boolean,
    _modified: string,
  }
>): ConstructorParameters<
  typeof SyncManager<
    any,
    TRemoteItem & { id: unknown, _deleted: boolean, _modified: string }
  >
>[0]['push'] {
  return createGenericPusher({
    addedAction: async item =>
      await upsert({
        ...item,
        _deleted: false,
        _modified: new Date().toISOString(),
      }),
    changedAction: async (item) => {
      item._modified = new Date().toISOString()
      return await update(item)
    },
    removedAction: async item =>
      await update({
        ...item,
        _deleted: true,
        _modified: new Date().toISOString(),
      }),
  })
}

/**
 *
 * @param root0
 * @param root0.upsert
 * @param root0.insert
 * @param root0.update
 * @param root0.remove
 */
export function createSimplePusher<TRemoteItem, TLocalIdType>({
  insert,
  update,
  remove,
}: PushMethods<TRemoteItem>): (
  collectionOptions: any,
  pushParameters: PushSecondParameter<TRemoteItem, TLocalIdType>,
) => Promise<void> {
  return createGenericPusher({
    addedAction: insert,
    changedAction: async item => await update(item),
    removedAction: async item => await remove(item),
  })
}

/**
 *
 * @param root0
 * @param root0.addedAction
 * @param root0.changedAction
 * @param root0.removedAction
 */
function createGenericPusher<TRemoteItem, TLocalIdType>({
  addedAction,
  changedAction,
  removedAction,
}: {
  addedAction: (item: TRemoteItem) => Promise<{ error?: unknown }>,
  changedAction: (item: TRemoteItem) => Promise<{ error?: unknown }>,
  removedAction: (item: TRemoteItem) => Promise<{ error?: unknown }>,
}): (
  collectionOptions: any,
  pushParameters: PushSecondParameter<TRemoteItem, TLocalIdType>,
) => Promise<void> {
  return async (configuration, { changes }) => {
    await Promise.all([
      ...changes.added.map(async (item) => {
        await addedAction(item).then(({ error }) => {
          if (error) {
            // eslint-disable-next-line no-console
            console.error('Insert error', error, item)
          }
        })
      }),
      ...changes.modified.map(async (item) => {
        await changedAction(item).then(({ error }) => {
          if (error) {
            // eslint-disable-next-line no-console
            console.error('Update error', error)
          }
        })
      }),
      ...changes.removed.map(async (item) => {
        await removedAction(item).then(({ error }) => {
          if (error) {
            // eslint-disable-next-line no-console
            console.error('Delete error', error)
          }
        })
      }),
    ])
  }
}

/**
 *
 * @param table
 * @param table.upsert
 * @param table.insert
 * @param table.update
 * @param table.delete
 * @param table.remove
 */
export function createPushMethods<TItem extends { id: unknown }>(table: {
  upsert: (item: TItem) => PromiseLike<{ error?: unknown }>,
  insert: (item: TItem) => PromiseLike<{ error?: unknown }>,
  update: (item: Partial<TItem>) => {
    eq: (field: string, value: any) => PromiseLike<{ error?: unknown }>,
  },
  delete: () => {
    eq: (field: string, value: any) => PromiseLike<{ error?: unknown }>,
  },
}) {
  return {
    upsert: async (item: TItem) => await table.upsert(item),
    insert: async (item: TItem) => await table.insert(item),
    update: async (item: TItem) => await table.update(item).eq('id', item.id),
    remove: async (item: TItem) => await table.delete().eq('id', item.id),
  }
}

/**
 *
 * @param changeset
 */
export async function removeLocalId<TLocalItem extends { id: unknown }>(
  changeset: Parameters<
    ConstructorParameters<
      typeof SyncManager<any, TLocalItem, TLocalItem['id']>
    >[0]['push']
  >[1],
): Promise<PushSecondParameter<Omit<TLocalItem, 'id'>, TLocalItem['id']>> {
  return {
    rawChanges: changeset.rawChanges.map((originalRawChange) => {
      switch (originalRawChange.type) {
        case 'insert': {
          const { id, ...originalDataWithoutId } = originalRawChange.data
          return {
            ...originalRawChange,
            data: originalDataWithoutId,
          }
        }
        case 'remove': {
          // @todo Ideally, remove and update could also get rid of the id
          return originalRawChange
        }
        case 'update': {
          return originalRawChange
        }
      }
    }),
    changes: {
      added: changeset.changes.added.map(
        ({ id, ...itemWithoutId }) => itemWithoutId,
      ),
      modified: changeset.changes.modified.map(
        ({ id, ...itemWithoutId }) => itemWithoutId,
      ),
      removed: changeset.changes.removed.map(
        ({ id, ...itemWithoutId }) => itemWithoutId,
      ),
      // @todo would be nice to not depend on the local id here
      modifiedFields: changeset.changes.modifiedFields,
    },
  }
}

export const createLocalId = <TRemoteItem>(item: TRemoteItem, fields: (keyof TRemoteItem)[]) =>
  fields.map(field => `${String(item[field])}`.replaceAll('|', String.raw`\|`)).join('||')
/**
 *
 * @param fields
 */
export function createAddLocalId<TRemoteItem>(
  fields: (keyof TRemoteItem)[],
): (remoteItems: LoadResponse<TRemoteItem>)
=> Promise<LoadResponse<TRemoteItem & { id: string }>> {
  const addIds = (item: TRemoteItem[]) => item.map(itemWithoutId => ({
    ...itemWithoutId,
    id: createLocalId(itemWithoutId, fields) }
  ))

  return async remoteItems => remoteItems.items
    ? {
      items: addIds(remoteItems.items),
    }
    : {
      changes: {
        added: addIds(remoteItems.changes.added),
        modified: addIds(remoteItems.changes.modified),
        removed: addIds(remoteItems.changes.removed),
      },
    }
}

// class SupabaseSyncManager {
//   /**
//    * Associates a handler to each collection
//    */
//   private readonly handlers: Map<string, {
//     pull: ConstructorParameters<typeof SyncManager<any, TRemoteItem>>[0]['pull'],

//     push: ConstructorParameters<typeof SyncManager<any, TRemoteItem>>[0]['push'],

//     /**
//      * A hook to transform the changeset before it's pushed to Supabase.
//      *
//      * Can be used to, for example, add _deleted and _modified properties.
//      */
//     beforeUpload: (
//       changeset: Parameters<ConstructorParameters<typeof SyncManager<any, TLocalItem, TLocalIdType>>[0]['push']>[1],
//     ) => Promise<Parameters<ConstructorParameters<typeof SyncManager<any, TRemoteItem>>[0]['push']>[1]>,

//     /**
//      * A hook to transform the items after they're pulled from Supabase,
//      * before they're applied to the collection.
//      *
//      * Can be used to, for example, remove _deleted and _modified properties.
//      */
//     afterDownload: (
//       changeset: LoadResponse<TRemoteItem>,
//     ) => Promise<LoadResponse<TLocalItem>>,

//     startListening?: ConstructorParameters<typeof SyncManager<any, TRemoteItem>>[0]['registerRemoteChange'], }> = new Map()
// }
