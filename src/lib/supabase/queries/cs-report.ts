// =============================================================
// Daily CS Report query helpers (Phase 6)
// =============================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DailyCsReport } from '@/lib/types'

export interface DailyCsReportWithProduct extends DailyCsReport {
  product?: {
    id: number
    name: string
    sku: string | null
    active: boolean
  } | null
}

export async function listReportForDay(
  supabase: SupabaseClient,
  args: { csId: string; date: string }
): Promise<DailyCsReportWithProduct[]> {
  const { data, error } = await supabase
    .from('daily_cs_report')
    .select(`
      *,
      product:products!daily_cs_report_product_id_fkey(id, name, sku, active)
    `)
    .eq('cs_id', args.csId)
    .eq('report_date', args.date)
    .order('product_id', { ascending: true })
  if (error) throw new Error(`listReportForDay: ${error.message}`)
  return (data || []) as DailyCsReportWithProduct[]
}

export async function listReportForRange(
  supabase: SupabaseClient,
  args: { csId?: string; from: string; to: string }
): Promise<DailyCsReportWithProduct[]> {
  let q = supabase
    .from('daily_cs_report')
    .select(`
      *,
      product:products!daily_cs_report_product_id_fkey(id, name, sku, active)
    `)
    .gte('report_date', args.from)
    .lte('report_date', args.to)
    .order('report_date', { ascending: false })
    .limit(2000)
  if (args.csId) q = q.eq('cs_id', args.csId)
  const { data, error } = await q
  if (error) throw new Error(`listReportForRange: ${error.message}`)
  return (data || []) as DailyCsReportWithProduct[]
}

export interface UpsertRowPayload {
  product_id: number
  lead_in: number
  closing: number
  notes: string | null
}

/**
 * Upsert batch — replace semua row CS+date dengan rows yang dikirim.
 * Pattern: pakai onConflict (org+date+cs+product) untuk UPDATE existing,
 * insert sisanya. Row product yang hilang dari payload TIDAK dihapus
 * (untuk preserve audit trail; user harus explicit delete).
 */
export async function upsertReportBatch(
  supabase: SupabaseClient,
  args: {
    orgId: number
    csId: string
    reportDate: string
    rows: UpsertRowPayload[]
    createdBy: string | null
  }
): Promise<{ upserted: number }> {
  if (args.rows.length === 0) return { upserted: 0 }
  const payload = args.rows.map(r => ({
    organization_id: args.orgId,
    cs_id: args.csId,
    report_date: args.reportDate,
    product_id: r.product_id,
    lead_in: r.lead_in,
    closing: r.closing,
    notes: r.notes,
    created_by: args.createdBy,
  }))
  const { data, error } = await supabase
    .from('daily_cs_report')
    .upsert(payload, {
      onConflict: 'organization_id,report_date,cs_id,product_id',
    })
    .select('id')
  if (error) throw new Error(`upsertReportBatch: ${error.message}`)
  return { upserted: (data || []).length }
}

export async function deleteReportRow(
  supabase: SupabaseClient,
  id: number
): Promise<void> {
  const { error } = await supabase.from('daily_cs_report').delete().eq('id', id)
  if (error) throw new Error(`deleteReportRow: ${error.message}`)
}

// ----- Summary RPC wrappers -----

export interface CsDailySummary {
  total_lead_in: number
  total_closing: number
  product_count: number
  close_rate: number
}

export async function fetchCsDailySummary(
  supabase: SupabaseClient,
  args: { csId: string; date: string }
): Promise<CsDailySummary> {
  const { data, error } = await supabase.rpc('cs_daily_summary', {
    p_cs_id: args.csId,
    p_date: args.date,
  })
  if (error) throw new Error(`cs_daily_summary: ${error.message}`)
  if (!data || data.length === 0) {
    return { total_lead_in: 0, total_closing: 0, product_count: 0, close_rate: 0 }
  }
  return data[0] as CsDailySummary
}

export interface CsPeriodSummary {
  total_lead_in: number
  total_closing: number
  product_count: number
  close_rate: number
  active_days: number
  avg_lead_per_day: number
}

export async function fetchCsPeriodSummary(
  supabase: SupabaseClient,
  args: { csId: string; from: string; to: string }
): Promise<CsPeriodSummary> {
  const { data, error } = await supabase.rpc('cs_period_summary', {
    p_cs_id: args.csId,
    p_from: args.from,
    p_to: args.to,
  })
  if (error) throw new Error(`cs_period_summary: ${error.message}`)
  if (!data || data.length === 0) {
    return {
      total_lead_in: 0, total_closing: 0, product_count: 0,
      close_rate: 0, active_days: 0, avg_lead_per_day: 0,
    }
  }
  return data[0] as CsPeriodSummary
}

export interface CsDailySeriesPoint {
  day: string
  total_lead_in: number
  total_closing: number
  close_rate: number
}

export async function fetchCsDailySeries(
  supabase: SupabaseClient,
  args: { csId: string; from: string; to: string }
): Promise<CsDailySeriesPoint[]> {
  const { data, error } = await supabase.rpc('cs_daily_series', {
    p_cs_id: args.csId,
    p_from: args.from,
    p_to: args.to,
  })
  if (error) throw new Error(`cs_daily_series: ${error.message}`)
  return (data || []) as CsDailySeriesPoint[]
}

// Yesterday date helper (untuk Copy from Yesterday)
export function yesterdayOf(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}
