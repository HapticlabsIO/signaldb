import * as fsp from 'fs/promises'
import path from 'path'
import { tmpdir } from 'os'
import { Collection } from '@signaldb/core'
import { it, expect, beforeAll, describe, afterAll, beforeEach, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type SyncManager from '@signaldb/sync/SyncManager'
import type { LocalDirectoryForRead, LocalDirectoryForWrite } from '../src'
import { createAddLocalId, baseSelectFromSupabase, createPushMethods, createSimplePusher, createSupabaseSyncManager, executeSelectFromSupabase, postProcessFullPull, removeLocalId, createLocalId, startListeningToTableChanges, createPushFiles, createPullFiles } from '../src'
import type { Database } from './supabase'
import { EXPO_PUBLIC_SUPABASE_ANON_KEY, EXPO_PUBLIC_SUPABASE_URL, SUPABASE_TESTER_EMAIL, SUPABASE_TESTER_PASSWORD } from './supabaseSecrets'

const supabase = createClient<Database>(
  EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY)

type TestRowType = Omit<Database['public']['Tables']['members']['Row'], '_modified' | '_deleted'>
type LocalTestRowType = TestRowType & { id: string }

type UserRowType = Database['public']['Tables']['users']['Row']
type LocalUserRow = UserRowType & { _localPath: string | null }

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

  const { error: memberError } = await supabase.from('members').insert(newMember)

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

describe('sync with files', () => {
  let userCollection: Collection<LocalUserRow>
  const realPull = postProcessFullPull(executeSelectFromSupabase<Database, 'public', 'users'>(baseSelectFromSupabase<Database, 'public', 'users'>(supabase, 'public', 'users')))
  const realPush = createSimplePusher<UserRowType, LocalUserRow['id']>(createPushMethods<UserRowType>(supabase.schema('public').from('users')))

  let temporaryDirectory: string

  const localDirectoryForWrite: LocalDirectoryForWrite = {
    save: async (fileName, data) => {
      const fullFilePath = path.join(temporaryDirectory, fileName)
      // Create the directory if it doesn't exist
      await fsp.mkdir(path.dirname(fullFilePath), { recursive: true })
      await fsp.writeFile(fullFilePath, new Uint8Array(data))
    },
    exists: async (fileName) => {
      return await fsp.access(path.join(temporaryDirectory, fileName))
        .then(() => true).catch(() => false)
    },
    listDirectory: async () => {
      const items = await fsp.readdir(
        temporaryDirectory,
        { recursive: true, withFileTypes: true }).then(entities => entities
        .filter(item => item.isFile()))

      // Get the paths relative to the temporary directory
      const relativePaths = items.map(item =>
        path.relative(temporaryDirectory, path.join(item.parentPath, item.name)))
      return relativePaths
    },
    remove: async (fileName) => {
      await fsp.rm(path.join(temporaryDirectory, fileName))
    },
  }
  const localDirectoryForRead: LocalDirectoryForRead = {
    load: async (fileName) => {
      const data = await fsp.readFile(path.join(temporaryDirectory, fileName))
      return data.buffer
    },
  }

  let supabaseSyncer: SyncManager<any, LocalUserRow, LocalUserRow['id']>
  let userData: { user: { id: string } }

  beforeAll(async () => {
    const { data, error: signinError } = await supabase.auth.signInWithPassword({
      email: SUPABASE_TESTER_EMAIL,
      password: SUPABASE_TESTER_PASSWORD,
    })

    if (signinError) {
      throw signinError
    }
    userData = data
  })

  afterAll(async () => {
    await supabase.auth.signOut()
  })

  beforeEach(async () => {
    userCollection = new Collection<LocalUserRow>({ name: 'users' })
    temporaryDirectory = await fsp.mkdtemp(path.join(tmpdir(), 'WOWO'))

    supabaseSyncer = createSupabaseSyncManager<LocalUserRow, LocalUserRow['id'], UserRowType>(undefined)
    supabaseSyncer.addCollection(userCollection as any, {
      name: 'users',
      pull: realPull,
      push: realPush,
      beforeUpload: createPushFiles<'profile_picture_path', LocalUserRow['id'], UserRowType>(
        'profile_picture', 'profile_picture_path', supabase,
        (filePath: string) =>
          new Set(userCollection.find({ _localPath: filePath }).fetch().map(item => item.id)),
        localDirectoryForRead,
        (fileName) => {
          const extension = fileName.split('.').pop()
          switch (extension) {
            case 'png': {
              return 'image/png'
            }
            case 'jpg':
            case 'jpeg': {
              return 'image/jpeg'
            }
            default: {
              return 'text/plain'
            }
          }
        },
      ),
      afterDownload: createPullFiles<'profile_picture_path', LocalUserRow['id'], UserRowType>(
        'profile_picture', 'profile_picture_path', supabase,
        () => supabaseSyncer.getPendingLocalChanges('users').fetch(),
        (filePath: string) =>
          new Set(userCollection.find({ _localPath: filePath }).fetch().map(item => item.id)),
        (id: LocalUserRow['id']) => {
          const item = userCollection.findOne({ id })
          return item ? item._localPath : null
        },
        localDirectoryForWrite,
      ),
      startListening: startListeningToTableChanges(supabase, 'public', 'users', {
        id: '',
        name: '',
        profile_picture_path: null,
        username: '',
      }),
    })

    await supabaseSyncer.sync('users')
  }, 60_000)

  afterEach(async () => {
    temporaryDirectory = ''
    await supabaseSyncer.dispose()
    await userCollection.dispose()
  })

  afterAll(async () => {
    await fsp.rm(temporaryDirectory, { recursive: true, force: true })
  })

  it('sync supabase -> local with files', async () => {
    const initialCount = userCollection.find().count()
    expect(initialCount).toBeGreaterThanOrEqual(1)

    // Ensure that the number of images matches the number of items that have a profile picture path
    const itemsWithProfilePicture = userCollection.find(
      { profile_picture_path: { $ne: null } }).fetch()
    await Promise.all(itemsWithProfilePicture.map(async (item) => {
      if (!item._localPath) {
        throw new Error('expected path here after that filter')
      }
      await expect(localDirectoryForWrite.exists(item._localPath)).resolves.toBe(true)
    }))

    expect(itemsWithProfilePicture.length)
      .toBe(await localDirectoryForWrite.listDirectory().then(files => files.length))

    // Update Supabase: delete own user
    const { error: deleteError } = await supabase.from('users').delete().eq('id', userData.user.id)

    if (deleteError) {
      throw deleteError
    }

    await supabaseSyncer.sync('users')

    // Ensure local deletion
    const deletedLocalUser = userCollection.findOne({ id: userData.user.id })
    expect(deletedLocalUser).toBeUndefined()

    // Create own user with a profile picture
    const testPicturePath = path.join(__dirname, './res/icon.png')
    const { data: uploadData, error: uploadError }
      = await supabase.storage.from('profile_picture')
        .upload(`${userData.user.id}/goodPic.png`, await fsp.readFile(testPicturePath), {
          contentType: 'image/png',
        })
    if (uploadError) {
      throw uploadError
    }
    const { error: insertError } = await supabase.from('users').insert({
      id: userData.user.id,
      name: 'Tester',
      profile_picture_path: uploadData.path,
      username: 'tester',
    })
    if (insertError) {
      throw insertError
    }

    await supabaseSyncer.sync('users')

    // Ensure local creation with correct _localPath
    const localUser = userCollection.findOne({ id: userData.user.id })
    expect(localUser).toEqual(expect.objectContaining({
      id: userData.user.id,
      name: 'Tester',
      _localPath: uploadData.path,
      username: 'tester',
    }))

    // Ensure that the profile picture got downloaded to the correct path
    if (!localUser?._localPath) {
      throw new Error('expected path here')
    }
    await expect(localDirectoryForWrite.exists(localUser._localPath)).resolves.toBe(true)

    // Ensure that the content of the downloaded file matches the uploaded file
    const downloadedData = await localDirectoryForRead.load(localUser._localPath)
    const originalData = await fsp.readFile(testPicturePath)
    expect(new Uint8Array(downloadedData)).toEqual(new Uint8Array(originalData))

    // Update the profile picture path to null in Supabase
    const { error: updateError } = await supabase.from('users').update({
      profile_picture_path: null,
    }).eq('id', userData.user.id)
    if (updateError) {
      throw updateError
    }

    await supabaseSyncer.sync('users')

    // Ensure local update: profile picture path should be null and the file should be deleted
    const updatedLocalUser = userCollection.findOne({ id: userData.user.id })
    expect(updatedLocalUser).toEqual(expect.objectContaining({
      id: userData.user.id,
      name: 'Tester',
      _localPath: null,
      username: 'tester',
    }))
    await expect(localDirectoryForWrite.exists(uploadData.path)).resolves.toBe(false)

    const { error: updateError2 } = await supabase.from('users').update({
      profile_picture_path: uploadData.path,
    }).eq('id', userData.user.id)
    if (updateError2) {
      throw updateError2
    }

    await supabaseSyncer.sync('users')

    // Ensure local update: _localPath should be updated and the new file should exist
    const updatedLocalUser2 = userCollection.findOne({ id: userData.user.id })
    expect(updatedLocalUser2).toEqual(expect.objectContaining({
      id: userData.user.id,
      name: 'Tester',
      _localPath: uploadData.path,
      username: 'tester',
    }))
    await expect(localDirectoryForWrite.exists(uploadData.path)).resolves.toBe(true)

    // Delete the user again
    const { error: finalDeleteError } = await supabase.from('users').delete().eq('id', userData.user.id)
    if (finalDeleteError) {
      throw finalDeleteError
    }

    // Also delete the file
    const { error: finalDeleteFileError } = await supabase.storage.from('profile_picture').remove([uploadData.path])
    if (finalDeleteFileError) {
      throw finalDeleteFileError
    }

    await supabaseSyncer.sync('users')

    // Ensure local deletion again
    const finalDeletedLocalUser = userCollection.findOne({ id: userData.user.id })
    expect(finalDeletedLocalUser).toBeUndefined()

    // Ensure that the file got deleted
    await expect(localDirectoryForWrite.exists(uploadData.path)).resolves.toBe(false)

    // Create the user again without a profile picture
    const { error: insertError2 } = await supabase.from('users').insert({
      id: userData.user.id,
      name: 'Tester',
      profile_picture_path: null,
      username: 'tester',
    })
    if (insertError2) {
      throw insertError2
    }

    await supabaseSyncer.sync('users')
  }, 120_000)

  it('sync local -> supabase with files', async () => {
    // Delete user locally if it exists
    const existingLocalUser = userCollection.findOne({ id: userData.user.id })
    if (existingLocalUser) {
      userCollection.removeOne({ id: userData.user.id })
    }

    await supabaseSyncer.sync('users')

    // Ensure user is deleted in Supabase
    const { error: memberError } = await supabase.from('users').select('*').eq('id', userData.user.id).single()

    expect (memberError?.code).toBe('PGRST116') // no rows found

    const testPicturePath = path.join(__dirname, './res/icon.png')
    const targetFilename = path.join(userData.user.id, 'goodPic.png')
    await localDirectoryForWrite.save(targetFilename,
      await fsp.readFile(testPicturePath).then(buffer => buffer.buffer))

    // Insert user locally with a profile picture path
    const newLocalUser: LocalUserRow = {
      id: userData.user.id,
      name: 'Tester',
      _localPath: targetFilename,
      username: 'tester',
      profile_picture_path: null,
    }

    expect(userCollection.insert(newLocalUser)).toBe(newLocalUser.id)
    await supabaseSyncer.sync('users')

    // Ensure that the user got created in Supabase with the correct profile picture path
    const { data: memberData2, error: memberError2 } = await supabase.from('users').select('*').eq('id', userData.user.id).single()

    if (memberError2) {
      throw memberError2
    }

    expect(memberData2).toEqual(expect.objectContaining({
      id: newLocalUser.id,
      name: newLocalUser.name,
      profile_picture_path: targetFilename,
      username: newLocalUser.username,
    }))

    // Ensure that the file got uploaded to Supabase storage
    const { data: downloadData, error: downloadError } = await supabase.storage.from('profile_picture').download(targetFilename)
    if (downloadError) {
      throw downloadError
    }
    const originalData = await fsp.readFile(testPicturePath)
    const downloadedArrayBuffer = await downloadData.arrayBuffer()
    expect(new Uint8Array(downloadedArrayBuffer)).toEqual(new Uint8Array(originalData))

    // Update the user locally to have a null profile picture path
    expect(userCollection.updateOne(
      { id: newLocalUser.id }, { $set: { _localPath: null } })).toBe(1)

    await supabaseSyncer.sync('users')

    // Ensure that the profile picture path got updated to null in Supabase
    const { data: memberData3, error: memberError3 } = await supabase.from('users').select('*').eq('id', userData.user.id).single()

    if (memberError3) {
      throw memberError3
    }

    expect(memberData3).toEqual(expect.objectContaining({
      id: newLocalUser.id,
      name: newLocalUser.name,
      profile_picture_path: null,
      username: newLocalUser.username,
    }))

    // Ensure that the file got deleted from Supabase storage
    const { data: existenceData2 } = await supabase.storage.from('profile_picture').exists(targetFilename)
    expect(existenceData2).toBe(false)

    // Recreate the local file
    await localDirectoryForWrite.save(targetFilename,
      await fsp.readFile(testPicturePath).then(buffer => buffer.buffer))
    // Update the user locally to have a profile picture path again
    expect(userCollection.updateOne(
      { id: newLocalUser.id }, { $set: { _localPath: targetFilename } })).toBe(1)

    await supabaseSyncer.sync('users')

    // Ensure that the profile picture path got updated in Supabase again
    const { data: memberData4, error: memberError4 } = await supabase.from('users').select('*').eq('id', userData.user.id).single()

    if (memberError4) {
      throw memberError4
    }

    expect(memberData4).toEqual(expect.objectContaining({
      id: newLocalUser.id,
      name: newLocalUser.name,
      profile_picture_path: targetFilename,
      username: newLocalUser.username,
    }))

    // Ensure that the file got uploaded to Supabase storage again
    const { data: downloadData3, error: downloadError3 } = await supabase.storage.from('profile_picture').download(targetFilename)
    if (downloadError3) {
      throw downloadError3
    }
    const downloadedArrayBuffer2 = await downloadData3.arrayBuffer()
    expect(new Uint8Array(downloadedArrayBuffer2)).toEqual(new Uint8Array(originalData))

    // Delete the user locally again
    expect(userCollection.removeOne({ id: newLocalUser.id })).toBe(1)

    await supabaseSyncer.sync('users')

    // Ensure that the user got deleted in Supabase
    const { error: memberError5 } = await supabase.from('users').select('*').eq('id', userData.user.id).single()

    expect (memberError5?.code).toBe('PGRST116') // no rows found

    // Ensure that the file got deleted from Supabase storage
    const { data: existenceData3 } = await supabase.storage.from('profile_picture').exists(targetFilename)
    expect(existenceData3).toBe(false)

    // Ensure that the user is present in Supabase for other tests
    expect(userCollection.insert({
      ...newLocalUser,
      _localPath: null,
    })).toBe(newLocalUser.id)
    await supabaseSyncer.sync('users')

    const { data: memberData6, error: memberError6 } = await supabase.from('users').select('*').eq('id', userData.user.id).single()

    if (memberError6) {
      throw memberError6
    }

    expect(memberData6).toEqual(expect.objectContaining({
      id: newLocalUser.id,
      name: newLocalUser.name,
      profile_picture_path: null,
      username: newLocalUser.username,
    }))
  }, 120_000)
})
