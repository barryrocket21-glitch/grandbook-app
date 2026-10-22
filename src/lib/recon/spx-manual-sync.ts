import type { SupabaseClient } from '@supabase/supabase-js'
import type { SyncRow } from './spx-status-sync'

export interface ManualSyncRow extends SyncRow { expected_updated_at: string }
export interface ManualSyncPlan {
  rows: ManualSyncRow[]
  matched: number
  skipped_no_ref: number
  skipped_no_match: number
}

export async function prepareManualSpxSync(supabase: Pick<SupabaseClient, 'rpc'>, rows: SyncRow[]): Promise<ManualSyncPlan> {
  const plan: ManualSyncPlan = { rows: [], matched: 0, skipped_no_ref: 0, skipped_no_match: 0 }
  const targets = new Set<string>()
  for (let offset = 0; offset < rows.length; offset += 150) {
    const chunk = rows.slice(offset, offset + 150)
    const { data, error } = await supabase.rpc('preview_spx_status_file', { p_rows: chunk })
    if (error) throw error
    if (!data || data.dry_run !== true || !Array.isArray(data.rows)
      || data.matched !== data.rows.length || !Number.isInteger(data.skipped_no_ref)
      || !Number.isInteger(data.skipped_no_match) || data.skipped_no_ref < 0 || data.skipped_no_match < 0
      || data.matched + data.skipped_no_ref + data.skipped_no_match !== chunk.length) {
      throw new Error('Hasil preview SPX tidak lengkap; muat ulang file.')
    }
    const indices = new Set<number>()
    for (const result of data.rows) {
      if (!Number.isInteger(result.index) || result.index < 0 || result.index >= chunk.length || indices.has(result.index)
        || !['orders', 'orders_draft'].includes(result.target_table) || !Number.isSafeInteger(result.target_id)
        || typeof result.expected_updated_at !== 'string' || !Number.isFinite(Date.parse(result.expected_updated_at))) {
        throw new Error('Versi order pada preview SPX tidak valid.')
      }
      indices.add(result.index)
      const target = `${result.target_table}:${result.target_id}`
      if (targets.has(target)) throw new Error('File memuat order yang sama lebih dari sekali; periksa baris duplikat.')
      targets.add(target)
      plan.rows.push({ ...chunk[result.index], expected_updated_at: result.expected_updated_at })
    }
    plan.matched += data.matched
    plan.skipped_no_ref += data.skipped_no_ref
    plan.skipped_no_match += data.skipped_no_match
  }
  return plan
}
