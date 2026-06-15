// =============================================================
// Brief #2 — CRM query helpers + WA link builder
// =============================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CrmCase, CrmActivity, CrmProblemType, CrmStatus, CrmResolveOutcome } from '@/lib/types'
import { toCanonicalPhone } from './customers'

export interface ListCrmParams {
  problemType?: CrmProblemType | null
  crmStatus?: CrmStatus | null
  scope?: 'mine' | 'all'
  overdue?: boolean | null
  from?: string | null
  to?: string | null
  limit?: number
  offset?: number
}

export async function listCrmCases(
  supabase: SupabaseClient,
  p: ListCrmParams
): Promise<{ rows: CrmCase[]; total: number }> {
  const { data, error } = await supabase.rpc('list_crm_cases', {
    p_problem_type: p.problemType ?? null,
    p_crm_status: p.crmStatus ?? null,
    p_scope: p.scope ?? 'all',
    p_overdue: p.overdue ?? null,
    p_from: p.from ?? null,
    p_to: p.to ?? null,
    p_limit: p.limit ?? 100,
    p_offset: p.offset ?? 0,
  })
  if (error) throw new Error(error.message)
  const rows = (data || []) as CrmCase[]
  return { rows, total: rows[0]?.total_count ? Number(rows[0].total_count) : 0 }
}

export async function listCrmActivities(supabase: SupabaseClient, orderId: number): Promise<CrmActivity[]> {
  const { data, error } = await supabase
    .from('crm_activities')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data || []) as CrmActivity[]
}

export async function resolveCrmCase(
  supabase: SupabaseClient,
  orderId: number,
  source: 'draft' | 'final',
  outcome: CrmResolveOutcome,
  note?: string | null
): Promise<void> {
  const { error } = await supabase.rpc('resolve_crm_case', {
    p_order_id: orderId,
    p_source: source,
    p_outcome: outcome,
    p_note: note ?? null,
  })
  if (error) throw new Error(error.message)
}

/**
 * Link wa.me dari phone canonical (8xxx). Konversi 8xxx → 62xxx.
 * Template: ganti {nama} {order_number} {resi}.
 */
export function buildWaLink(
  phone: string | null | undefined,
  template: string,
  vars: { nama?: string | null; order_number?: string | null; resi?: string | null }
): string | null {
  const canon = toCanonicalPhone(phone)
  if (!canon) return null
  const intl = '62' + canon
  const text = template
    .replace(/\{nama\}/g, vars.nama ?? '')
    .replace(/\{order_number\}/g, vars.order_number ?? '')
    .replace(/\{resi\}/g, vars.resi ?? '')
  return `https://wa.me/${intl}?text=${encodeURIComponent(text)}`
}

export const DEFAULT_WA_TEMPLATES: Record<CrmProblemType, string> = {
  PEMBELI: 'Halo kak {nama}, saya dari tim CS terkait pesanan {order_number}. Boleh konfirmasi mengenai pengiriman paketnya? Terima kasih 🙏',
  EKSPEDISI: 'Halo kak {nama}, paket pesanan {order_number} (resi {resi}) sedang kami follow up ke ekspedisi. Mohon ditunggu ya.',
}
