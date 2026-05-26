'use client'
// =============================================================
// /analytics/produk/[id] — Detail Page Per Produk (Phase 6 redesign)
//
// Sections (atas → bawah):
//   1. Stat cards 4 kolom: Spend / Revenue / Close Rate / ROAS
//   2. Funnel visual single row: 4 boxes Meta → CS Lead → CS Close → System Order
//   3. Performa per Varian (omset/profit/retur per varian — Phase 8C)
//   4. Performa CS per produk (tabel sortable)
//   5. ROAS per Campaign untuk produk ini (tabel)
//   6. Insight box compact (auto-generated)
// =============================================================
import { use, useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState } from '@/components/ui/empty-state'
import {
  ArrowLeft, ArrowRight, Loader2, Package, Lightbulb, RefreshCw,
} from 'lucide-react'
import {
  fetchFunnelPerProduct, fetchCsPerformancePerProduct, fetchCampaignsForProduct,
  fetchVariantPerProduct, fetchProfitPerProductPerPlatform,
  type FunnelPerProductRow, type CsPerformanceRow, type CampaignsForProductRow,
  type VariantPerProductRow, type ProfitPerPlatformRow,
} from '@/lib/supabase/queries/analytics'
import { CAMPAIGN_PLATFORM_COLOR, CAMPAIGN_PLATFORM_LABEL, CAMPAIGN_STATUS_COLOR, CAMPAIGN_STATUS_LABEL } from '@/lib/schemas/settings'
import type { AdPlatform, CampaignStatus } from '@/lib/types'
import { DateRangePicker, thisMonth, type DateRange } from '@/components/ui/date-range-picker'
import { formatRupiah, formatNumber } from '@/lib/format'

const supabase = createClient()

// Funnel box color spec (same as previous polish design)
const BOX_STYLES = {
  meta: 'bg-[#F1EFE8] text-[#2C2C2A] dark:bg-[#2C2C2A] dark:text-[#F1EFE8]',
  'cs-lead': 'bg-[#EAF3DE] text-[#173404] dark:bg-[#173404] dark:text-[#EAF3DE]',
  'cs-close': 'bg-[#E1F5EE] text-[#04342C] dark:bg-[#04342C] dark:text-[#E1F5EE]',
  system: 'bg-[#FAEEDA] text-[#412402] dark:bg-[#412402] dark:text-[#FAEEDA]',
}

const BOX_SUBTITLE = {
  meta: 'text-[#5F5E5A] dark:text-[#A8A6A0]',
  'cs-lead': 'text-[#3B6D11] dark:text-[#A6CC7E]',
  'cs-close': 'text-[#0F6E56] dark:text-[#7DCDB6]',
  system: 'text-[#854F0B] dark:text-[#D7AB6E]',
}

export default function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idParam } = use(params)
  const productId = Number(idParam)
  const { role, loading: authLoading } = useAuth()
  const canViewAnalytics = role === 'owner' || role === 'admin'

  const [range, setRange] = useState<DateRange>(thisMonth)
  const [rangeReady, setRangeReady] = useState(false)
  const [funnel, setFunnel] = useState<FunnelPerProductRow | null>(null)
  const [csRows, setCsRows] = useState<CsPerformanceRow[]>([])
  const [campRows, setCampRows] = useState<CampaignsForProductRow[]>([])
  const [varRows, setVarRows] = useState<VariantPerProductRow[]>([])
  const [platformRows, setPlatformRows] = useState<ProfitPerPlatformRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setRange(thisMonth())
    setRangeReady(true)
  }, [])

  const load = useCallback(async () => {
    if (!rangeReady || !productId || isNaN(productId)) return
    setLoading(true)
    try {
      const [funnelAll, cs, camps, vars, platforms] = await Promise.all([
        fetchFunnelPerProduct(supabase, range.from, range.to),
        fetchCsPerformancePerProduct(supabase, { productId, from: range.from, to: range.to }),
        fetchCampaignsForProduct(supabase, { productId, from: range.from, to: range.to }),
        fetchVariantPerProduct(supabase, { productId, from: range.from, to: range.to }),
        fetchProfitPerProductPerPlatform(supabase, { productId, from: range.from, to: range.to }),
      ])
      setFunnel(funnelAll.find(r => Number(r.product_id) === productId) ?? null)
      setCsRows(cs)
      setCampRows(camps)
      setVarRows(vars)
      setPlatformRows(platforms)
    } finally {
      setLoading(false)
    }
  }, [productId, range.from, range.to, rangeReady])

  useEffect(() => {
    if (!authLoading && canViewAnalytics && rangeReady) void load()
  }, [authLoading, canViewAnalytics, rangeReady, load])

  if (!authLoading && !canViewAnalytics) {
    return (
      <div className="space-y-6">
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          Halaman ini hanya untuk owner &amp; admin. Untuk performance individual buka{' '}
          <Link href="/cs-dashboard" className="text-violet-500 hover:underline">/cs-dashboard</Link>.
        </CardContent></Card>
      </div>
    )
  }

  // Gate the whole render until mounted (rangeReady flips to true in the
  // initial useEffect). The header has a DateRangePicker that reads from a
  // lazy useState(thisMonth) initializer, which produced a hydration text
  // mismatch (#418) on this specific page; deferring lets SSR render a stable
  // loader and the real header only appears after mount.
  if (!rangeReady) {
    return (
      <div className="p-12 text-center">
        <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
      </div>
    )
  }

  const productName = funnel?.product_name || `Produk #${productId}`
  const spend = Number(funnel?.total_spend ?? 0)
  const revenue = Number(funnel?.system_revenue ?? 0)
  const closeRate = Number(funnel?.close_rate_cs ?? 0)
  const roas = Number(funnel?.roas_system ?? 0)
  const csLead = Number(funnel?.cs_lead_count ?? 0)
  const csClose = Number(funnel?.cs_closing_count ?? 0)
  const metaLead = Number(funnel?.meta_lead_count ?? 0)
  const sysOrder = Number(funnel?.system_orders_count ?? 0)
  const varLead = Number(funnel?.variance_lead_meta_cs ?? 0)
  const varClose = Number(funnel?.variance_closing_cs_system ?? 0)

  return (
    <div className="space-y-5">
      {/* Breadcrumb + header */}
      <div className="space-y-2">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Link href="/analytics?section=produk" className="hover:text-foreground inline-flex items-center gap-1">
            <ArrowLeft className="w-3 h-3" />Per Produk
          </Link>
          <span>/</span>
          <span className="text-foreground">{productName}</span>
        </div>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Package className="w-5 h-5 text-violet-500" />
              <h1 className="text-2xl font-bold">{productName}</h1>
            </div>
            {funnel?.category_name && (
              <Badge variant="outline" className="text-[10px]">{funnel.category_name}</Badge>
            )}
            {funnel?.product_sku && (
              <span className="text-[10px] text-muted-foreground font-mono ml-2">SKU: {funnel.product_sku}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <DateRangePicker value={range} onChange={setRange} />
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            </Button>
          </div>
        </div>
      </div>

      {loading ? (
        <Card><CardContent className="p-12 text-center">
          <Loader2 className="w-6 h-6 animate-spin mx-auto" />
        </CardContent></Card>
      ) : !funnel ? (
        <EmptyState
          icon={Package}
          title="Belum ada data produk di periode ini"
          description="Pastikan ada ad_spend, daily_cs_report, atau orders dalam date range."
        />
      ) : (
        <>
          {/* 1. Stat cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MiniStatCard label="Spend" value={funnel.has_meta_data ? formatRupiah(spend) : '—'} color="orange" />
            <MiniStatCard label="Revenue" value={funnel.has_system_data ? formatRupiah(revenue) : '—'} color="emerald" />
            <MiniStatCard
              label="Close Rate"
              value={funnel.has_cs_data && csLead > 0 ? `${closeRate.toFixed(1)}%` : '—'}
              color={closeRate >= 30 ? 'emerald' : closeRate >= 10 ? 'amber' : 'red'}
            />
            <MiniStatCard
              label="ROAS"
              value={spend > 0 && roas > 0 ? `${roas.toFixed(2)}x` : '—'}
              color={roas >= 2 ? 'emerald' : roas >= 1 ? 'amber' : 'red'}
            />
          </div>

          {/* 2. Funnel visual (compact single row) */}
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">Funnel</div>
              <div className="flex items-stretch gap-1.5 overflow-x-auto pb-1">
                <FunnelBox tone="meta" label="Meta Lead" value={metaLead} hasData={funnel.has_meta_data} />
                <FunnelArrow
                  primary={funnel.has_meta_data && funnel.has_cs_data && varLead !== 0
                    ? varLead > 0
                      ? { text: `+${formatNumber(varLead)}`, cls: 'text-emerald-600 dark:text-emerald-400', sub: 'organic' }
                      : { text: `${formatNumber(varLead)}`, cls: 'text-red-600 dark:text-red-400', sub: 'Meta over' }
                    : null}
                />
                <FunnelBox tone="cs-lead" label="CS Lead" value={csLead} hasData={funnel.has_cs_data} />
                <FunnelArrow
                  primary={funnel.has_cs_data && csLead > 0
                    ? { text: `${closeRate.toFixed(1)}%`, cls: closeRate >= 30 ? 'text-emerald-600' : closeRate >= 10 ? 'text-amber-600' : 'text-red-600', sub: undefined }
                    : null}
                />
                <FunnelBox tone="cs-close" label="CS Close" value={csClose} hasData={funnel.has_cs_data} />
                <FunnelArrow
                  primary={funnel.has_cs_data && funnel.has_system_data && varClose !== 0
                    ? varClose > 0
                      ? { text: `+${formatNumber(varClose)}`, cls: 'text-emerald-600 dark:text-emerald-400', sub: undefined }
                      : { text: `${formatNumber(varClose)}`, cls: 'text-amber-600 dark:text-amber-400', sub: `${Math.abs(varClose)} backlog` }
                    : null}
                />
                <FunnelBox tone="system" label="System Order" value={sysOrder} hasData={funnel.has_system_data} />
              </div>
            </CardContent>
          </Card>

          {/* 3. Performa per Varian — tabel */}
          <Card>
            <CardContent className="p-0">
              <div className="px-4 py-3 border-b">
                <h3 className="text-sm font-semibold">Performa per Varian</h3>
                <p className="text-xs text-muted-foreground">
                  {varRows.length} varian terjual — omset, profit &amp; retur per varian
                </p>
              </div>
              <VariantTable rows={varRows} />
            </CardContent>
          </Card>

          {/* 4. Performa CS — tabel */}
          <Card>
            <CardContent className="p-0">
              <div className="px-4 py-3 border-b">
                <h3 className="text-sm font-semibold">Performa CS — produk ini</h3>
                <p className="text-xs text-muted-foreground">{csRows.length} CS dengan laporan untuk produk ini di periode</p>
              </div>
              <CsPerformanceTable rows={csRows} />
            </CardContent>
          </Card>

          {/* 5. ROAS per Campaign — tabel */}
          <Card>
            <CardContent className="p-0">
              <div className="px-4 py-3 border-b">
                <h3 className="text-sm font-semibold">Campaign Iklan untuk produk ini</h3>
                <p className="text-xs text-muted-foreground">{campRows.length} campaign linked via campaign_products</p>
              </div>
              <CampaignsTable rows={campRows} />
            </CardContent>
          </Card>

          {/* 5b. Profit per Platform — breakdown Meta/Snack/Google */}
          {platformRows.length > 0 && (
            <Card>
              <CardContent className="p-0">
                <div className="px-4 py-3 border-b">
                  <h3 className="text-sm font-semibold">Profit per Platform Iklan</h3>
                  <p className="text-xs text-muted-foreground">
                    Revenue di-attribute proporsional berdasarkan share ad spend per platform.
                    ROAS akan sama per platform untuk produk yg sama (limitation attribution model).
                  </p>
                </div>
                <PerPlatformTable rows={platformRows} />
              </CardContent>
            </Card>
          )}

          {/* 6. Insight box */}
          <InsightCompact funnel={funnel} />
        </>
      )}
    </div>
  )
}

// --- Sub: per-platform profit table -------------------------------------
function PerPlatformTable({ rows }: { rows: ProfitPerPlatformRow[] }) {
  if (rows.length === 0) {
    return <EmptyState icon={Package} title="Belum ada ad spend untuk produk ini" description="Insert ad_spend di /ad-spend dengan campaign yg linked ke produk ini." />
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Platform</TableHead>
            <TableHead className="text-right">Ad Spend</TableHead>
            <TableHead className="text-right">Share</TableHead>
            <TableHead className="text-right">Conv</TableHead>
            <TableHead className="text-right">Revenue (attr)</TableHead>
            <TableHead className="text-right">Gross Profit</TableHead>
            <TableHead className="text-right">Net Profit</TableHead>
            <TableHead className="text-right">ROAS</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(r => {
            const platformKey = r.platform as AdPlatform
            const netPositive = Number(r.net_profit) >= 0
            return (
              <TableRow key={r.platform}>
                <TableCell>
                  <Badge variant="outline" className={`text-[10px] ${CAMPAIGN_PLATFORM_COLOR[platformKey] || ''}`}>
                    {CAMPAIGN_PLATFORM_LABEL[platformKey] || r.platform}
                  </Badge>
                  <div className="text-[9px] text-muted-foreground mt-0.5">{Number(r.campaigns_count)} campaign</div>
                </TableCell>
                <TableCell className="text-right text-xs whitespace-nowrap">{formatRupiah(Number(r.total_ad_spend))}</TableCell>
                <TableCell className="text-right text-xs">{Number(r.attribution_pct).toFixed(1)}%</TableCell>
                <TableCell className="text-right text-xs">{Number(r.total_conversions) > 0 ? formatNumber(Number(r.total_conversions)) : '—'}</TableCell>
                <TableCell className="text-right text-xs whitespace-nowrap">{formatRupiah(Number(r.attributed_revenue))}</TableCell>
                <TableCell className="text-right text-xs whitespace-nowrap text-emerald-600">{formatRupiah(Number(r.gross_profit))}</TableCell>
                <TableCell className={`text-right text-xs font-semibold whitespace-nowrap ${netPositive ? 'text-emerald-600' : 'text-red-500'}`}>
                  {formatRupiah(Number(r.net_profit))}
                </TableCell>
                <TableCell className="text-right text-xs">
                  <Badge variant="outline" className={`text-[10px] ${Number(r.roas) >= 2 ? 'bg-emerald-500/10 text-emerald-600' : Number(r.roas) >= 1 ? 'bg-amber-500/10 text-amber-600' : 'bg-red-500/10 text-red-500'}`}>
                    {Number(r.roas).toFixed(2)}x
                  </Badge>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

// --- Sub: stat card ------------------------------------------------------
function MiniStatCard({ label, value, color }: {
  label: string
  value: string
  color: 'orange' | 'emerald' | 'amber' | 'red' | 'violet' | 'blue'
}) {
  const cls: Record<typeof color, string> = {
    orange: 'border-orange-500/30 bg-orange-500/5',
    emerald: 'border-emerald-500/30 bg-emerald-500/5',
    amber: 'border-amber-500/30 bg-amber-500/5',
    red: 'border-red-500/30 bg-red-500/5',
    violet: 'border-violet-500/30 bg-violet-500/5',
    blue: 'border-blue-500/30 bg-blue-500/5',
  }
  return (
    <div className={`p-3 rounded border ${cls[color]}`}>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="text-xl font-bold mt-1">{value}</div>
    </div>
  )
}

// --- Sub: funnel box ------------------------------------------------------
function FunnelBox({
  tone, label, value, hasData,
}: {
  tone: keyof typeof BOX_STYLES
  label: string
  value: number
  hasData: boolean
}) {
  return (
    <div className={`flex-1 min-w-[96px] rounded-lg p-3 text-center transition-opacity ${BOX_STYLES[tone]} ${hasData ? '' : 'opacity-50'}`}>
      <div className={`text-[10px] uppercase tracking-wider font-semibold ${BOX_SUBTITLE[tone]}`}>{label}</div>
      <div className="text-xl font-bold mt-1">{hasData ? formatNumber(value) : '—'}</div>
      {!hasData && (
        <div className={`text-[9px] mt-0.5 italic ${BOX_SUBTITLE[tone]}`}>no data</div>
      )}
    </div>
  )
}

// --- Sub: arrow + variance ----------------------------------------------
function FunnelArrow({ primary }: { primary: { text: string; cls: string; sub: string | undefined } | null }) {
  return (
    <div className="flex flex-col items-center justify-center px-1 shrink-0 min-w-[44px]">
      <ArrowRight className="w-4 h-4 text-muted-foreground" />
      {primary && (
        <>
          <div className={`text-[10px] font-semibold leading-tight mt-0.5 text-center ${primary.cls}`}>{primary.text}</div>
          {primary.sub && <div className="text-[9px] text-muted-foreground leading-tight">{primary.sub}</div>}
        </>
      )}
    </div>
  )
}

// --- Sub: CS performance table -------------------------------------------
function CsPerformanceTable({ rows }: { rows: CsPerformanceRow[] }) {
  if (rows.length === 0) {
    return <div className="px-4 py-8 text-center text-sm text-muted-foreground">Belum ada laporan CS untuk produk ini di periode.</div>
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>CS</TableHead>
          <TableHead className="text-right">Lead</TableHead>
          <TableHead className="text-right">Closing</TableHead>
          <TableHead className="text-right">Close %</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(r => {
          const rate = Number(r.close_rate)
          return (
            <TableRow key={r.cs_id}>
              <TableCell className="text-sm font-medium">{r.cs_name || r.cs_id.slice(0, 8)}</TableCell>
              <TableCell className="text-right text-xs">{formatNumber(Number(r.lead_count))}</TableCell>
              <TableCell className="text-right text-xs text-emerald-600 dark:text-emerald-400">{formatNumber(Number(r.closing_count))}</TableCell>
              <TableCell className="text-right">
                <Badge variant="outline" className={`text-[10px] ${rate >= 30 ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' : rate >= 10 ? 'bg-amber-500/10 text-amber-600 border-amber-500/30' : 'bg-red-500/10 text-red-600 border-red-500/30'}`}>
                  {rate.toFixed(1)}%
                </Badge>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

// --- Sub: campaigns table -------------------------------------------------
function CampaignsTable({ rows }: { rows: CampaignsForProductRow[] }) {
  if (rows.length === 0) {
    return <div className="px-4 py-8 text-center text-sm text-muted-foreground">Belum ada campaign linked ke produk ini.</div>
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Campaign</TableHead>
          <TableHead>Platform</TableHead>
          <TableHead className="text-right">Alloc %</TableHead>
          <TableHead className="text-right">Spend</TableHead>
          <TableHead className="text-right">Conv</TableHead>
          <TableHead className="text-right">ROAS</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(r => {
          const roas = Number(r.roas)
          return (
            <TableRow key={r.campaign_id}>
              <TableCell>
                <div className="text-sm font-medium max-w-[260px] truncate" title={r.campaign_name}>
                  {r.campaign_name}
                </div>
                <Badge variant="outline" className={`text-[10px] mt-0.5 ${CAMPAIGN_STATUS_COLOR[r.campaign_status as CampaignStatus] || ''}`}>
                  {CAMPAIGN_STATUS_LABEL[r.campaign_status as CampaignStatus] || r.campaign_status}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge variant="outline" className={`text-[10px] ${CAMPAIGN_PLATFORM_COLOR[r.platform as AdPlatform] || ''}`}>
                  {CAMPAIGN_PLATFORM_LABEL[r.platform as AdPlatform] || r.platform}
                </Badge>
              </TableCell>
              <TableCell className="text-right text-xs">{Number(r.allocation_pct).toFixed(0)}%</TableCell>
              <TableCell className="text-right text-xs text-orange-600 font-semibold">{formatRupiah(Number(r.total_spend))}</TableCell>
              <TableCell className="text-right text-xs">{formatNumber(Number(r.total_conversions))}</TableCell>
              <TableCell className="text-right">
                {roas > 0 ? (
                  <Badge variant="outline" className={`text-[10px] ${roas >= 2 ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' : roas >= 1 ? 'bg-amber-500/10 text-amber-600 border-amber-500/30' : 'bg-red-500/10 text-red-600 border-red-500/30'}`}>
                    {roas.toFixed(2)}x
                  </Badge>
                ) : <span className="text-[10px] text-muted-foreground">—</span>}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

// --- Sub: variant performance table --------------------------------------
function VariantTable({ rows }: { rows: VariantPerProductRow[] }) {
  if (rows.length === 0) {
    return <div className="px-4 py-8 text-center text-sm text-muted-foreground">Belum ada penjualan varian untuk produk ini di periode.</div>
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Varian</TableHead>
          <TableHead className="text-right">Order</TableHead>
          <TableHead className="text-right">Qty</TableHead>
          <TableHead className="text-right">Omset</TableHead>
          <TableHead className="text-right">Gross Profit</TableHead>
          <TableHead className="text-right">Margin</TableHead>
          <TableHead className="text-right">Retur %</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => {
          const retur = Number(r.retur_pct)
          return (
            <TableRow key={r.variant_id ?? 'none'}>
              <TableCell className="text-sm font-medium">{r.variant_name}</TableCell>
              <TableCell className="text-right text-xs">{formatNumber(Number(r.order_count))}</TableCell>
              <TableCell className="text-right text-xs">{formatNumber(Number(r.qty_sold))}</TableCell>
              <TableCell className="text-right text-xs">{formatRupiah(Number(r.revenue))}</TableCell>
              <TableCell className="text-right text-xs text-emerald-600 dark:text-emerald-400">{formatRupiah(Number(r.gross_profit))}</TableCell>
              <TableCell className="text-right text-xs">{Number(r.margin_pct).toFixed(1)}%</TableCell>
              <TableCell className="text-right">
                <Badge variant="outline" className={`text-[10px] ${retur >= 40 ? 'bg-red-500/10 text-red-600 border-red-500/30' : retur >= 25 ? 'bg-amber-500/10 text-amber-600 border-amber-500/30' : 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'}`}>
                  {retur.toFixed(1)}%
                </Badge>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

// --- Sub: insight compact -------------------------------------------------
function InsightCompact({ funnel }: { funnel: FunnelPerProductRow }) {
  const insight = useMemo(() => generateInsight(funnel), [funnel])

  const tint =
    insight.status === 'CRITICAL'
      ? 'bg-red-500/5 border-red-500/30 text-red-700 dark:text-red-400'
      : insight.status === 'WARNING'
        ? 'bg-amber-500/5 border-amber-500/30 text-amber-700 dark:text-amber-400'
        : 'bg-emerald-500/5 border-emerald-500/30 text-emerald-700 dark:text-emerald-400'

  return (
    <div className={`rounded-lg border p-3 flex gap-2.5 items-start ${tint}`}>
      <Lightbulb className="w-4 h-4 shrink-0 mt-0.5" />
      <div className="text-sm leading-snug">
        <span className="font-semibold">{insight.keyword}.</span>{' '}
        <span className="text-muted-foreground">{insight.message}</span>
      </div>
    </div>
  )
}

function generateInsight(row: FunnelPerProductRow): {
  status: 'HEALTHY' | 'WARNING' | 'CRITICAL'
  keyword: string
  message: string
} {
  const spend = Number(row.total_spend)
  const closeRate = Number(row.close_rate_cs)
  const roas = Number(row.roas_system)
  const metaLead = Number(row.meta_lead_count)
  const csClose = Number(row.cs_closing_count)
  const sysOrder = Number(row.system_orders_count)
  const varClose = Number(row.variance_closing_cs_system)

  if (row.has_cs_data && row.has_system_data && varClose < -5) {
    return {
      status: 'WARNING',
      keyword: 'Backlog CS',
      message: `${Math.abs(varClose)} closing belum di-input ke system (CS catat ${formatNumber(csClose)}, system cuma ${formatNumber(sysOrder)} order). Cek backlog CS.`,
    }
  }
  if (row.has_meta_data && spend > 0 && roas > 0 && roas < 1) {
    return {
      status: 'CRITICAL',
      keyword: 'ROAS Loss',
      message: `ROAS ${roas.toFixed(2)}x — campaign masih rugi. Pertimbangkan pause atau optimize creative.`,
    }
  }
  if (row.has_cs_data && Number(row.cs_lead_count) >= 5 && closeRate < 10) {
    return {
      status: 'CRITICAL',
      keyword: 'Close Rate Rendah',
      message: `Close rate ${closeRate.toFixed(1)}% — evaluasi sales script atau lead quality.`,
    }
  }
  if (row.has_meta_data && spend > 0 && metaLead === 0) {
    return {
      status: 'WARNING',
      keyword: 'Meta Lead Hilang',
      message: 'Meta lead tidak ke-track padahal ada spend — cek setup Meta Pixel atau Conversion API.',
    }
  }
  if (row.has_cs_data && Number(row.cs_lead_count) >= 10 && closeRate >= 50) {
    return {
      status: 'HEALTHY',
      keyword: 'Excellent',
      message: `Close rate ${closeRate.toFixed(1)}% — pertimbangkan scale up budget atau replicate strategy.`,
    }
  }
  return {
    status: 'HEALTHY',
    keyword: 'Funnel Sehat',
    message: 'Maintain current strategy. Cek lagi minggu depan.',
  }
}
