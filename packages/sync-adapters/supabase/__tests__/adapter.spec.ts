import type { EventEmitter } from '@signaldb/core'
import { it, expect } from 'vitest'
import { Collection } from '@signaldb/core'
import { createClient } from '@supabase/supabase-js'
import type SyncManager from '@signaldb/sync/SyncManager'
import type { TableWithFieldName } from '../src'
import { baseSelectFromSupabase, createDeletedModifiedTrackingPusher, createPushMethods, createSimplePusher, executeSelectFromSupabase, filterOutDeletedFromSupabase, filterOutUnmodifiedFromSupabase, postProcessChangesPull, postProcessFullPull } from '../src'

interface Database {
  public: {
    Tables: {
      todos: {
        Row: {
          completed: boolean | null,
          created_at: string,
          _modified: string,
          _deleted: boolean,
          id: string,
          text: string | null,
        },
        Insert: {
          completed?: boolean | null,
          created_at?: string,
          _modified?: string,
          _deleted?: boolean,
          id?: string,
          text?: string | null,
        },
        Update: {
          completed?: boolean | null,
          created_at?: string,
          _modified?: string,
          _deleted?: boolean,
          id?: string,
          text?: string | null,
        },
        Relationships: [],
      },
    },
    Views: {
      [_ in never]: never
    },
    Functions: {
      [_ in never]: never
    },
    Enums: {
      [_ in never]: never
    },
    CompositeTypes: {
      [_ in never]: never
    },
  },
}

const supabase = createClient<Database>(
  'https://jjgysyutehjldurguojg.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpqZ3lzeXV0ZWhqbGR1cmd1b2pnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MDEyNzU5NTAsImV4cCI6MjAxNjg1MTk1MH0.iW9GSzCpGbIPuE9zIw3shkzj-kmisIrVXGsrYiMiaCk',
)

/**
 * Waits for a specific event to be emitted.
 * @template T
 * @param emitter - The event emitter instance.
 * @param event - The name of the event to wait for.
 * @param [timeout] - Optional timeout in milliseconds.
 * @returns A promise that resolves with the event value.
 */
async function waitForEvent<T>(
  emitter: EventEmitter<any>,
  event: string,
  timeout?: number,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = timeout && setTimeout(() => {
      reject(new Error('waitForEvent timeout'))
    }, timeout)

    emitter.once(event, (value: T) => {
      if (timeoutId) clearTimeout(timeoutId)
      resolve(value)
    })
  })
}

type bruh = TableWithFieldName<Database, 'public', { _modified: string }>
type RowType = Database['public']['Tables']['todos']['Row']

it('Typing', { retry: 5 }, async () => {
  const baseSelect = baseSelectFromSupabase(supabase, 'public', 'todos')
  const modifiedSelect = filterOutUnmodifiedFromSupabase<Database, 'public', 'todos'>(baseSelect)
  const rawPull = executeSelectFromSupabase<Database, 'public', 'todos'>(modifiedSelect)
  const fullPull: ConstructorParameters<typeof SyncManager<any, RowType>>[0]['pull']
    = postProcessChangesPull(rawPull)

  const bruhPull: ConstructorParameters<typeof SyncManager<any, RowType>>[0]['pull']
    = postProcessFullPull(executeSelectFromSupabase<Database, 'public', 'todos'>(baseSelectFromSupabase(supabase, 'public', 'todos')))

  const table = supabase.schema('public').from('todos')

  const bobResult = createPushMethods<RowType>(table)

  const pusher = createSimplePusher<RowType>(createPushMethods<RowType>(table))
  const anotherPusher = createDeletedModifiedTrackingPusher<RowType>(
    createPushMethods<RowType>(table))
})
