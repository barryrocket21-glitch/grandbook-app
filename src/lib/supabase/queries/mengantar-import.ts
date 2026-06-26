// =============================================================
// Sync Status Mengantar — RPC wrappers (preview/apply). Order Mengantar/JNE UDAH
// ADA di orders_draft (resi NULL); nomor GB gak balik di export Mengantar →
// match by HP(9 digit)+produk → set tracking_no+status+channel JNE. mig 138.
// =============================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ParsedMengantarOrder } from '@/lib/recon/mengantar-parser'

export interface MengantarSyncMatch {
  order_id: number
  order_number: string
  customer_name: string
  resi: string
  old_status: string
  new_status: string
  last_status: string
  shipping_net: number
}

export interface MengantarSyncPreview {
  batch_id: number
  total_rows: number
  matched: number
  ambiguous: number
  unmatched: number
  status_changes: number
  preview_data: { matched: MengantarSyncMatch[]; ambiguous: unknown[]; unmatched: unknown[] }
}

export async function previewMengantarStatusSync(
  supabase: SupabaseClient,
  rows: ParsedMengantarOrder[],
  fileName: string,
  fileSize: number
): Promise<MengantarSyncPreview> {
  const { data, error } = await supabase.rpc('preview_mengantar_status_sync', {
    p_rows: rows,
    p_file_name: fileName,
    p_file_size_bytes: fileSize,
  })
  if (error) throw error
  return data?.[0] as MengantarSyncPreview
}

export interface MengantarSyncResult {
  batch_id: number
  status: string
  updated: number
}

export async function applyMengantarStatusSync(
  supabase: SupabaseClient,
  batchId: number
): Promise<MengantarSyncResult> {
  const { data, error } = await supabase.rpc('apply_mengantar_status_sync', { p_batch_id: batchId })
  if (error) throw error
  return data?.[0] as MengantarSyncResult
}
