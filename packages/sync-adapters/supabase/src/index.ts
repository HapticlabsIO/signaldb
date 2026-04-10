import { SyncManager, applyChanges } from "@signaldb/sync";
import type { BaseItem, Changeset, LoadResponse } from "@signaldb/core/index";
import type {
  RealtimePostgresChangesPayload,
  SupabaseClient,
} from "@supabase/supabase-js";
import type { Change } from "@signaldb/sync/types";

interface PushSecondParameter<TItem, TIdentifier> {
  rawChanges: Omit<Change, "id" | "collectionName">[];
  changes: Changeset<TItem> & {
    modifiedFields: Map<TIdentifier, string[]>;
  };
}

type CleanupFunction = (() => void | Promise<void>) | void;

export const createSupabaseSyncManager = <
  TLocalItem extends BaseItem,
  TLocalIdType extends TLocalItem["id"],
  TRemoteItem,
>(
  persistenceAdapter: ConstructorParameters<
    typeof SyncManager<any>
  >[0]["persistenceAdapter"],
) =>
  new SyncManager<
    {
      pull: (
        collectionOptions: any,
        pullParameters: {
          lastFinishedSyncStart?: number;
          lastFinishedSyncEnd?: number;
        },
      ) => Promise<LoadResponse<TRemoteItem>>;

      push: (
        collectionOptions: any,
        pushParameters: PushSecondParameter<TRemoteItem, TLocalIdType>,
      ) => Promise<void>;

      /**
       * A hook to transform the changeset before it's pushed to Supabase.
       *
       * Can be used to, for example, add _deleted and _modified properties.
       */
      beforeUpload: (
        changeset: Parameters<
          ConstructorParameters<
            typeof SyncManager<any, TLocalItem, TLocalIdType>
          >[0]["push"]
        >[1],
      ) => Promise<PushSecondParameter<TRemoteItem, TLocalIdType>>;

      /**
       * A hook to transform the items after they're pulled from Supabase,
       * before they're applied to the collection.
       */
      afterDownload: (
        changeset: LoadResponse<TRemoteItem>,
      ) => Promise<LoadResponse<TLocalItem>>;

      startListening?: (
        collectionOptions: any,
        onChange: (data?: LoadResponse<TRemoteItem>) => Promise<void>,
      ) => CleanupFunction | Promise<CleanupFunction>;
    } & {},
    TLocalItem,
    TLocalIdType
  >({
    id: "supabase-sync-manager",
    onError: (options, error) => {
      // eslint-disable-next-line no-console
      console.error("SyncManager error", options, error);
    },
    persistenceAdapter,
    async registerRemoteChange(configuration, onChange) {
      return await configuration.startListening?.(
        configuration,
        async (changes) => {
          if (changes === undefined) return;
          return await configuration.afterDownload(changes).then(onChange);
        },
      );
    },
    async pull(configuration, lastPullTiming) {
      const fromSupabase = await configuration.pull(
        configuration,
        lastPullTiming,
      );
      return await configuration.afterDownload(fromSupabase);
    },
    async push(configuration, allChanges) {
      const changes = await configuration.beforeUpload(allChanges);
      await configuration.push(configuration, changes);
    },
  });

/**
 *
 * @param dummyItem
 * @param changes
 * @param onChange
 */
export function createTableChangeHandler<
  TRemoteItem extends { [key: string]: any },
>(dummyItem: TRemoteItem) {
  return (
    changes: RealtimePostgresChangesPayload<TRemoteItem>,
    onChange: (data?: LoadResponse<TRemoteItem>) => Promise<void>,
  ) => {
    const newIsDeleted =
      "deleted" in changes.new && changes.new?._deleted === true;
    const oldWasDeleted =
      "deleted" in changes.old && changes.old?._deleted === true;
    switch (changes.eventType) {
      case "INSERT": {
        void onChange({
          changes: {
            added: newIsDeleted ? [] : [changes.new],
            modified: [],
            removed: newIsDeleted ? [changes.new] : [],
          },
        });
        break;
      }
      case "UPDATE": {
        void onChange({
          changes: {
            modified: !oldWasDeleted && !newIsDeleted ? [changes.new] : [],
            removed: !oldWasDeleted && newIsDeleted ? [changes.new] : [],
            added: oldWasDeleted && !newIsDeleted ? [changes.new] : [],
          },
        });
        break;
      }
      case "DELETE": {
        void onChange({
          changes: {
            removed: oldWasDeleted ? [] : [{ ...dummyItem, ...changes.old }],
            added: [],
            modified: [],
          },
        });
        break;
      }
    }
  };
}

/**
 *
 * @param supabase
 * @param schemaName
 * @param tableName
 * @param dummyItem
 */
export function startListeningToTableChanges<
  TRemoteItem extends { [key: string]: any },
>(
  supabase: SupabaseClient,
  schemaName: string,
  tableName: string,
  dummyItem: TRemoteItem,
): (
  collectionOptions: any,
  onChange: (data?: LoadResponse<TRemoteItem>) => Promise<void>,
) => CleanupFunction | Promise<CleanupFunction> {
  const handler = createTableChangeHandler(dummyItem);
  return (config, onChange) => {
    const channel = supabase
      .channel(`signaldb_listening_${schemaName}_${tableName}`)
      .on(
        "postgres_changes",
        { event: "*", schema: schemaName, table: tableName },
        (changes: RealtimePostgresChangesPayload<TRemoteItem>) => {
          handler(changes, onChange);
        },
      )
      .subscribe();
    return async () => {
      await channel.unsubscribe();
    };
  };
}

/**
 *
 * @param supabase
 * @param schemaName
 * @param tableName
 */
export function baseQueryFromSupabase<
  TDatabase,
  TSchemaName extends string & Exclude<keyof TDatabase, "__InternalSupabase">,
  TTableName extends string & TDatabase[TSchemaName] extends {
    Tables: infer Tables;
  }
    ? keyof Tables
    : never,
>(
  supabase: SupabaseClient<TDatabase>,
  schemaName: TSchemaName,
  tableName: TTableName,
) {
  return supabase.schema(schemaName).from(tableName);
}

/**
 *
 * @param supabase
 * @param schemaName
 * @param tableName
 */
export function baseSelectFromSupabase<
  TDatabase,
  TSchemaName extends string & Exclude<keyof TDatabase, "__InternalSupabase">,
  TTableName extends string & TDatabase[TSchemaName] extends {
    Tables: infer Tables;
  }
    ? keyof Tables
    : never,
>(
  supabase: SupabaseClient<TDatabase>,
  schemaName: TSchemaName,
  tableName: TTableName,
) {
  return () => baseQueryFromSupabase(supabase, schemaName, tableName).select();
}

export type TableWithFieldName<
  TDatabase,
  TSchemaName extends string & Exclude<keyof TDatabase, "__InternalSupabase">,
  Shape extends object,
> = TDatabase[TSchemaName] extends { Tables: infer Tables }
  ? {
      [K in keyof Tables]: Tables[K] extends {
        Row: infer Row;
        Insert: infer Insert;
        Update: infer Update;
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
  : never;

/**
 *
 * @param baseSelect
 */
export function filterOutDeletedFromSupabase<
  TDatabase,
  TSchemaName extends string & Exclude<keyof TDatabase, "__InternalSupabase">,
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
  return () => baseSelect().eq("_deleted", false);
}

/**
 *
 * @param baseSelect
 */
export function filterOutUnmodifiedFromSupabase<
  TDatabase,
  TSchemaName extends string & Exclude<keyof TDatabase, "__InternalSupabase">,
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
    modifiedAfter ? baseSelect().gt("_modified", modifiedAfter) : baseSelect();
}

/**
 *
 * @param select
 */
export function executeSelectFromSupabase<
  TDatabase,
  TSchemaName extends string & Exclude<keyof TDatabase, "__InternalSupabase">,
  TTableName extends string & TDatabase[TSchemaName] extends {
    Tables: infer Tables;
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
    lastFinishedSyncStart?: number | undefined;
    lastFinishedSyncEnd?: number | undefined;
  }) => {
    const changesStart = lastFinishedSyncEnd ?? lastFinishedSyncStart;
    const supabaseResponse = await select(
      changesStart ? new Date(changesStart).toISOString() : undefined,
    );
    const items = supabaseResponse.data ?? [];
    if (supabaseResponse.error) {
      // eslint-disable-next-line no-console
      console.error(
        "Error pulling changes from Supabase",
        supabaseResponse.error,
      );
    }
    return items;
  };
}

/**
 *
 * @param array
 */
function removeSyncProperties<
  T extends { _deleted?: unknown; _modified?: unknown },
>(array: T[]): Omit<T, "_deleted" | "_modified">[] {
  return array.map(
    ({ _deleted, _modified, ...itemWithoutSyncProperties }) =>
      itemWithoutSyncProperties,
  );
}

/**
 *
 * @param items
 * @param generator
 */
export function postProcessFullPull<TRemoteItem, TParameters extends unknown[]>(
  generator: (...parameters: TParameters) => Promise<TRemoteItem[]>,
): (
  ...parameters: TParameters
) => Promise<{ items: Omit<TRemoteItem, "_deleted" | "_modified">[] }> {
  return async (...parameters: TParameters) => {
    const items = await generator(...parameters);
    if (
      items.every(
        (item) =>
          typeof item === "object" &&
          item !== null &&
          "_deleted" in item &&
          "_modified" in item,
      )
    ) {
      return { items: removeSyncProperties(items) };
    } else {
      return { items };
    }
  };
}

/**
 *
 * @param items
 * @param generator
 */
export function postProcessChangesPull<
  TRemoteItem extends { _deleted: boolean; _modified: unknown },
  TParameters extends any[],
>(generator: (...parameters: TParameters) => Promise<TRemoteItem[]>) {
  return async (...parameters: TParameters) => {
    const items = await generator(...parameters);
    const modified: TRemoteItem[] = [];
    const removed: TRemoteItem[] = [];

    items.forEach((item) => {
      if (item._deleted) {
        removed.push(item);
      } else {
        modified.push(item);
      }
    });

    return {
      changes: {
        modified: removeSyncProperties(modified),
        removed: removeSyncProperties(removed),
        // We can't distinguish between added and modified
        added: [],
      },
    };
  };
}

interface PushMethods<TRemoteItem> {
  upsert: (item: TRemoteItem) => Promise<{ error?: unknown }>;
  insert: (item: TRemoteItem) => Promise<{ error?: unknown }>;
  update: (item: TRemoteItem) => Promise<{ error?: unknown }>;
  remove: (item: TRemoteItem) => Promise<{ error?: unknown }>;
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
  TRemoteItem extends { _deleted: boolean; _modified: string },
>({
  upsert,
  update,
}: PushMethods<
  Omit<TRemoteItem, "_deleted" | "_modified"> & {
    _deleted: boolean;
    _modified: string;
  }
>): ConstructorParameters<
  typeof SyncManager<
    any,
    TRemoteItem & { id: unknown; _deleted: boolean; _modified: string }
  >
>[0]["push"] {
  return createGenericPusher({
    addedAction: async (item) =>
      await upsert({
        ...item,
        _deleted: false,
        _modified: new Date().toISOString(),
      }),
    changedAction: async (item) => {
      item._modified = new Date().toISOString();
      return await update(item);
    },
    removedAction: async (item) =>
      await update({
        ...item,
        _deleted: true,
        _modified: new Date().toISOString(),
      }),
  });
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
    changedAction: async (item) => await update(item),
    removedAction: async (item) => await remove(item),
  });
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
  addedAction: (item: TRemoteItem) => Promise<{ error?: unknown }>;
  changedAction: (item: TRemoteItem) => Promise<{ error?: unknown }>;
  removedAction: (item: TRemoteItem) => Promise<{ error?: unknown }>;
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
            console.error("Insert error", error, item);
          }
        });
      }),
      ...changes.modified.map(async (item) => {
        await changedAction(item).then(({ error }) => {
          if (error) {
            // eslint-disable-next-line no-console
            console.error("Update error", error);
          }
        });
      }),
      ...changes.removed.map(async (item) => {
        await removedAction(item).then(({ error }) => {
          if (error) {
            // eslint-disable-next-line no-console
            console.error("Delete error", error);
          }
        });
      }),
    ]);
  };
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
  upsert: (item: TItem) => PromiseLike<{ error?: unknown }>;
  insert: (item: TItem) => PromiseLike<{ error?: unknown }>;
  update: (item: Partial<TItem>) => {
    eq: (field: string, value: any) => PromiseLike<{ error?: unknown }>;
  };
  delete: () => {
    eq: (field: string, value: any) => PromiseLike<{ error?: unknown }>;
  };
}) {
  return {
    upsert: async (item: TItem) => await table.upsert(item),
    insert: async (item: TItem) => await table.insert(item),
    update: async (item: TItem) => await table.update(item).eq("id", item.id),
    remove: async (item: TItem) => await table.delete().eq("id", item.id),
  };
}

/**
 *
 * @param changeset
 */
export async function removeLocalId<TLocalItem extends { id: unknown }>(
  changeset: Parameters<
    ConstructorParameters<
      typeof SyncManager<any, TLocalItem, TLocalItem["id"]>
    >[0]["push"]
  >[1],
): Promise<PushSecondParameter<Omit<TLocalItem, "id">, TLocalItem["id"]>> {
  return {
    rawChanges: changeset.rawChanges.map((originalRawChange) => {
      switch (originalRawChange.type) {
        case "insert": {
          const { id, ...originalDataWithoutId } = originalRawChange.data;
          return {
            ...originalRawChange,
            data: originalDataWithoutId,
          };
        }
        case "remove": {
          // @todo Ideally, remove and update could also get rid of the id
          return originalRawChange;
        }
        case "update": {
          return originalRawChange;
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
  };
}

export const createLocalId = <TRemoteItem>(
  item: TRemoteItem,
  fields: (keyof TRemoteItem)[],
) =>
  fields
    .map((field) => `${String(item[field])}`.replaceAll("|", String.raw`\|`))
    .join("||");
/**
 *
 * @param fields
 */
export function createAddLocalId<TRemoteItem>(
  fields: (keyof TRemoteItem)[],
): (
  remoteItems: LoadResponse<TRemoteItem>,
) => Promise<LoadResponse<TRemoteItem & { id: string }>> {
  const addIds = (item: TRemoteItem[]) =>
    item.map((itemWithoutId) => ({
      ...itemWithoutId,
      id: createLocalId(itemWithoutId, fields),
    }));

  return async (remoteItems) =>
    remoteItems.items
      ? {
          items: addIds(remoteItems.items),
        }
      : {
          changes: {
            added: addIds(remoteItems.changes.added),
            modified: addIds(remoteItems.changes.modified),
            removed: addIds(remoteItems.changes.removed),
          },
        };
}

/**
 *
 * @param map
 * @param key
 * @param value
 */
function addToMapOfSets<K, V>(
  map: Map<K, Set<V>>,
  key: K,
  value: V | V[] | Set<V>,
) {
  let set = map.get(key);
  if (!set) {
    set = new Set<V>();
    map.set(key, set);
  }
  if (Array.isArray(value) || value instanceof Set) {
    value.forEach((v) => set.add(v));
  } else {
    set.add(value);
  }
}

const LOCAL_PATH_COLUMN_NAME = "_localPath";
type LocalPathColumnName = typeof LOCAL_PATH_COLUMN_NAME;

export type LocalDirectoryForWrite = {
  save: (fileName: string, data: ArrayBuffer) => Promise<void>;
  exists: (fileName: string) => Promise<boolean>;
  listDirectory: () => Promise<string[]>;
  remove: (fileName: string) => Promise<void>;
};

export type LocalDirectoryForRead = {
  load: (fileName: string) => Promise<ArrayBuffer>;
};

/**
 *
 * @param bucketName
 * @param columnName
 * @param supabase
 * @param getPendingLocalChanges
 * @param getLocalReferences
 * @param getLocalPath
 * @param localDirectory
 */
export function createPullFiles<
  TPathColumn extends string,
  TIdType,
  TRemoteItem extends {
    [key in TPathColumn]: string | null;
  } & BaseItem<TIdType>,
>(
  bucketName: string,
  columnName: TPathColumn,
  supabase: SupabaseClient,
  getPendingLocalChanges: () => Change<
    TRemoteItem & { [LOCAL_PATH_COLUMN_NAME]: string | null },
    TIdType
  >[],
  getLocalReferences: (path: string) => Set<TIdType>,
  getLocalPath: (id: TIdType) => string | null,
  localDirectory: LocalDirectoryForWrite,
): (
  remoteItems: LoadResponse<TRemoteItem>,
) => Promise<
  LoadResponse<TRemoteItem & { [LOCAL_PATH_COLUMN_NAME]: string | null }>
> {
  return async (remoteItems) => {
    const downloadFile = async (item: TRemoteItem) => {
      const path = item[columnName];
      if (path) {
        // Avoid re-downloading files are already present locally
        if (await localDirectory.exists(path)) {
          return path;
        }
        const { data, error } = await supabase.storage
          .from(bucketName)
          .download(path);
        if (error) {
          // eslint-disable-next-line no-console
          console.error("Error downloading file from Supabase", error);
          return null;
        }
        const arrayBuffer = await data.arrayBuffer();
        await localDirectory.save(path, arrayBuffer);
        return path;
      }
      return null;
    };

    const downloadAndConstructLocalItem = async (item: TRemoteItem) => {
      return { ...item, [LOCAL_PATH_COLUMN_NAME]: await downloadFile(item) };
    };

    const getAllPaths: (items: TRemoteItem[]) => Set<string> = (items) =>
      new Set(
        items.map((item) => item[columnName]).filter((path) => path !== null),
      );

    if (remoteItems.items) {
      // Diff local directory with remote items
      const savedPaths = await localDirectory.listDirectory();

      const pendingLocalChanges = getPendingLocalChanges();
      const stateAfterChanges = applyChanges<
        TRemoteItem & { [LOCAL_PATH_COLUMN_NAME]: string | null },
        TIdType
      >(
        remoteItems.items.map((item) => ({
          ...item,
          [LOCAL_PATH_COLUMN_NAME]: item[columnName],
        })),
        pendingLocalChanges,
      );
      const allReferencedPathsAfterChanges: string[] = stateAfterChanges
        .map((item) => item[LOCAL_PATH_COLUMN_NAME])
        .filter((path) => path !== null);
      const referencedPathsAfterChangesSet = new Set(
        allReferencedPathsAfterChanges,
      );

      // Delete local files that are not present remotely anymore
      const pathsToDelete = savedPaths.filter(
        (localPath) => !referencedPathsAfterChangesSet.has(localPath),
      );

      const deletePromises = pathsToDelete.map(
        localDirectory.remove.bind(localDirectory),
      );
      const addPromises = remoteItems.items.map(downloadAndConstructLocalItem);

      const [, items] = await Promise.all([
        Promise.all(deletePromises),
        Promise.all(addPromises),
      ]);

      return {
        items,
      };
    } else {
      // Find added / deleted paths
      const explicitlyDeletedPaths = getAllPaths(remoteItems.changes.removed);
      const explicitlyAddedPaths = getAllPaths(remoteItems.changes.added);
      const modifiedPreviousPaths = new Set(
        remoteItems.changes.modified
          .map((item) => getLocalPath(item.id))
          .filter((path) => path != null),
      );
      const modifiedNewPaths = getAllPaths(remoteItems.changes.modified);

      const allAddedPaths = explicitlyAddedPaths.union(modifiedNewPaths);
      const allDeletedPaths = explicitlyDeletedPaths.union(
        modifiedPreviousPaths,
      );

      // Paths that we know for sure are present locally after applyig the changes
      const securedPathsAfterChanges = allAddedPaths;

      // Paths that might have been removed locally
      const potentiallyDeletedPaths = allDeletedPaths.difference(
        securedPathsAfterChanges,
      );
      const trulyDeletedPaths = new Set<string>();

      // Find references to potentially deleted paths
      const potentiallyDeletedPathsWithPreviousReferences = new Map<
        string,
        Set<TIdType>
      >();
      potentiallyDeletedPaths.forEach((path) => {
        if (path) {
          addToMapOfSets(
            potentiallyDeletedPathsWithPreviousReferences,
            path,
            getLocalReferences(path),
          );
        }
      });

      // Analyze whether all references get invalidated with the changes
      potentiallyDeletedPathsWithPreviousReferences.forEach(
        (previousReferences, path) => {
          const explicitlyDeletedReferences = new Set(
            remoteItems.changes.removed
              .filter((item) => item[columnName] === path)
              .map((item) => item.id),
          );
          const modifiedAwayReferences = new Set(
            remoteItems.changes.modified
              .map((item) => (getLocalPath(item.id) === path ? item.id : null))
              .filter((id) => id !== null),
          );

          const remainingReferences = previousReferences.difference(
            explicitlyDeletedReferences.union(modifiedAwayReferences),
          );

          if (remainingReferences.size === 0) {
            // If no references remain, we can remove the file locally
            trulyDeletedPaths.add(path);
          }
        },
      );

      const [, updatedAdded, updatedModified, updatedRemoved] =
        await Promise.all([
          Promise.all(
            [...trulyDeletedPaths].map(
              localDirectory.remove.bind(localDirectory),
            ),
          ),
          Promise.all(
            remoteItems.changes.added.map(downloadAndConstructLocalItem),
          ),
          Promise.all(
            remoteItems.changes.modified.map(downloadAndConstructLocalItem),
          ),
          Promise.all(
            remoteItems.changes.removed.map(async (item) => {
              const localPath = getLocalPath(item.id);
              return { ...item, [LOCAL_PATH_COLUMN_NAME]: localPath };
            }),
          ),
        ]);

      return {
        changes: {
          added: updatedAdded,
          modified: updatedModified,
          removed: updatedRemoved,
        },
      };
    }
  };
}

/**
 *
 * @param bucketName
 * @param remoteColumnName
 * @param supabase
 * @param getLocalReferences
 * @param localDirectory
 * @param localDirectory.load
 * @param getMimeType
 */
export function createPushFiles<
  TPathColumn extends Exclude<string, LocalPathColumnName>,
  TIdType,
  TRemoteItem,
>(
  bucketName: string,
  remoteColumnName: TPathColumn,
  supabase: SupabaseClient,
  getLocalReferences: (path: string) => Set<TIdType>,
  localDirectory: LocalDirectoryForRead,
  getMimeType?: (path: string) => string,
): (
  changeset: Parameters<
    ConstructorParameters<
      typeof SyncManager<
        any,
        Omit<TRemoteItem, TPathColumn> & {
          [key in TPathColumn]: string | null;
        } & {
          [LOCAL_PATH_COLUMN_NAME]: string | null;
        } & BaseItem<TIdType>,
        TIdType
      >
    >[0]["push"]
  >[1],
) => Promise<
  PushSecondParameter<
    Omit<TRemoteItem, TPathColumn> & {
      [key in TPathColumn]: string | null;
    } & BaseItem<TIdType>,
    TIdType
  >
> {
  return async ({ changes, rawChanges }) => {
    // Files that have not been referenced before the changes, but are referenced after the changes
    const filesToUpload = new Set<string>();

    // Files that are no longer referenced after the changes
    const filesToDelete = new Set<string>();

    const getAllLocalPaths: (
      items: (Omit<TRemoteItem, TPathColumn> & {
        [LOCAL_PATH_COLUMN_NAME]: string | null;
      })[],
    ) => Set<string> = (items) =>
      new Set(
        items
          .map((item) => item[LOCAL_PATH_COLUMN_NAME])
          .filter((path) => path !== null),
      );

    const fileModifiedItems = changes.modified.filter((item) =>
      changes.modifiedFields.get(item.id)?.includes(LOCAL_PATH_COLUMN_NAME),
    );

    // Find added / deleted paths
    const explicitlyDeletedPaths = getAllLocalPaths(changes.removed);
    const explicitlyAddedPaths = getAllLocalPaths(changes.added);
    const modifiedPreviousPaths = new Set(
      fileModifiedItems
        // The remote column should be untouched
        .map((item) => item[remoteColumnName]),
    );
    const modifiedNewPaths = getAllLocalPaths(fileModifiedItems);

    // All paths that have been added in this changeset, with their references
    const allUpdatedPathsWithReferences = new Map<string, Set<TIdType>>();
    fileModifiedItems.forEach((item) => {
      addToMapOfSets(
        allUpdatedPathsWithReferences,
        item[LOCAL_PATH_COLUMN_NAME],
        item.id,
      );
    });
    changes.added.forEach((item) => {
      addToMapOfSets(
        allUpdatedPathsWithReferences,
        item[LOCAL_PATH_COLUMN_NAME],
        item.id,
      );
    });

    const allUpdatedPaths = explicitlyAddedPaths.union(modifiedNewPaths);
    const allOutdatedPaths = explicitlyDeletedPaths.union(
      modifiedPreviousPaths,
    );

    // Paths that we know for sure are present locally after applying the changes
    const securedPathsAfterChanges = allUpdatedPaths;

    // Paths that might have been removed locally
    const potentiallyDeletedPaths = allOutdatedPaths.difference(
      securedPathsAfterChanges,
    );

    potentiallyDeletedPaths.forEach(
      // If it's not referenced anymore at all after the changes, we can delete it
      (path) => getLocalReferences(path).size === 0 && filesToDelete.add(path),
    );

    allUpdatedPathsWithReferences.forEach((newReferences, path) => {
      const referencesAfterChanges = getLocalReferences(path);

      // If all references to the path are new, it is a new file that needs to be uploaded
      if (
        referencesAfterChanges.size > 0 &&
        referencesAfterChanges.isSubsetOf(newReferences)
      ) {
        filesToUpload.add(path);
      }
    });

    const uploadPromises = [...filesToUpload].map(async (path) => {
      const data = await localDirectory.load(path);
      const { error } = await supabase.storage
        .from(bucketName)
        .upload(path, data, {
          ...(getMimeType ? { contentType: getMimeType(path) } : {}),
        });
      if (error) {
        // eslint-disable-next-line no-console
        console.error("Error uploading file to Supabase", error);
      }
    });
    const deletePromises = [...filesToDelete].map(async (path) => {
      const { error } = await supabase.storage.from(bucketName).remove([path]);
      if (error) {
        // eslint-disable-next-line no-console
        console.error("Error deleting file from Supabase", error);
      }
    });

    await Promise.all([...uploadPromises, ...deletePromises]);

    const movePathsFromLocalToRemote = (
      items: typeof changes.added,
    ): (Omit<TRemoteItem, TPathColumn> & {
      [key in TPathColumn]: string | null;
    } & BaseItem<TIdType>)[] => {
      return items.map((item) => {
        const result: Omit<TRemoteItem, TPathColumn> & {
          [key in TPathColumn]: string | null;
        } & BaseItem<TIdType> = {
          ...item,
          [remoteColumnName]: item[LOCAL_PATH_COLUMN_NAME],
        };
        delete result[LOCAL_PATH_COLUMN_NAME];
        return result;
      });
    };

    const pathMovedModifiedFields = new Map<TIdType, string[]>();
    for (const [id, modifiedFields] of changes.modifiedFields.entries()) {
      // Replace changes to the local path column with changes to the remote column
      pathMovedModifiedFields.set(
        id,
        modifiedFields.map((field) =>
          field === LOCAL_PATH_COLUMN_NAME ? remoteColumnName : field,
        ),
      );
    }

    return {
      changes: {
        added: movePathsFromLocalToRemote(changes.added),
        modified: movePathsFromLocalToRemote(changes.modified),
        removed: movePathsFromLocalToRemote(changes.removed),
        modifiedFields: pathMovedModifiedFields,
      },
      rawChanges: rawChanges.map((rawChange) => {
        if (rawChange.type === "insert") {
          const { [LOCAL_PATH_COLUMN_NAME]: localPath, ...restData } =
            rawChange.data;
          return {
            ...rawChange,
            data: {
              ...restData,
              [remoteColumnName]: localPath,
            },
          };
        } else {
          return rawChange;
        }
      }),
    };
  };
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
