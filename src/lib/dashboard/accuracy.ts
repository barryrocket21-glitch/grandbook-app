import { jakartaDateString } from '../date/jakarta'

type Numeric = number | string | null
export interface DashboardOrder {
  id: number; order_number: string; order_date: string; status: string; total: Numeric
  estimated_profit: Numeric; estimated_total_cost: Numeric; estimated_cod_fee: Numeric; estimated_ppn: Numeric
}
export interface DashboardSpend { id: number; spend_date: string; spend: Numeric }
export interface DashboardItem {
  id: number; order_id: number; qty: Numeric; price: Numeric
  products: { name: string } | null
  orders_draft?: { id: number; order_date: string; status: string } | null
  orders?: { id: number; order_date: string; status: string } | null
}
export interface DashboardInput {
  drafts: DashboardOrder[]; orders: DashboardOrder[]; spend: DashboardSpend[]
  draftItems: DashboardItem[]; items: DashboardItem[]; payout: unknown
}
export function numeric(value: unknown): number {
  if ((typeof value !== 'number' && typeof value !== 'string') ||
      (typeof value === 'string' && !/^-?\d+(\.\d+)?$/.test(value))) throw new Error('Nilai laporan tidak valid')
  const result = Number(value)
  if (!Number.isFinite(result)) throw new Error('Nilai laporan tidak valid')
  return result
}
function count(value: unknown): number {
  const result = numeric(value)
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('Jumlah laporan tidak valid')
  return result
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Respons ringkasan belum lengkap')
  return value as Record<string, unknown>
}
function singleton(value: unknown) {
  if (!Array.isArray(value) || value.length !== 1) throw new Error('Respons ringkasan belum lengkap')
  return record(value[0])
}
export function parsePayout(value: unknown) {
  const row = singleton(value)
  return { cair_total: numeric(row.cair_total), cair_count: count(row.cair_count),
    uncair_total: numeric(row.uncair_total), uncair_count: count(row.uncair_count) }
}
export function parseCashflow(value: unknown) {
  const row = singleton(value)
  if (!Object.hasOwn(row, 'saldo_terakhir')) throw new Error('Respons saldo belum lengkap')
  return { saldo_terakhir: row.saldo_terakhir === null ? null : numeric(row.saldo_terakhir) }
}
export function parsePickup(value: unknown) {
  const row = singleton(value), channels = record(row.by_channel)
  return { total_count: count(row.total_count), total_value: numeric(row.total_value),
    oldest_days_pending: numeric(row.oldest_days_pending),
    by_channel: Object.fromEntries(Object.entries(channels).map(([key, value]) => {
      const channel = record(value)
      return [key, { count: count(channel.count), value: numeric(channel.value) }]
    })) }
}
export function dashboardPeriod(now = new Date()) {
  const today = jakartaDateString(now), month = today.slice(0, 8) + '01'
  const days = Array.from({ length: 30 }, (_, index) => {
    const day = new Date(today + 'T00:00:00Z')
    day.setUTCDate(day.getUTCDate() - 29 + index)
    return day.toISOString().slice(0, 10)
  })
  return { today, month, days, start: month < days[0] ? month : days[0] }
}
export type DashboardPeriod = ReturnType<typeof dashboardPeriod>
const terminal = new Set(['DITERIMA', 'RETUR', 'CANCEL', 'FAKE'])
const excluded = new Set(['CANCEL', 'FAKE'])
function sum<T>(rows: T[], value: (row: T) => unknown) {
  return rows.reduce((total, row) => total + numeric(value(row)), 0)
}
function optionalSum<T>(rows: T[], value: (row: T) => unknown) {
  return rows.some(row => value(row) === null) ? null : sum(rows, value)
}
function assertDate(value: string, start: string, end: string) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value + 'T00:00:00Z')) ||
      new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value ||
      value < start || value > end) throw new Error('Periode laporan tidak valid')
}
function assertIdentity(rows: { id: number }[]) {
  const seen = new Set<number>()
  for (const row of rows) {
    if (!Number.isSafeInteger(row.id) || row.id <= 0 || seen.has(row.id)) throw new Error('Identitas laporan tidak valid')
    seen.add(row.id)
  }
}
export function calculateDashboard(input: DashboardInput, period: DashboardPeriod) {
  const { drafts, orders, spend, draftItems, items } = input
  for (const rows of [drafts, orders, spend, draftItems, items]) assertIdentity(rows)
  const names = new Set<string>()
  for (const row of [...drafts, ...orders]) {
    assertDate(row.order_date, period.start, period.today)
    if (!row.order_number || names.has(row.order_number) || typeof row.status !== 'string' || !row.status) {
      throw new Error('Sumber order berubah atau tumpang tindih; muat ulang')
    }
    names.add(row.order_number)
    numeric(row.total)
  }
  for (const row of spend) { assertDate(row.spend_date, period.start, period.today); numeric(row.spend) }
  const all = [...drafts, ...orders], month = all.filter(row => row.order_date >= period.month)
  const today = month.filter(row => row.order_date === period.today)
  const monthSpend = spend.filter(row => row.spend_date >= period.month)
  const running = month.filter(row => !terminal.has(row.status))
  // Preserve existing delivered basis: final orders only, stored estimate, not cash realized.
  const delivered = orders.filter(row => row.order_date >= period.month && row.status === 'DITERIMA')
  const ordersByStatus: Record<string, number> = Object.create(null)
  for (const row of month) ordersByStatus[row.status] = (ordersByStatus[row.status] || 0) + 1
  const omzet = (rows: DashboardOrder[]) => sum(rows.filter(row => !excluded.has(row.status)), row => row.total)
  const omzetBulanIni = omzet(month), totalAdSpendBulanIni = sum(monthSpend, row => row.spend)
  const productMap = new Map<string, { name: string; qty: number; revenue: number }>()
  for (const [parents, children, relation] of [[drafts, draftItems, 'orders_draft'], [orders, items, 'orders']] as const) {
    const parentMap = new Map(parents.filter(row => row.order_date >= period.month).map(row => [row.id, row]))
    const covered = new Set<number>()
    for (const item of children) {
      const parent = parentMap.get(item.order_id), nested = item[relation]
      if (!parent || !nested || nested.id !== parent.id || nested.order_date !== parent.order_date ||
          nested.status !== parent.status) throw new Error('Relasi order dan produk berubah; muat ulang')
      covered.add(parent.id)
      const qty = count(item.qty), price = numeric(item.price)
      if (excluded.has(parent.status)) continue
      const name = item.products?.name || 'Produk belum terhubung'
      const product = productMap.get(name) || { name, qty: 0, revenue: 0 }
      product.qty += qty; product.revenue += price * qty; productMap.set(name, product)
    }
    if ([...parentMap.keys()].some(id => !covered.has(id))) throw new Error('Item order belum terbaca lengkap')
  }
  const dailyMap = new Map(period.days.map(date => [date, { omzet: 0, spend: 0 }]))
  for (const row of all) {
    const day = dailyMap.get(row.order_date)
    if (day && !excluded.has(row.status)) day.omzet += numeric(row.total)
  }
  for (const row of spend) { const day = dailyMap.get(row.spend_date); if (day) day.spend += numeric(row.spend) }
  const payout = parsePayout(input.payout)
  return {
    omzetHariIni: omzet(today), omzetBulanIni, totalOrdersHariIni: today.length, totalOrdersBulanIni: month.length,
    ordersByStatus, totalAdSpendBulanIni, blendedROAS: totalAdSpendBulanIni > 0 ? omzetBulanIni / totalAdSpendBulanIni : 0,
    estProfit: optionalSum(running, row => row.estimated_profit),
    estBiaya: optionalSum(running, row => row.estimated_total_cost),
    estFeeCod: optionalSum(running, row => row.estimated_cod_fee),
    estPpn: optionalSum(running, row => row.estimated_ppn),
    aktualProfit: optionalSum(delivered, row => row.estimated_profit), deliveredCount: delivered.length,
    incompleteEstimates: running.filter(row => [row.estimated_profit, row.estimated_total_cost, row.estimated_cod_fee, row.estimated_ppn].includes(null)).length,
    incompleteDelivered: delivered.filter(row => row.estimated_profit === null).length,
    codCair: payout.cair_total, codUncair: payout.uncair_total, uncairCount: payout.uncair_count,
    returPercentage: (ordersByStatus.DITERIMA || 0) + (ordersByStatus.RETUR || 0) > 0 ?
      (ordersByStatus.RETUR || 0) / ((ordersByStatus.DITERIMA || 0) + (ordersByStatus.RETUR || 0)) * 100 : 0,
    fakePercentage: month.length ? (ordersByStatus.FAKE || 0) / month.length * 100 : 0,
    dailyChart: [...dailyMap].map(([date, day]) => ({
      date: new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(date + 'T00:00:00+07:00')),
      ...day, profit: day.omzet - day.spend,
    })),
    topProducts: [...productMap.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5),
    period, coverage: { drafts: drafts.length, orders: orders.length, spend: spend.length, draftItems: draftItems.length, items: items.length },
  }
}
export type DashboardData = ReturnType<typeof calculateDashboard>
