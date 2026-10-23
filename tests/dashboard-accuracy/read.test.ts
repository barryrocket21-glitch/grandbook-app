import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createClient } from '@supabase/supabase-js'
import { readDashboard, readCashflow, readPickup } from '../../src/lib/dashboard/read'
import { calculateDashboard, dashboardPeriod, parsePayout, parsePickup, numeric, type DashboardOrder, type DashboardItem, type DashboardInput } from '../../src/lib/dashboard/accuracy'

const now = new Date('2026-10-23T08:00:00Z')
const payout = [{ cair_total: '1234.56', cair_count: 2, uncair_total: 789, uncair_count: 3 }]
function order(id: number, extra: Partial<DashboardOrder> = {}): DashboardOrder {
  return { id, order_number: 'TEST-' + id, order_date: '2026-10-23', status: 'BARU', total: '100.25',
    estimated_profit: '30.25', estimated_total_cost: 70, estimated_cod_fee: 1, estimated_ppn: '0.12', ...extra }
}
function item(row: DashboardOrder, final = false): DashboardItem {
  return { id: row.id, order_id: row.id, qty: 2, price: 30, products: { name: 'Produk Kanonik' },
    [final ? 'orders' : 'orders_draft']: { id: row.id, order_date: row.order_date, status: row.status } }
}
function fixture(size = 2305): DashboardInput {
  const drafts = Array.from({ length: size }, (_, i) => order(i + 1))
  const orders = Array.from({ length: size }, (_, i) => order(i + 1, { order_number: 'FINAL-' + (i + 1), status: 'DITERIMA' }))
  return { drafts, orders, draftItems: drafts.map(row => item(row)), items: orders.map(row => item(row, true)),
    spend: Array.from({ length: size }, (_, i) => ({ id: i + 1, spend_date: '2026-10-23', spend: '0.25' })), payout }
}
type Options = { cap?: number; failTable?: string; rpcError?: string; rpcValue?: unknown; duplicate?: boolean; drift?: boolean; headError?: boolean }
function api(input: DashboardInput, options: Options = {}) {
  const tables: Record<string, { id: number }[]> = {
    orders_draft: input.drafts, orders: input.orders, ad_spend: input.spend,
    order_items_draft: input.draftItems, order_items: input.items,
  }
  const calls: { endpoint: string; after: number; head: boolean }[] = []
  const fetch: typeof globalThis.fetch = async (value, init) => {
    const url = new URL(String(value)), endpoint = url.pathname.split('/').pop()!
    const after = Number((url.searchParams.get('id') || 'gt.0').slice(3)), head = init?.method === 'HEAD'
    calls.push({ endpoint, after, head })
    if (endpoint === 'get_payout_position' || endpoint === 'get_cashflow_summary' || endpoint === 'pending_pickup_summary') {
      assert.equal(init?.method, 'POST')
      if (options.rpcError === endpoint) return new Response(JSON.stringify({ message: 'Synthetic unavailable' }), { status: 503 })
      const data = options.rpcValue !== undefined ? options.rpcValue :
        endpoint === 'get_payout_position' ? input.payout :
        endpoint === 'get_cashflow_summary' ? [{ saldo_terakhir: null }] :
        [{ total_count: 0, total_value: 0, oldest_days_pending: 0, by_channel: {} }]
      return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } })
    }
    assert(endpoint in tables, endpoint)
    assert(['GET', 'HEAD'].includes(init?.method || 'GET'), 'No business writes')
    if ((options.failTable === endpoint && after > 0) || (head && options.headError)) {
      return new Response(JSON.stringify({ message: 'Synthetic page failure' }), { status: 503 })
    }
    const isItem = endpoint.startsWith('order_items')
    const column = endpoint === 'ad_spend' ? 'spend_date' : isItem ? (endpoint.endsWith('draft') ? 'orders_draft.order_date' : 'orders.order_date') : 'order_date'
    const dates = url.searchParams.getAll(column)
    assert.equal(dates.length, 2, 'Both date bounds required')
    const from = dates.find(value => value.startsWith('gte.'))!.slice(4)
    const to = dates.find(value => value.startsWith('lte.'))!.slice(4)
    const all = tables[endpoint].filter(value => {
      const row = value as unknown as Record<string, unknown>
      const date = isItem ? (row[column.split('.')[0]] as { order_date: string }).order_date : String(row[column])
      return date >= from && date <= to
    })
    const remaining = all.filter(row => row.id > after)
    let rows = remaining.slice(0, options.cap || 1000)
    if (options.duplicate && after > 0 && rows.length) rows = [{ ...rows[0], id: after }, ...rows.slice(1)]
    const count = (head ? all.length : remaining.length) + ((options.drift && (head || after > 0)) ? 1 : 0)
    return new Response(head ? null : JSON.stringify(rows), { headers: {
      'content-type': 'application/json', 'content-range': rows.length ? '0-' + (rows.length - 1) + '/' + count : '*/' + count,
    } })
  }
  const client = createClient('https://dashboard-fixture.invalid', 'synthetic-anon-key', {
    global: { fetch }, auth: { persistSession: false, autoRefreshToken: false },
  }) as Parameters<typeof readDashboard>[0]
  return { client, calls }
}
const signal = () => new AbortController().signal

test('all five sources exceed 1000: complete totals and deterministic final verification', async () => {
  const input = fixture(), { client, calls } = api(input)
  const result = await readDashboard(client, signal(), now)
  assert.equal(result.totalOrdersBulanIni, 4610)
  assert.equal(result.omzetBulanIni, 4610 * 100.25)
  assert.equal(result.estProfit, 2305 * 30.25)
  assert.equal(result.aktualProfit, 2305 * 30.25)
  assert.equal(result.totalAdSpendBulanIni, 2305 * .25)
  assert.equal(result.topProducts[0].qty, 9220)
  assert.equal(result.topProducts[0].revenue, 276600)
  assert.equal(result.codCair, 1234.56)
  for (const endpoint of ['orders_draft', 'orders', 'ad_spend', 'order_items_draft', 'order_items']) {
    assert(calls.some(call => call.endpoint === endpoint && call.after >= 2000))
    assert(calls.some(call => call.endpoint === endpoint && call.head))
  }
})
for (const size of [0, 1, 1000, 2000]) test('exact boundary/empty dataset ' + size, async () => {
  const { client } = api(fixture(size)), result = await readDashboard(client, signal(), now)
  assert.equal(result.totalOrdersBulanIni, size * 2)
  assert.equal(result.dailyChart.length, 30)
})
test('server cap smaller than requested limit never terminates pagination early', async () => {
  const { client } = api(fixture(1101), { cap: 237 })
  assert.equal((await readDashboard(client, signal(), now)).totalOrdersBulanIni, 2202)
})
for (const failTable of ['orders_draft', 'orders', 'ad_spend', 'order_items_draft', 'order_items']) {
  test('mid-read error cannot become zero or partial: ' + failTable, async () => {
    const { client } = api(fixture(1001), { failTable })
    await assert.rejects(readDashboard(client, signal(), now))
  })
}
for (const option of [{ drift: true }, { duplicate: true }, { headError: true }]) {
  test('inconsistent pages fail closed ' + JSON.stringify(option), async () => {
    const { client } = api(fixture(1001), option)
    await assert.rejects(readDashboard(client, signal(), now))
  })
}
test('payout unavailable, missing, malformed, or nonfinite never becomes zero', async () => {
  for (const option of [
    { rpcError: 'get_payout_position' }, { rpcValue: [] }, { rpcValue: null },
    { rpcValue: [{}] }, { rpcValue: [{ ...payout[0], cair_total: 'NaN' }] },
  ]) {
    const { client } = api(fixture(1), option)
    await assert.rejects(readDashboard(client, signal(), now))
  }
  assert.deepEqual(parsePayout([{ cair_total: 0, cair_count: 0, uncair_total: 0, uncair_count: 0 }]),
    { cair_total: 0, cair_count: 0, uncair_total: 0, uncair_count: 0 })
})
test('WIB midnight, month/year boundary, leap day, and inclusive thirty days', () => {
  assert.equal(dashboardPeriod(new Date('2026-10-31T17:00:00Z')).today, '2026-11-01')
  assert.equal(dashboardPeriod(new Date('2026-10-31T16:59:59Z')).today, '2026-10-31')
  assert.equal(dashboardPeriod(new Date('2026-01-01T00:00:00Z')).days[0], '2025-12-03')
  assert.equal(dashboardPeriod(new Date('2024-03-01T00:00:00Z')).days[0], '2024-02-01')
})
test('previous-month chart rows included, monthly KPIs/items bounded, future rows excluded', async () => {
  const input = fixture(0)
  input.drafts = [order(1, { order_date: '2026-09-30', total: 100 }), order(2, { total: 200 }), order(3, { order_date: '2026-10-24', total: 999 })]
  input.draftItems = input.drafts.map(row => item(row))
  input.spend = [{ id: 1, spend_date: '2026-09-30', spend: 25 }, { id: 2, spend_date: '2026-10-23', spend: 30 }]
  const { client } = api(input), result = await readDashboard(client, signal(), now)
  assert.equal(result.totalOrdersBulanIni, 1)
  assert.equal(result.omzetBulanIni, 200)
  assert.equal(result.topProducts[0].qty, 2)
  assert.equal(result.totalAdSpendBulanIni, 30)
  const day = result.dailyChart.find(row => row.date.includes('30') && row.date.includes('Sep'))!
  assert.equal(day.omzet, 100); assert.equal(day.spend, 25); assert.equal(day.profit, 75)
})
test('preserve accepted status scopes, stored estimates, ROAS and returns denominator', () => {
  const input = fixture(0)
  input.drafts = ['BARU', 'RETUR', 'FAKE', 'CANCEL', 'DITERIMA'].map((status, i) => order(i + 1, { status }))
  input.orders = [order(6, { status: 'DITERIMA' })]
  input.draftItems = input.drafts.map(row => item(row)); input.items = input.orders.map(row => item(row, true))
  input.spend = [{ id: 1, spend_date: '2026-10-23', spend: 10 }]
  const result = calculateDashboard(input, dashboardPeriod(now))
  assert.equal(result.omzetBulanIni, 4 * 100.25)
  assert.equal(result.estProfit, 30.25); assert.equal(result.aktualProfit, 30.25)
  assert.equal(result.deliveredCount, 1)
  assert(Math.abs(result.returPercentage - 100 / 3) < 1e-10)
  assert(Math.abs(result.fakePercentage - 100 / 6) < 1e-10)
  assert.equal(result.blendedROAS, 40.1)
  assert.equal(result.topProducts[0].qty, 8)
})
test('unknown estimates remain unavailable, never a fabricated zero', () => {
  const input = fixture(1); input.drafts[0].estimated_profit = null; input.orders[0].estimated_profit = null
  const result = calculateDashboard(input, dashboardPeriod(now))
  assert.equal(result.estProfit, null); assert.equal(result.aktualProfit, null)
  assert.equal(result.incompleteEstimates, 1); assert.equal(result.incompleteDelivered, 1)
  assert.equal(result.estBiaya, 70)
})
test('source overlap, missing item, changed parent, invalid date/money fail closed', () => {
  const overlap = fixture(1); overlap.orders[0].order_number = overlap.drafts[0].order_number
  const missing = fixture(1); missing.draftItems = []
  const changed = fixture(1); changed.draftItems[0].orders_draft!.status = 'RETUR'
  const invalid = fixture(1); invalid.drafts[0].order_date = '2026-10-99'
  const money = fixture(1); money.drafts[0].total = null
  for (const input of [overlap, missing, changed, invalid, money]) assert.throws(() => calculateDashboard(input, dashboardPeriod(now)))
  for (const value of [null, undefined, true, '', ' ', 'Infinity', 'NaN', {}, []]) assert.throws(() => numeric(value))
})
test('widgets reject failed or malformed RPCs and accept genuine empty summaries', async () => {
  for (const rpcError of ['get_payout_position', 'get_cashflow_summary']) {
    await assert.rejects(readCashflow(api(fixture(0), { rpcError }).client, signal()))
  }
  await assert.rejects(readPickup(api(fixture(0), { rpcError: 'pending_pickup_summary' }).client, signal()))
  await assert.rejects(readPickup(api(fixture(0), { rpcValue: [] }).client, signal()))
  assert.equal((await readPickup(api(fixture(0)).client, signal())).total_count, 0)
  assert.equal((await readCashflow(api(fixture(0)).client, signal())).saldo_terakhir, null)
  assert.throws(() => parsePickup([{ total_count: 'bad' }]))
})
test('aborted reads cannot publish a valid-looking result', async () => {
  const controller = new AbortController(); controller.abort()
  await assert.rejects(readDashboard(api(fixture(1)).client, controller.signal, now))
})
