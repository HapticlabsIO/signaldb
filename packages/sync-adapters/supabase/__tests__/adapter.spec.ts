import { Collection, type EventEmitter } from '@signaldb/core'
import { it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@supabase/supabase-js'
import type SyncManager from '@signaldb/sync/SyncManager'
import type { TableWithFieldName } from '../src'
import { baseSelectFromSupabase, createDeletedModifiedTrackingPusher, createPushMethods, createSimplePusher, createSupabaseSyncManager, executeSelectFromSupabase, filterOutDeletedFromSupabase, filterOutUnmodifiedFromSupabase, postProcessChangesPull, postProcessFullPull } from '../src'
import type { Database } from './supabase'
import { EXPO_PUBLIC_SUPABASE_ANON_KEY, EXPO_PUBLIC_SUPABASE_URL } from './supabaseSecrets'

const supabase = createClient<Database>(
  EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY)

type TestRowType = Database['public']['Tables']['members']['Row']
type LocalTestRowType = Omit<TestRowType, '_modified' | '_deleted'>

type RealRowType = Database['public']['Tables']['localities']['Row']
type LocalRealRowType = RealRowType

it('Typing', { retry: 5 }, async () => {
  // const baseSelect = baseSelectFromSupabase(supabase, 'public', 'members')
  // const modifiedSelect = filterOutUnmodifiedFromSupabase<Database, 'public', 'members'>(baseSelect)
  // const rawPull = executeSelectFromSupabase<Database, 'public', 'members'>(modifiedSelect)
  // const fullPull: ConstructorParameters<typeof SyncManager<any, LocalTestRowType>>[0]['pull']
  //   = postProcessChangesPull(rawPull)

  // const bruhPull: ConstructorParameters<typeof SyncManager<any, LocalTestRowType>>[0]['pull']
  //   = postProcessFullPull(executeSelectFromSupabase<TestDatabase, 'public', 'todos'>(baseSelectFromSupabase(supabase, 'public', 'todos')))

  // const table = supabase.schema('public').from('todos')

  // const bobResult = createPushMethods<TestRowType>(table)

  // const pusher = createSimplePusher<TestRowType>(createPushMethods<TestRowType>(table))
  // const anotherPusher = createDeletedModifiedTrackingPusher<TestRowType>(
  //   createPushMethods<TestRowType>(table))

  const realPull = postProcessFullPull(executeSelectFromSupabase<Database, 'public', 'localities'>(baseSelectFromSupabase<Database, 'public', 'localities'>(supabase, 'public', 'localities')))
  const realPush = createSimplePusher<RealRowType>(createPushMethods<RealRowType>(supabase.schema('public').from('localities')))

  const bruhMoment = createSupabaseSyncManager(undefined)
  const goodCollection: Collection = new Collection({ name: 'WOW' })
  bruhMoment.addCollection(goodCollection, {
    name: 'localities',
    pull: realPull,
    push: realPush,
    beforeUpload: changes => changes,
    afterDownload: changes => changes,
  })

  await bruhMoment.sync('localities')

  expect(goodCollection.find().count()).toBeGreaterThanOrEqual(800)
})
