'use client'
import { useState, useEffect, useMemo, useCallback, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { LineChart as LineChartIcon, RefreshCw, Loader2, TrendingDown } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar,
} from 'recharts'
import { DateRangePicker, thisMonth, type DateRange } from '@/components/ui/date-range-picker'
import { formatRupiah, formatNumber } from '@/lib/format'
import {
  fetchOverview, fetchOverviewWithForecast,
  fetchDailyRevenue, fetchPerCs, fetchPerAdvertiser, fetchPerChannel,
  fetchRoasPerCampaign, fetchFunnelPerProduct,
  type AnalyticsOverview, type AnalyticsOverviewForecast, type DailyRevenuePoint,
  type PerCsRow, type PerAdvertiserRow, type PerChannelRow,
  type RoasPerCampaignRow, type FunnelPerProductRow,
} from '@/lib/supabase/queries/analytics'
import { CAMPAIGN_PLATFORM_COLOR, CAMPAIGN_PLATFORM_LABEL, CAMPAIGN_STATUS_COLOR, CAMPAIGN_STATUS_LABEL } from '@/lib/schemas/settings'
import type { AdPlatform, CampaignStatus } from '@/lib/types'
import {
  AnalyticsNav, isAnalyticsSection, getSectionLabel,
  type AnalyticsSection,
} from '@/components/analytics/analytics-nav'
import { PerProdukSection } from '@/components/analytics/per-produk-section'
import { ReturSection } from '@/components/analytics/retur-section'

const supabase = createClient()

const STATUS_COLORS: Record<string, string> = {
  BARU: '#3f6fd1',
  SIAP_KIRIM: '#eab308',
  DIKIRIM: '#71717a',
  DITERIMA: '#10b981',
  PROBLEM: '#f59e0b',
  RETUR: '#f97316',
  CANCEL: '#71717a',
  FAKE: '#ef4444',
}

type SortField = 'orders' | 'revenue' | 'conv' | 'commission'

export default function AnalyticsPage() {
  // useSearchParams() butuh Suspense boundary di Next.js 16 (CSR bailout).
  return (
    <Suspense fallback={<Card><CardContent className="p-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></CardContent></Card>}>
      <AnalyticsPageInner />
    </Suspense>
  )
}

function AnalyticsPageInner() {
  const { role, loading: authLoading } = useAuth()
  const canViewAnalytics = role === 'owner' || role === 'admin'

  const router = useRouter()
  const searchParams = useSearchParams()
  const sectionParam = searchParams.get('section')
  const initialSection: AnalyticsSection = isAnalyticsSection(sectionParam) ? sectionParam : 'overview'
  const [section, setSection] = useState<AnalyticsSection>(initialSection)

  // Sync section ↔ URL (one-way: state → URL)
  const handleSelectSection = useCallback((s: AnalyticsSection) => {
    setSection(s)
    const next = new URLSearchParams(searchParams.toString())
    next.set('section', s)
    router.push(`/analytics?${next.toString()}`, { scroll: false })
  }, [router, searchParams])

  // Sync URL → state (e.g. back/forward nav)
  useEffect(() => {
    if (isAnalyticsSection(sectionParam) && sectionParam !== section) {
      setSection(sectionParam)
    }
  }, [sectionParam, section])

  const [range, setRange] = useState<DateRange>(thisMonth)
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null)
  const [forecast, setForecast] = useState<AnalyticsOverviewForecast | null>(null)
  const [daily, setDaily] = useState<DailyRevenuePoint[]>([])
  const [perCs, setPerCs] = useState<PerCsRow[]>([])
  const [perAdv, setPerAdv] = useState<PerAdvertiserRow[]>([])
  const [perChan, setPerChan] = useState<PerChannelRow[]>([])
  const [roasPerCampaign, setRoasPerCampaign] = useState<RoasPerCampaignRow[]>([])
  const [funnelRows, setFunnelRows] = useState<FunnelPerProductRow[]>([])
  const [loading, setLoading] = useState(true)

  // Lazy-init range to avoid hydration drift (thisMonth() returns Date-based label
  // that differs slightly between server & client first render).
  const [rangeReady, setRangeReady] = useState(false)
  useEffect(() => {
    setRange(thisMonth())
    setRangeReady(true)
  }, [])

  const load = useCallback(async () => {
    if (!canViewAnalytics || !rangeReady) return
    setLoading(true)
    try {
      // Phase 6 redesign: PerProdukSection pakai funnelRows langsung
      // (analytics_funnel_per_product sudah include revenue + CS + roas).
      // analytics_profit_per_product_v2 dipakai di detail page kalau perlu drill-down.
      const [ov, fc, dr, cs, adv, chan, roas, funnel] = await Promise.all([
        fetchOverview(supabase, range.from, range.to),
        fetchOverviewWithForecast(supabase, range.from, range.to),
        fetchDailyRevenue(supabase, range.from, range.to),
        fetchPerCs(supabase, range.from, range.to),
        fetchPerAdvertiser(supabase, range.from, range.to),
        fetchPerChannel(supabase, range.from, range.to),
        fetchRoasPerCampaign(supabase, range.from, range.to),
        fetchFunnelPerProduct(supabase, range.from, range.to),
      ])
      setOverview(ov)
      setForecast(fc)
      setDaily(dr)
      setPerCs(cs)
      setPerAdv(adv)
      setPerChan(chan)
      setRoasPerCampaign(roas)
      setFunnelRows(funnel)
    } finally {
      setLoading(false)
    }
  }, [canViewAnalytics, range.from, range.to, rangeReady])

  useEffect(() => {
    if (!authLoading && canViewAnalytics && rangeReady) void load()
  }, [authLoading, canViewAnalytics, load, rangeReady])

  // Brief #4 — CS gak lihat full analytics, TAPI boleh lihat retur ORDER-NYA
  // SENDIRI (RPC role-aware auto-filter cs_id). Render Retur-only view.
  if (!authLoading && !canViewAnalytics && role === 'cs') {
    return (
      <div className="space-y-6">
        <PageHeader icon={LineChartIcon} title="Retur Saya"
          description="Analisa retur untuk order yang kamu tangani. Performa lengkap lain di /cs-dashboard."
          actions={<DateRangePicker value={range} onChange={setRange} />} />
        {rangeReady && <ReturSection from={range.from} to={range.to} />}
      </div>
    )
  }
  if (!authLoading && !canViewAnalytics) {
    return (
      <div className="space-y-6">
        <PageHeader icon={LineChartIcon} title="Analytics" />
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          Hanya owner &amp; admin yang bisa lihat full analytics. CS bisa lihat performa sendiri di{' '}
          <Link href="/cs-dashboard" className="text-zinc-500 hover:underline">/cs-dashboard</Link>,
          advertiser di <Link href="/adv-dashboard" className="text-zinc-500 hover:underline">/adv-dashboard</Link>.
        </CardContent></Card>
      </div>
    )
  }

  const grossProfit = overview ? overview.total_revenue - overview.total_cogs : 0
  const shippingDiff = overview ? overview.total_shipping_charged - overview.total_shipping_actual : 0

  const statusPieData = useMemo(() => {
    if (!overview) return []
    return [
      { name: 'BARU', value: overview.orders_baru },
      { name: 'SIAP_KIRIM', value: overview.orders_siap_kirim },
      { name: 'DIKIRIM', value: overview.orders_dikirim },
      { name: 'DITERIMA', value: overview.orders_diterima },
      { name: 'PROBLEM', value: overview.orders_problem },
      { name: 'RETUR', value: overview.orders_retur },
      { name: 'CANCEL', value: overview.orders_cancel },
      { name: 'FAKE', value: overview.orders_fake },
    ].filter((s) => s.value > 0)
  }, [overview])

  const isEmpty = !loading && overview && overview.total_orders === 0

  return (
    <div className="space-y-6">
      <PageHeader
        icon={LineChartIcon}
        title="Analytics — Profit Dashboard"
        description="Overview business metrics. Date range default = Bulan Ini. Semua data scoped ke organisasi."
        actions={
          <div className="flex items-center gap-2">
            <DateRangePicker value={range} onChange={setRange} />
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            </Button>
          </div>
        }
      />

      {isEmpty ? (
        <EmptyState
          icon={LineChartIcon}
          title="Belum ada order di periode ini"
          description="Coba ubah date range, atau cek dashboard utama / orders untuk lihat data lain."
        />
      ) : (
        <div className="space-y-4">
          <AnalyticsNav section={section} onSelect={handleSelectSection} />
          <div className="min-w-0 space-y-3">
            {/* Section subtitle (compact, no breadcrumb karena nav sudah cukup jelas) */}
            <div className="pb-1">
              <h2 className="text-sm font-medium text-muted-foreground">{getSectionLabel(section)}</h2>
            </div>

            {section === 'overview' && <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="Total Orders" value={String(overview?.total_orders ?? 0)} sub="periode ini" color="blue" />
              <StatCard label="Revenue" value={formatRupiah(overview?.total_revenue ?? 0)} sub="kotor" color="violet" />
              <StatCard label="COGS" value={formatRupiah(overview?.total_cogs ?? 0)} sub="hpp_snapshot" color="amber" />
              <StatCard
                label="Gross Profit (est.)"
                value={formatRupiah(grossProfit)}
                sub={overview ? `${((grossProfit / Math.max(1, overview.total_revenue)) * 100).toFixed(1)}% margin` : ''}
                color={grossProfit >= 0 ? 'emerald' : 'red'}
              />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="Komisi Earned" value={formatRupiah(overview?.total_commissions_earned ?? 0)} sub="pending pencairan" color="amber" />
              <StatCard label="Komisi Paid" value={formatRupiah(overview?.total_commissions_paid ?? 0)} sub="sudah dicairkan" color="emerald" />
              <StatCard label="Shipping Diff" value={formatRupiah(shippingDiff)} sub={shippingDiff >= 0 ? 'profit ongkir' : 'rugi ongkir'} color={shippingDiff >= 0 ? 'emerald' : 'red'} />
              <StatCard label="Total Payout" value={formatRupiah(overview?.total_payout ?? 0)} sub="dari ekspedisi" color="violet" />
            </div>

            {/* Phase 4C — Estimated Cost & Profit row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard
                label="Estimated Total Cost"
                value={formatRupiah(overview?.estimated_total_cost ?? 0)}
                sub="ke ekspedisi (Phase 4C)"
                color="orange"
              />
              <StatCard
                label="Estimated Cash In"
                value={formatRupiah(overview?.estimated_cash_in ?? 0)}
                sub="dari channel (per billing model)"
                color="violet"
              />
              <StatCard
                label="Estimated Profit"
                value={formatRupiah(overview?.estimated_profit ?? 0)}
                sub="cash_in − HPP − komisi − cost"
                color={(overview?.estimated_profit ?? 0) >= 0 ? 'emerald' : 'red'}
              />
              <StatCard
                label="Profit Margin %"
                value={`${(overview?.profit_margin_pct ?? 0).toFixed(2)}%`}
                sub="profit / revenue"
                color={(overview?.profit_margin_pct ?? 0) >= 10 ? 'emerald' : (overview?.profit_margin_pct ?? 0) >= 0 ? 'amber' : 'red'}
              />
            </div>

            {/* Phase 5A + 5B — Operational Expenses, Ad Spend, Net Profit row */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <StatCard
                label="Op. Expenses"
                value={formatRupiah(overview?.total_operational_expenses ?? 0)}
                sub="gaji, sewa, utility (Phase 5A)"
                color="amber"
              />
              <StatCard
                label="Total Ad Spend"
                value={formatRupiah(overview?.total_ad_spend ?? 0)}
                sub="Meta/Google/TikTok (Phase 5B)"
                color="orange"
              />
              <StatCard
                label="Net Profit Before Ads"
                value={formatRupiah(overview?.net_profit_before_ads ?? 0)}
                sub="est profit − op expenses"
                color={(overview?.net_profit_before_ads ?? 0) >= 0 ? 'emerald' : 'red'}
              />
              <StatCard
                label="Net Profit After Ads"
                value={formatRupiah(overview?.net_profit_after_ads ?? 0)}
                sub="− ad spend (TRUE profit)"
                color={(overview?.net_profit_after_ads ?? 0) >= 0 ? 'emerald' : 'red'}
              />
              <StatCard
                label="Net Margin %"
                value={`${(overview?.net_margin_pct ?? 0).toFixed(2)}%`}
                sub="net after ads / revenue"
                color={(overview?.net_margin_pct ?? 0) >= 10 ? 'emerald' : (overview?.net_margin_pct ?? 0) >= 0 ? 'amber' : 'red'}
              />
            </div>

            {/* Phase 5B v4 — Forecast row (realized + pipeline × success rate) */}
            {forecast && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    🔮 Forecast (Estimasi termasuk pipeline)
                    <Badge variant="outline" className="text-[10px] bg-zinc-500/10 text-zinc-500">
                      SR {Number(forecast.success_rate_pct).toFixed(1)}%
                    </Badge>
                  </h3>
                  <p className="text-[10px] text-muted-foreground">
                    Realized + (DIKIRIM {Number(forecast.pipeline_in_transit_count)} order × success rate)
                  </p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <StatCard
                    label="Pipeline (DIKIRIM)"
                    value={formatRupiah(Number(forecast.pipeline_in_transit_revenue))}
                    sub={`${Number(forecast.pipeline_in_transit_count)} order in-transit`}
                    color="blue"
                  />
                  <StatCard
                    label="Expected DITERIMA"
                    value={String(Number(forecast.expected_diterima))}
                    sub={`realized ${forecast.diterima_count} + pipeline × SR`}
                    color="violet"
                  />
                  <StatCard
                    label="Forecast Revenue"
                    value={formatRupiah(Number(forecast.forecast_revenue))}
                    sub="kalau pipeline settle"
                    color="emerald"
                  />
                  <StatCard
                    label="Net Profit Realized"
                    value={formatRupiah(Number(forecast.net_profit_realized))}
                    sub="cash basis (DITERIMA only)"
                    color={Number(forecast.net_profit_realized) >= 0 ? 'emerald' : 'red'}
                  />
                  <StatCard
                    label="Net Profit Forecast"
                    value={formatRupiah(Number(forecast.forecast_net_profit_after_ads))}
                    sub="incl. pipeline × SR"
                    color={Number(forecast.forecast_net_profit_after_ads) >= 0 ? 'emerald' : 'red'}
                  />
                </div>
              </div>
            )}

            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold">Daily Revenue & Orders</h3>
                  <p className="text-[11px] text-muted-foreground">{daily.length} hari ada data</p>
                </div>
                {daily.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">Belum ada data.</div>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={daily} margin={{ top: 8, right: 8, left: 8, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgb(148 163 184 / 0.2)" />
                      <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} />
                      <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}jt` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
                      <RechartsTooltip
                        contentStyle={{ background: 'rgb(15 23 42 / 0.95)', border: '1px solid rgb(148 163 184 / 0.3)', borderRadius: 6, fontSize: 12 }}
                        formatter={(value, name) => name === 'revenue' ? [formatRupiah(Number(value)), 'Revenue'] : [String(value), String(name)]}
                      />
                      <Area type="monotone" dataKey="revenue" stroke="#3f6fd1" fill="#3f6fd1" fillOpacity={0.3} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold">Order Status Distribution</h3>
                  <p className="text-[11px] text-muted-foreground">{overview?.total_orders ?? 0} total</p>
                </div>
                {statusPieData.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">Belum ada order.</div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie data={statusPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} labelLine={false}>
                          {statusPieData.map((s) => (
                            <Cell key={s.name} fill={STATUS_COLORS[s.name] || '#71717a'} />
                          ))}
                        </Pie>
                        <RechartsTooltip contentStyle={{ background: 'rgb(15 23 42 / 0.95)', border: '1px solid rgb(148 163 184 / 0.3)', fontSize: 12 }} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="grid grid-cols-2 gap-2 self-center text-xs">
                      {statusPieData.map((s) => (
                        <div key={s.name} className="flex items-center gap-1.5">
                          <div className="w-2.5 h-2.5 rounded" style={{ background: STATUS_COLORS[s.name] }} />
                          <span className="font-mono text-[10px]">{s.name}</span>
                          <span className="ml-auto font-semibold">{s.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
            </div>}

            {section === 'cs' && <div className="space-y-4">
              <PerUserTable rows={perCs.map((r) => ({ id: r.cs_id, name: r.cs_name, ...r }))} loading={loading} kind="cs" />
              {perCs.length > 0 && (
                <TopUsersBar rows={perCs.slice(0, 5).map((r) => ({ name: r.cs_name || r.cs_id.slice(0, 6), value: r.total_orders }))} title="Top 5 CS by Orders" />
              )}
            </div>}

            {section === 'adv' && <div className="space-y-4">
              <PerUserTable rows={perAdv.map((r) => ({ id: r.advertiser_id, name: r.advertiser_name, ...r }))} loading={loading} kind="advertiser" />
              {perAdv.length > 0 && (
                <TopUsersBar rows={perAdv.slice(0, 5).map((r) => ({ name: r.advertiser_name || r.advertiser_id.slice(0, 6), value: r.total_orders }))} title="Top 5 Advertiser by Orders" />
              )}
            </div>}

            {section === 'channel' && <div className="space-y-4">
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Channel</TableHead>
                      <TableHead className="text-right">Orders</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                      <TableHead className="text-right">Ship Diff</TableHead>
                      <TableHead className="text-right">Est. Cost</TableHead>
                      <TableHead className="text-right">Cash In</TableHead>
                      <TableHead className="text-right">Profit</TableHead>
                      <TableHead className="text-right">Margin %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow><TableCell colSpan={8} className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></TableCell></TableRow>
                    ) : perChan.length === 0 ? (
                      <TableRow><TableCell colSpan={8} className="text-center py-8 text-sm text-muted-foreground">Belum ada order dengan channel di periode ini.</TableCell></TableRow>
                    ) : perChan.map((r) => {
                      const profit = Number(r.estimated_profit)
                      const margin = Number(r.profit_margin_pct)
                      return (
                        <TableRow key={r.channel_id}>
                          <TableCell>
                            <div className="font-mono text-xs">{r.channel_code || `#${r.channel_id}`}</div>
                            <div className="text-[10px] text-muted-foreground">{r.channel_name}</div>
                            {r.billing_model && (
                              <div className="text-[10px] text-zinc-600 mt-0.5">{r.billing_model}</div>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-xs font-semibold">
                            {r.total_orders}
                            <div className="text-[10px] text-muted-foreground">
                              <span className="text-emerald-600">{r.diterima_orders}D</span>
                              {' / '}
                              <span className="text-amber-600">{r.retur_orders}R</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right text-xs">{formatRupiah(Number(r.total_revenue))}</TableCell>
                          <TableCell className={`text-right text-xs font-semibold ${Number(r.shipping_diff) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {formatRupiah(Number(r.shipping_diff))}
                          </TableCell>
                          <TableCell className="text-right text-xs text-amber-600">{formatRupiah(Number(r.estimated_total_cost))}</TableCell>
                          <TableCell className="text-right text-xs">{formatRupiah(Number(r.estimated_cash_in))}</TableCell>
                          <TableCell className={`text-right text-xs font-bold ${profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {formatRupiah(profit)}
                          </TableCell>
                          <TableCell className="text-right text-xs">
                            <Badge variant="outline" className={`text-[10px] ${margin >= 10 ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' : margin >= 0 ? 'bg-amber-500/10 text-amber-600 border-amber-500/30' : 'bg-red-500/10 text-red-600 border-red-500/30'}`}>
                              {margin.toFixed(2)}%
                            </Badge>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
              <p className="text-[11px] text-muted-foreground">
                Est. Cost / Cash In / Profit dari Phase 4C estimated_* columns. Profit = Cash In − HPP − Komisi (untuk MONTHLY_INVOICE: dikurangi cost juga). Margin % = profit / revenue.
              </p>
            </div>}

            {section === 'produk' && <div className="space-y-4">
              <PerProdukSection rows={funnelRows} loading={loading} />
              <p className="text-[11px] text-muted-foreground">
                Tabel ringkas per produk. Klik <strong>Detail →</strong> untuk lihat funnel breakdown, performa CS, dan campaign per produk. Revenue + CS + ROAS dari <code>analytics_funnel_per_product</code> RPC.
              </p>
            </div>}

            {section === 'retur' && <ReturSection from={range.from} to={range.to} />}

            {section === 'campaign' && <div className="space-y-4">
              <RoasPerCampaignTable rows={roasPerCampaign} loading={loading} />
              {roasPerCampaign.length > 0 && (
                <TopUsersBar
                  rows={[...roasPerCampaign]
                    .filter(r => Number(r.total_spend) > 0)
                    .sort((a, b) => Number(b.roas_diterima) - Number(a.roas_diterima))
                    .slice(0, 10)
                    .map((r) => ({
                      name: r.campaign_name.length > 40 ? r.campaign_name.slice(0, 38) + '…' : r.campaign_name,
                      value: Number(r.roas_diterima),
                    }))}
                  title="Top 10 Campaign by ROAS (DITERIMA)"
                />
              )}
              <p className="text-[11px] text-muted-foreground">
                ROAS Gross = total revenue (semua status) / spend. ROAS DITERIMA = revenue dari order DITERIMA / spend (lebih akurat untuk COD). Cost/Conv = spend / conversions (dari platform tracking). Cost/Order = spend / linked orders count.
              </p>
            </div>}
          </div>
        </div>
      )}
    </div>
  )
}


function RoasPerCampaignTable({ rows, loading }: { rows: RoasPerCampaignRow[]; loading: boolean }) {
  const [sortBy, setSortBy] = useState<'spend' | 'roas' | 'revenue' | 'orders'>('spend')
  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      switch (sortBy) {
        case 'roas': return Number(b.roas_diterima) - Number(a.roas_diterima)
        case 'revenue': return Number(b.linked_revenue) - Number(a.linked_revenue)
        case 'orders': return Number(b.linked_orders_count) - Number(a.linked_orders_count)
        default: return Number(b.total_spend) - Number(a.total_spend)
      }
    })
  }, [rows, sortBy])

  return (
    <Card>
      <CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Campaign</TableHead>
              <TableHead>Platform</TableHead>
              <TableHead>Advertiser</TableHead>
              <TableHead>Linked Products</TableHead>
              <TableHead className="text-right cursor-pointer hover:bg-muted/50 select-none" onClick={() => setSortBy('spend')}>
                <span className={sortBy === 'spend' ? 'text-zinc-500 font-semibold' : ''}>Spend</span>
              </TableHead>
              <TableHead className="text-right">Conv</TableHead>
              <TableHead className="text-right cursor-pointer hover:bg-muted/50 select-none" onClick={() => setSortBy('orders')}>
                <span className={sortBy === 'orders' ? 'text-zinc-500 font-semibold' : ''}>Orders</span>
              </TableHead>
              <TableHead className="text-right cursor-pointer hover:bg-muted/50 select-none" onClick={() => setSortBy('revenue')}>
                <span className={sortBy === 'revenue' ? 'text-zinc-500 font-semibold' : ''}>Revenue</span>
              </TableHead>
              <TableHead className="text-right">Rev (DITERIMA)</TableHead>
              <TableHead className="text-right cursor-pointer hover:bg-muted/50 select-none" onClick={() => setSortBy('roas')}>
                <span className={sortBy === 'roas' ? 'text-zinc-500 font-semibold' : ''}>ROAS Diterima</span>
              </TableHead>
              <TableHead className="text-right">Cost/Order</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                </TableCell>
              </TableRow>
            ) : sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center py-8 text-sm text-muted-foreground">
                  Belum ada campaign dengan spend atau order di periode ini.
                </TableCell>
              </TableRow>
            ) : sorted.map((r) => {
              const roas = Number(r.roas_diterima)
              const roasGross = Number(r.roas_gross)
              return (
                <TableRow key={r.campaign_id}>
                  <TableCell>
                    <div className="text-sm font-medium max-w-[220px] truncate">{r.campaign_name}</div>
                    <Badge variant="outline" className={`text-[10px] mt-0.5 ${CAMPAIGN_STATUS_COLOR[r.campaign_status as CampaignStatus] || ''}`}>
                      {CAMPAIGN_STATUS_LABEL[r.campaign_status as CampaignStatus] || r.campaign_status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-[10px] ${CAMPAIGN_PLATFORM_COLOR[r.platform as AdPlatform] || ''}`}>
                      {CAMPAIGN_PLATFORM_LABEL[r.platform as AdPlatform] || r.platform}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.advertiser_name || '—'}</TableCell>
                  <TableCell className="text-xs max-w-[200px] truncate">
                    {r.linked_products || <span className="text-muted-foreground italic">no link</span>}
                  </TableCell>
                  <TableCell className="text-right text-xs font-semibold">{formatRupiah(Number(r.total_spend))}</TableCell>
                  <TableCell className="text-right text-xs">{Number(r.total_conversions) || '—'}</TableCell>
                  <TableCell className="text-right text-xs">{Number(r.linked_orders_count) || '—'}</TableCell>
                  <TableCell className="text-right text-xs">{formatRupiah(Number(r.linked_revenue))}</TableCell>
                  <TableCell className="text-right text-xs text-emerald-600">{formatRupiah(Number(r.linked_revenue_diterima))}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant="outline" className={`text-[10px] ${roas >= 2 ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' : roas >= 1 ? 'bg-amber-500/10 text-amber-600 border-amber-500/30' : 'bg-red-500/10 text-red-600 border-red-500/30'}`}>
                      {roas.toFixed(2)}x
                    </Badge>
                    <div className="text-[9px] text-muted-foreground mt-0.5">gross: {roasGross.toFixed(2)}x</div>
                  </TableCell>
                  <TableCell className="text-right text-xs">{Number(r.cost_per_order) > 0 ? formatRupiah(Number(r.cost_per_order)) : '—'}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}


interface PerUserRow {
  id: string
  name: string | null
  total_orders: number
  total_revenue: number
  diterima_orders: number
  retur_orders: number
  conversion_rate: number
  total_commission_earned: number
  total_commission_paid: number
}

function PerUserTable({ rows, loading, kind }: { rows: PerUserRow[]; loading: boolean; kind: 'cs' | 'advertiser' }) {
  const [sortBy, setSortBy] = useState<SortField>('orders')
  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      switch (sortBy) {
        case 'revenue': return Number(b.total_revenue) - Number(a.total_revenue)
        case 'conv': return Number(b.conversion_rate) - Number(a.conversion_rate)
        case 'commission': return Number(b.total_commission_earned) - Number(a.total_commission_earned)
        default: return Number(b.total_orders) - Number(a.total_orders)
      }
    })
  }, [rows, sortBy])
  const label = kind === 'cs' ? 'CS' : 'Advertiser'

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{label}</TableHead>
              <SortableHead label="Orders" field="orders" current={sortBy} onClick={setSortBy} />
              <SortableHead label="Revenue" field="revenue" current={sortBy} onClick={setSortBy} />
              <TableHead className="text-right">Diterima</TableHead>
              <TableHead className="text-right">Retur</TableHead>
              <SortableHead label="Conv %" field="conv" current={sortBy} onClick={setSortBy} />
              <SortableHead label="Komisi Earned" field="commission" current={sortBy} onClick={setSortBy} />
              <TableHead className="text-right">Komisi Paid</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></TableCell></TableRow>
            ) : sorted.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-sm text-muted-foreground">
                Belum ada order dengan {label.toLowerCase()} di periode ini.
              </TableCell></TableRow>
            ) : sorted.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-sm font-medium">{r.name || r.id.slice(0, 8)}</TableCell>
                <TableCell className="text-right text-xs font-semibold">{r.total_orders}</TableCell>
                <TableCell className="text-right text-xs">{formatRupiah(Number(r.total_revenue))}</TableCell>
                <TableCell className="text-right text-xs text-emerald-600">{r.diterima_orders}</TableCell>
                <TableCell className="text-right text-xs text-amber-600">{r.retur_orders}</TableCell>
                <TableCell className="text-right text-xs">
                  <Badge variant="outline" className={`text-[10px] ${Number(r.conversion_rate) >= 80 ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' : Number(r.conversion_rate) >= 50 ? 'bg-amber-500/10 text-amber-600 border-amber-500/30' : 'bg-red-500/10 text-red-600 border-red-500/30'}`}>
                    {Number(r.conversion_rate).toFixed(1)}%
                  </Badge>
                </TableCell>
                <TableCell className="text-right text-xs">{formatRupiah(Number(r.total_commission_earned))}</TableCell>
                <TableCell className="text-right text-xs text-emerald-600">{formatRupiah(Number(r.total_commission_paid))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function SortableHead({ label, field, current, onClick }: { label: string; field: SortField; current: SortField; onClick: (f: SortField) => void }) {
  const active = current === field
  return (
    <TableHead className="text-right cursor-pointer select-none hover:bg-muted/50" onClick={() => onClick(field)}>
      <span className={`inline-flex items-center gap-1 ${active ? 'text-zinc-500 font-semibold' : ''}`}>
        {label}
        {active ? <TrendingDown className="w-3 h-3" /> : <span className="w-3 h-3 inline-block" />}
      </span>
    </TableHead>
  )
}

function TopUsersBar({ rows, title }: { rows: { name: string; value: number }[]; title: string }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <h3 className="text-sm font-semibold mb-2">{title}</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 8, left: 80, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgb(148 163 184 / 0.2)" />
            <XAxis type="number" tick={{ fontSize: 10 }} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={80} />
            <RechartsTooltip contentStyle={{ background: 'rgb(15 23 42 / 0.95)', border: '1px solid rgb(148 163 184 / 0.3)', fontSize: 12 }} />
            <Bar dataKey="value" fill="#3f6fd1" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}

function StatCard({ label, value, sub, color }: {
  label: string
  value: string
  sub: string
  color: 'blue' | 'amber' | 'emerald' | 'zinc' | 'violet' | 'red' | 'orange'
}) {
  const colorMap: Record<string, string> = {
    blue: 'bg-zinc-500/10 border-zinc-500/30 text-zinc-600',
    amber: 'bg-amber-500/10 border-amber-500/30 text-amber-600',
    emerald: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600',
    zinc: 'bg-zinc-500/10 border-zinc-500/30 text-zinc-600',
    violet: 'bg-zinc-500/10 border-zinc-500/30 text-zinc-600',
    red: 'bg-red-500/10 border-red-500/30 text-red-600',
    orange: 'bg-amber-500/10 border-amber-500/30 text-amber-600',
  }
  return (
    <div className={`p-3 rounded border ${colorMap[color]}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-bold mt-1">{value}</div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>
    </div>
  )
}
