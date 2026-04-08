import { Collection, type EventEmitter } from '@signaldb/core'
import { it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@supabase/supabase-js'
import type SyncManager from '@signaldb/sync/SyncManager'
import type { TableWithFieldName } from '../src'
import { createAddLocalId, baseSelectFromSupabase, createDeletedModifiedTrackingPusher, createPushMethods, createSimplePusher, createSupabaseSyncManager, executeSelectFromSupabase, filterOutDeletedFromSupabase, filterOutUnmodifiedFromSupabase, postProcessChangesPull, postProcessFullPull, removeLocalId, createLocalId, startListeningToTableChanges } from '../src'
import type { Database } from './supabase'
import { EXPO_PUBLIC_SUPABASE_ANON_KEY, EXPO_PUBLIC_SUPABASE_URL, SUPABASE_TESTER_EMAIL, SUPABASE_TESTER_PASSWORD } from './supabaseSecrets'

const supabase = createClient<Database>(
  EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY)

type TestRowType = Omit<Database['public']['Tables']['members']['Row'], '_modified' | '_deleted'>
type LocalTestRowType = TestRowType & { id: string }

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
  const realPush = createSimplePusher<RealRowType, RealRowType['id']>(createPushMethods<RealRowType>(supabase.schema('public').from('localities')))

  const bruhMoment = createSupabaseSyncManager(undefined)
  const goodCollection: Collection = new Collection({ name: 'WOW' })
  bruhMoment.addCollection(goodCollection as any, {
    name: 'localities',
    pull: realPull,
    push: realPush,
    beforeUpload: changes => changes,
    afterDownload: changes => changes,
  })

  await bruhMoment.sync('localities')

  expect(goodCollection.find().count()).toBeGreaterThanOrEqual(800)
})

it('sync local -> supabase', async () => {
  const { data: userData, error: signinError } = await supabase.auth.signInWithPassword({
    email: SUPABASE_TESTER_EMAIL,
    password: SUPABASE_TESTER_PASSWORD,
  })

  if (signinError) {
    throw signinError
  }

  const memberCollection: Collection = new Collection<LocalTestRowType>({ name: 'members' })

  const realPull = postProcessFullPull(executeSelectFromSupabase<Database, 'public', 'members'>(baseSelectFromSupabase<Database, 'public', 'members'>(supabase, 'public', 'members')))
  const realPush = createSimplePusher<TestRowType, LocalTestRowType['id']>({
    insert: async item => supabase.from('members').insert(item),
    update: async item => supabase.from('members').update(item).eq('team_id', item.team_id).eq('user_id', item.user_id),
    upsert: async item => supabase.from('members').upsert(item),
    remove: async item => supabase.from('members').delete().eq('team_id', item.team_id).eq('user_id', item.user_id),
  })

  const bruhMoment = createSupabaseSyncManager<LocalTestRowType, LocalTestRowType['id'], TestRowType>(undefined)
  bruhMoment.addCollection(memberCollection as any, {
    name: 'members',
    pull: realPull,
    push: realPush,
    beforeUpload: removeLocalId<LocalTestRowType>,
    afterDownload: createAddLocalId(['team_id', 'user_id']),
  })

  await bruhMoment.sync('members')

  const initialCount = memberCollection.find().count()
  expect(initialCount).toBeGreaterThanOrEqual(1)

  const { data: teams, error: teamsError } = await supabase.from('teams').select('id').limit(initialCount + 2)
  if (teamsError) throw teamsError

  const teamWeAreNotAPartOf = teams.find(
    team => memberCollection.find({ team_id: team.id, user_id: userData.user.id }).count() === 0)

  if (!teamWeAreNotAPartOf) {
    throw new Error('Could not find a team we are not a part of, cannot run test')
  }

  const newMember: LocalTestRowType = {
    id: createLocalId({ team_id: teamWeAreNotAPartOf.id, user_id: userData.user.id }, ['team_id', 'user_id']),
    team_id: teamWeAreNotAPartOf.id,
    user_id: userData.user.id,
    status: 'member_requested',
    playing_position: 'Winner',
    created_at: new Date().toISOString(),
  }

  expect(memberCollection.insert(newMember)).toBe(newMember.id)

  await new Promise(resolve => setTimeout(resolve, 1000))

  const { data: memberData, error: memberError } = await supabase.from('members').select('*').eq('team_id', newMember.team_id).eq('user_id', newMember.user_id).single()

  if (memberError) {
    throw memberError
  }

  expect(memberData).toEqual(expect.objectContaining({
    team_id: newMember.team_id,
    user_id: newMember.user_id,
    status: newMember.status,
    playing_position: newMember.playing_position,
  }))

  expect(memberCollection.removeOne({ id: newMember.id })).toBe(1)

  await new Promise(resolve => setTimeout(resolve, 3000))

  const { data: memberData2, error: memberError2 } = await supabase.from('members').select('*').eq('team_id', newMember.team_id).eq('user_id', newMember.user_id).single()

  expect(memberData2).toBeNull()
  expect(memberError2).not.toBeNull()
}, 20_000)

it('sync supabase -> local', async () => {
  const { data: userData, error: signinError } = await supabase.auth.signInWithPassword({
    email: SUPABASE_TESTER_EMAIL,
    password: SUPABASE_TESTER_PASSWORD,
  })

  if (signinError) {
    throw signinError
  }

  const memberCollection: Collection = new Collection<LocalTestRowType>({ name: 'members' })

  const realPull = postProcessFullPull(executeSelectFromSupabase<Database, 'public', 'members'>(baseSelectFromSupabase<Database, 'public', 'members'>(supabase, 'public', 'members')))
  const realPush = createSimplePusher<TestRowType, LocalTestRowType['id']>({
    insert: async item => supabase.from('members').insert(item),
    update: async item => supabase.from('members').update(item).eq('team_id', item.team_id).eq('user_id', item.user_id),
    upsert: async item => supabase.from('members').upsert(item),
    remove: async item => supabase.from('members').delete().eq('team_id', item.team_id).eq('user_id', item.user_id),
  })

  const bruhMoment = createSupabaseSyncManager<LocalTestRowType, LocalTestRowType['id'], TestRowType>(undefined)
  bruhMoment.addCollection(memberCollection as any, {
    name: 'members',
    pull: realPull,
    push: realPush,
    beforeUpload: removeLocalId<LocalTestRowType>,
    afterDownload: createAddLocalId(['team_id', 'user_id']),
    startListening: startListeningToTableChanges(supabase, 'public', 'members', {
      team_id: '',
      user_id: '',
      status: 'member_requested',
      playing_position: '',
      created_at: '',
    }),
  })

  await bruhMoment.sync('members')

  const initialCount = memberCollection.find().count()
  expect(initialCount).toBeGreaterThanOrEqual(1)

  const { data: teams, error: teamsError } = await supabase.from('teams').select('id').limit(initialCount + 2)
  if (teamsError) throw teamsError

  const teamWeAreNotAPartOf = teams.find(
    team => memberCollection.find({ team_id: team.id, user_id: userData.user.id }).count() === 0)

  if (!teamWeAreNotAPartOf) {
    throw new Error('Could not find a team we are not a part of, cannot run test')
  }

  const newMemberId = createLocalId({ team_id: teamWeAreNotAPartOf.id, user_id: userData.user.id }, ['team_id', 'user_id'])
  const newMember: TestRowType = {
    team_id: teamWeAreNotAPartOf.id,
    user_id: userData.user.id,
    status: 'member_requested',
    playing_position: 'Winner',
    created_at: new Date().toISOString(),
  }

  const { data: memberData, error: memberError } = await supabase.from('members').insert(newMember)

  if (memberError) {
    throw memberError
  }

  await new Promise(resolve => setTimeout(resolve, 5000))

  const localMember = memberCollection.findOne({ id: newMemberId })
  expect(localMember).toEqual(expect.objectContaining({
    team_id: newMember.team_id,
    user_id: newMember.user_id,
    status: newMember.status,
    playing_position: newMember.playing_position,
  }))

  const { error: deleteError } = await supabase.from('members').delete().eq('team_id', newMember.team_id).eq('user_id', newMember.user_id)

  if (deleteError) {
    throw deleteError
  }

  await new Promise(resolve => setTimeout(resolve, 5000))

  const deletedLocalMember = memberCollection.findOne({ id: newMemberId })
  expect(deletedLocalMember).toBeUndefined()
}, 20_000)
