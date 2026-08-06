import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'

type OrderLite = {
  id: number
  status: string
  total: number | null
  shipping_cost: number | null
  shipping_cost_actual: number | null
  cod_amount: number | null
  payout_amount: number | null
  campaign_id: number | null
  meta: Record<string, unknown> | null
  estimated_shipping_net: number | null
  estimated_cod_fee: number | null
}

type OrderItemLite = {
  id: number
  order_id: number
  product_id: number | null
  product_name_raw: string | null
  qty: number | null
  hpp_snapshot: number | null
}

type ProductLite = {
  id: number
  name: string | null
  display_name: string | null
}

type CampaignLite = {
  id: number
  platform: string | null
}

type CommissionLite = {
  order_id: number
  order_item_id: number | null
  amount: number | null
  status: string | null
}

type PlatformBreakdownRow = {
  platform: string
  total_ad_spend: number | null
  net_profit: number | null
  gross_profit: number | null
  roas: number | null
}

type ProductPlatformRow = {
  product_id: number | null
  product_name: string
  platform: string
  total_orders: number
  qty: number
  delivered: number
  retur: number
  delivered_rate: number
  return_rate: number
  omset: number
  gross_profit_before_ads: number
  ads_allocated: number
  profit_after_ads: number
  shipping_diff: number
}

type SummaryRow = {
  platform: string
  total_orders: number
  delivered: number
  retur: number
  delivered_rate: number
  return_rate: number
  omset: number
  gross_profit_before_ads: number
  ads_allocated: number
  profit_after_ads: number
  shipping_diff: number
}

const UNKNOWN_PLATFORM = 'UNKNOWN'

function n(v: unknown): number {
  return Number(v) || 0
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

function readPlatform(order: OrderLite, campaignPlatform?: string | null): string {
  const metaPlatform = typeof order.meta?.platform === 'string' ? order.meta.platform.trim().toUpperCase() : ''
  const campaign = (campaignPlatform || '').trim().toUpperCase()
  return metaPlatform || campaign || UNKNOWN_PLATFORM
}

function monthRange(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) return null
  const from = `${month}-01`
  const [year, mm] = month.split('-').map(Number)
  const to = new Date(Date.UTC(year, mm, 0)).toISOString().slice(0, 10)
  return { from, to }
}

async function requireManager() {
  const sb = await createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return { error: 'Unauthorized', status: 401 as const }

  const { data: profile } = await sb
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'owner' && profile?.role !== 'admin' && profile?.role !== 'akunting') {
    return { error: 'Hanya owner/admin/akunting yang bisa buka Owner Profit Cockpit', status: 403 as const }
  }

  return { ok: true as const, sb }
}

export async function GET(request: Request) {
  const auth = await requireManager()
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { sb } = auth

  const { searchParams } = new URL(request.url)
  const month = searchParams.get('month') || new Date().toISOString().slice(0, 7)
  const platformFilter = (searchParams.get('platform') || 'ALL').toUpperCase()
  const range = monthRange(month)
  if (!range) return NextResponse.json({ error: 'Format month wajib YYYY-MM' }, { status: 400 })

  const ordersRes = await sb
    .from('orders')
    .select('id,status,total,shipping_cost,shipping_cost_actual,cod_amount,payout_amount,campaign_id,meta,estimated_shipping_net,estimated_cod_fee')
    .gte('order_date', range.from)
    .lte('order_date', range.to)

  if (ordersRes.error) return NextResponse.json({ error: ordersRes.error.message }, { status: 400 })
  const orders = (ordersRes.data || []) as OrderLite[]

  const orderIds = orders.map((o) => o.id)
  const campaignIds = [...new Set(orders.map((o) => o.campaign_id).filter(Boolean) as number[])]

  const [itemsRes, campaignsRes, commissionsRes] = await Promise.all([
    orderIds.length
      ? sb.from('order_items').select('id,order_id,product_id,product_name_raw,qty,hpp_snapshot').in('order_id', orderIds)
      : Promise.resolve({ data: [], error: null }),
    campaignIds.length
      ? sb.from('campaigns').select('id,platform').in('id', campaignIds)
      : Promise.resolve({ data: [], error: null }),
    orderIds.length
      ? sb.from('commissions').select('order_id,order_item_id,amount,status').in('order_id', orderIds).in('status', ['EARNED', 'PAID'])
      : Promise.resolve({ data: [], error: null }),
  ])

  if (itemsRes.error) return NextResponse.json({ error: itemsRes.error.message }, { status: 400 })
  if (campaignsRes.error) return NextResponse.json({ error: campaignsRes.error.message }, { status: 400 })
  if (commissionsRes.error) return NextResponse.json({ error: commissionsRes.error.message }, { status: 400 })

  const items = (itemsRes.data || []) as OrderItemLite[]
  const campaigns = (campaignsRes.data || []) as CampaignLite[]
  const commissions = (commissionsRes.data || []) as CommissionLite[]

  const productIds = [...new Set(items.map((i) => i.product_id).filter(Boolean) as number[])]
  const productsRes = productIds.length
    ? await sb.from('products').select('id,name,display_name').in('id', productIds)
    : { data: [], error: null }
  if (productsRes.error) return NextResponse.json({ error: productsRes.error.message }, { status: 400 })
  const products = (productsRes.data || []) as ProductLite[]

  const campaignMap = new Map(campaigns.map((c) => [c.id, c]))
  const productMap = new Map(products.map((p) => [p.id, p]))
  const itemsByOrder = new Map<number, OrderItemLite[]>()
  const commissionByItem = new Map<number, number>()
  const commissionByOrderRemainder = new Map<number, number>()

  for (const item of items) {
    const list = itemsByOrder.get(item.order_id) || []
    list.push(item)
    itemsByOrder.set(item.order_id, list)
  }

  for (const c of commissions) {
    if (c.order_item_id) {
      commissionByItem.set(c.order_item_id, n(commissionByItem.get(c.order_item_id)) + n(c.amount))
    } else {
      commissionByOrderRemainder.set(c.order_id, n(commissionByOrderRemainder.get(c.order_id)) + n(c.amount))
    }
  }

  const productSpendMap = new Map<string, number>()
  for (const productId of productIds) {
    const { data, error } = await sb.rpc('analytics_profit_per_product_per_platform', {
      p_product_id: productId,
      p_from: range.from,
      p_to: range.to,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    for (const row of (data || []) as PlatformBreakdownRow[]) {
      productSpendMap.set(`${productId}__${String(row.platform || UNKNOWN_PLATFORM).toUpperCase()}`, n(row.total_ad_spend))
    }
  }

  const rowMap = new Map<string, ProductPlatformRow>()
  const allPlatforms = new Set<string>()

  for (const order of orders) {
    const itemsForOrder = itemsByOrder.get(order.id) || []
    if (itemsForOrder.length === 0) continue
    const totalQty = itemsForOrder.reduce((sum, item) => sum + Math.max(1, n(item.qty)), 0)
    const platform = readPlatform(order, order.campaign_id ? campaignMap.get(order.campaign_id)?.platform : null)
    allPlatforms.add(platform)

    const delivered = order.status === 'DITERIMA'
    const retur = order.status === 'RETUR'
    const revenueBase = n(order.payout_amount) || n(order.cod_amount) || n(order.total)
    const shippingActualOrder = n(order.shipping_cost_actual) || (n(order.estimated_shipping_net) + n(order.estimated_cod_fee))
    const shippingChargedOrder = n(order.shipping_cost)
    const orderRemainderCommission = n(commissionByOrderRemainder.get(order.id))

    for (const item of itemsForOrder) {
      const qty = Math.max(1, n(item.qty))
      const share = qty / Math.max(1, totalQty)
      const product = item.product_id ? productMap.get(item.product_id) : null
      const productName = product?.display_name || product?.name || item.product_name_raw || 'Produk Tanpa Nama'
      const key = `${item.product_id || 0}__${platform}__${productName}`
      const existing = rowMap.get(key) || {
        product_id: item.product_id,
        product_name: productName,
        platform,
        total_orders: 0,
        qty: 0,
        delivered: 0,
        retur: 0,
        delivered_rate: 0,
        return_rate: 0,
        omset: 0,
        gross_profit_before_ads: 0,
        ads_allocated: 0,
        profit_after_ads: 0,
        shipping_diff: 0,
      }

      existing.total_orders += 1
      existing.qty += qty
      if (delivered) existing.delivered += 1
      if (retur) existing.retur += 1

      if (delivered) {
        const revenue = revenueBase * share
        const hpp = qty * n(item.hpp_snapshot)
        const shippingActual = shippingActualOrder * share
        const shippingDiff = (shippingChargedOrder - shippingActualOrder) * share
        const commission = n(commissionByItem.get(item.id)) + (orderRemainderCommission * share)
        existing.omset += revenue
        existing.gross_profit_before_ads += revenue - hpp - shippingActual - commission
        existing.shipping_diff += shippingDiff
      }

      rowMap.set(key, existing)
    }
  }

  const rows = [...rowMap.values()].map((row) => {
    const spend = row.product_id ? n(productSpendMap.get(`${row.product_id}__${row.platform}`)) : 0
    const deliveredRate = row.total_orders > 0 ? (row.delivered / row.total_orders) * 100 : 0
    const finalCount = row.delivered + row.retur
    const returnRate = finalCount > 0 ? (row.retur / finalCount) * 100 : 0
    return {
      ...row,
      delivered_rate: round2(deliveredRate),
      return_rate: round2(returnRate),
      omset: round2(row.omset),
      gross_profit_before_ads: round2(row.gross_profit_before_ads),
      ads_allocated: round2(spend),
      profit_after_ads: round2(row.gross_profit_before_ads - spend),
      shipping_diff: round2(row.shipping_diff),
    }
  })

  const filteredRows = platformFilter === 'ALL'
    ? rows
    : rows.filter((row) => row.platform === platformFilter)

  const summaryMap = new Map<string, SummaryRow>()
  for (const row of filteredRows) {
    const existing = summaryMap.get(row.platform) || {
      platform: row.platform,
      total_orders: 0,
      delivered: 0,
      retur: 0,
      delivered_rate: 0,
      return_rate: 0,
      omset: 0,
      gross_profit_before_ads: 0,
      ads_allocated: 0,
      profit_after_ads: 0,
      shipping_diff: 0,
    }
    existing.total_orders += row.total_orders
    existing.delivered += row.delivered
    existing.retur += row.retur
    existing.omset += row.omset
    existing.gross_profit_before_ads += row.gross_profit_before_ads
    existing.ads_allocated += row.ads_allocated
    existing.profit_after_ads += row.profit_after_ads
    existing.shipping_diff += row.shipping_diff
    summaryMap.set(row.platform, existing)
  }

  const summary = [...summaryMap.values()].map((row) => {
    const deliveredRate = row.total_orders > 0 ? (row.delivered / row.total_orders) * 100 : 0
    const finalCount = row.delivered + row.retur
    const returnRate = finalCount > 0 ? (row.retur / finalCount) * 100 : 0
    return {
      ...row,
      delivered_rate: round2(deliveredRate),
      return_rate: round2(returnRate),
      omset: round2(row.omset),
      gross_profit_before_ads: round2(row.gross_profit_before_ads),
      ads_allocated: round2(row.ads_allocated),
      profit_after_ads: round2(row.profit_after_ads),
      shipping_diff: round2(row.shipping_diff),
    }
  }).sort((a, b) => a.profit_after_ads - b.profit_after_ads)

  const totals = filteredRows.reduce((acc, row) => {
    acc.total_orders += row.total_orders
    acc.delivered += row.delivered
    acc.retur += row.retur
    acc.omset += row.omset
    acc.gross_profit_before_ads += row.gross_profit_before_ads
    acc.ads_allocated += row.ads_allocated
    acc.profit_after_ads += row.profit_after_ads
    acc.shipping_diff += row.shipping_diff
    return acc
  }, {
    total_orders: 0,
    delivered: 0,
    retur: 0,
    omset: 0,
    gross_profit_before_ads: 0,
    ads_allocated: 0,
    profit_after_ads: 0,
    shipping_diff: 0,
  })

  const deliveredRate = totals.total_orders > 0 ? (totals.delivered / totals.total_orders) * 100 : 0
  const finalCount = totals.delivered + totals.retur
  const returnRate = finalCount > 0 ? (totals.retur / finalCount) * 100 : 0

  return NextResponse.json({
    ok: true,
    month,
    platformFilter,
    readOnlyMode: 'READ_ONLY_OWNER_PROFIT_COCKPIT',
    filters: {
      month,
      platform: platformFilter,
      availablePlatforms: ['ALL', ...Array.from(allPlatforms).sort()],
    },
    summary,
    productPlatform: filteredRows.sort((a, b) => a.profit_after_ads - b.profit_after_ads),
    totals: {
      ...totals,
      delivered_rate: round2(deliveredRate),
      return_rate: round2(returnRate),
      omset: round2(totals.omset),
      gross_profit_before_ads: round2(totals.gross_profit_before_ads),
      ads_allocated: round2(totals.ads_allocated),
      profit_after_ads: round2(totals.profit_after_ads),
      shipping_diff: round2(totals.shipping_diff),
    },
    notes: [
      'Read-only. Tidak ada data live yang berubah sebelum Apply dikonfirmasi.',
      'Profit Setelah Ads = omset delivered/payout available - HPP - shipping actual/estimated - komisi - ads allocated.',
      'Bucket UNKNOWN dipertahankan kalau platform order tidak kebaca dari meta/campaign.',
    ],
  })
}
