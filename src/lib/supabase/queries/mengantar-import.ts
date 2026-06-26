// =============================================================
// Import Mengantar — RPC wrappers (preview/apply). Order Mengantar/JNE absen
// dari GrandBook → import jadi order baru (channel 2). Parser: mengantar-parser.
// =============================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ParsedMengantarOrder } from '@/lib/recon/mengantar-parser'

export interface MengantarPreviewRow {
  resi: string
  order_date: string
  customer_name: string
  customer_city: string | null
  product_raw: string
  product_id: number | null
  qty: number
  status: string
  cod: number
  shipping_net: number
  payout: number | null
  campaign_id: number | null
}

export interface MengantarPreview {
  batch_id: number
  total_rows: number
  to_create: number
  already_exists: number
  product_matched: number
  product_unmatched: number
  attribution_guessed: number
  preview_data: { to_create: MengantarPreviewRow[]; already_exists: unknown[] }
}

export async function previewMengantarImport(
  supabase: SupabaseClient,
  rows: ParsedMengantarOrder[],
  fileName: string,
  fileSize: number
): Promise<MengantarPreview> {
  const { data, error } = await supabase.rpc('preview_mengantar_import', {
    p_rows: rows,
    p_file_name: fileName,
    p_file_size_bytes: fileSize,
  })
  if (error) throw error
  return data?.[0] as MengantarPreview
}

export interface MengantarApplyResult {
  batch_id: number
  status: string
  created: number
  skipped_exists: number
}

export async function applyMengantarImport(
  supabase: SupabaseClient,
  batchId: number
): Promise<MengantarApplyResult> {
  const { data, error } = await supabase.rpc('apply_mengantar_import', { p_batch_id: batchId })
  if (error) throw error
  return data?.[0] as MengantarApplyResult
}
