import type { createClient } from '../supabase/client'
import { completeReportRead } from '../analytics/complete-report-read'
import { calculateDashboard, dashboardPeriod, parseCashflow, parsePayout, parsePickup,
  type DashboardOrder, type DashboardSpend, type DashboardItem } from './accuracy'

type Client = ReturnType<typeof createClient>
const orderColumns = 'id,order_number,total,status,order_date,estimated_profit,estimated_total_cost,estimated_cod_fee,estimated_ppn'
export async function readDashboard(client: Client, signal: AbortSignal, now = new Date()) {
  const period = dashboardPeriod(now)
  async function read<T extends { id: number }>(table: string, select: string, column: string, start: string) {
    const query = () => client.from(table).select(select, { count: 'exact' }).gte(column, start).lte(column, period.today)
    const rows = await completeReportRead<T>(after =>
      query().gt('id', after).order('id', { ascending: true }).limit(1000).abortSignal(signal).returns<T[]>())
    // Recheck the full count after pagination; no successful partial result.
    const end = await client.from(table).select(select, { count: 'exact', head: true })
      .gte(column, start).lte(column, period.today).abortSignal(signal)
    if (end.error || end.count !== rows.length) throw new Error('Jumlah data berubah; muat ulang dashboard')
    return rows
  }
  const [drafts, orders, spend, draftItems, items, payout] = await Promise.all([
    read<DashboardOrder>('orders_draft', orderColumns, 'order_date', period.start),
    read<DashboardOrder>('orders', orderColumns, 'order_date', period.start),
    read<DashboardSpend>('ad_spend', 'id,spend,spend_date', 'spend_date', period.start),
    read<DashboardItem>('order_items_draft', 'id,order_id,qty,price,products(name),orders_draft!inner(id,order_date,status)', 'orders_draft.order_date', period.month),
    read<DashboardItem>('order_items', 'id,order_id,qty,price,products(name),orders!inner(id,order_date,status)', 'orders.order_date', period.month),
    client.rpc('get_payout_position').abortSignal(signal),
  ])
  if (signal.aborted || payout.error) throw new Error('Data pencairan belum terbaca lengkap')
  return calculateDashboard({ drafts, orders, spend, draftItems, items, payout: payout.data }, period)
}
export async function readCashflow(client: Client, signal: AbortSignal) {
  const [cashflow, payout] = await Promise.all([
    client.rpc('get_cashflow_summary').abortSignal(signal),
    client.rpc('get_payout_position').abortSignal(signal),
  ])
  if (signal.aborted || cashflow.error || payout.error) throw new Error('Data pencairan belum terbaca lengkap')
  return { ...parseCashflow(cashflow.data), payout: parsePayout(payout.data) }
}
export async function readPickup(client: Client, signal: AbortSignal) {
  const result = await client.rpc('pending_pickup_summary', { p_days_threshold: 3 }).abortSignal(signal)
  if (signal.aborted || result.error) throw new Error('Data pickup belum terbaca lengkap')
  return parsePickup(result.data)
}
