'use client'
// =============================================================
// CS Lead/Closing summary section (Phase 6)
// Dipakai dari /cs-dashboard via PersonalDashboard renderExtraSection slot.
// Data sumber: daily_cs_report (via 3 RPCs cs_period_summary, cs_daily_series,
// plus per-product breakdown query).
// =============================================================
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer,
} from 'recharts'
import { Loader2, MessageCircle, CheckCircle2, TrendingUp, Calendar, FileEdit } from 'lucide-react'
import { formatNumber } from '@/lib/format'
import {
  fetchCsPeriodSummary, fetchCsDailySeries, listReportForRange,
  type CsPeriodSummary, type CsDailySeriesPoint, type DailyCsReportWithProduct,
} from '@/lib/supabase/queries/cs-report'

const supabase = createClient()

export function CsLeadSection({ userId, from, to }: { userId: string; from: string; to: string }) {
  const [summary, setSummary] = useState<CsPeriodSummary | null>(null)
  const [series, setSeries] = useState<CsDailySeriesPoint[]>([])
  const [rows, setRows] = useState<DailyCsReportWithProduct[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, sr, rs] = await Promise.all([
        fetchCsPeriodSummary(supabase, { csId: userId, from, to }),
        fetchCsDailySeries(supabase, { csId: userId, from, to }),
        listReportForRange(supabase, { csId: userId, from, to }),
      ])
      setSummary(s)
      setSeries(sr)
      setRows(rs)
    } finally {
      setLoading(false)
    }
  }, [userId, from, to])

  useEffect(() => { void load() }, [load])

  // Aggregate per product
  const perProduct = new Map<number, { name: string; sku: string | null; lead: number; closing: number }>()
  for (const r of rows) {
    const cur = perProduct.get(r.product_id) ?? {
      name: r.product?.name || `#${r.product_id}`,
      sku: r.product?.sku ?? null,
      lead: 0, closing: 0,
    }
    cur.lead += Number(r.lead_in)
    cur.closing += Number(r.closing)
    perProduct.set(r.product_id, cur)
  }
  const perProductList = Array.from(perProduct.entries())
    .map(([id, v]) => ({ id, ...v, rate: v.lead > 0 ? (v.closing * 100) / v.lead : 0 }))
    .sort((a, b) => b.lead - a.lead)

  if (loading) {
    return (
      <Card><CardContent className="p-6 text-center">
        <Loader2 className="w-5 h-5 animate-spin mx-auto" />
        <p className="text-xs text-muted-foreground mt-2">Loading lead/closing data…</p>
      </CardContent></Card>
    )
  }

  const noData = !summary || summary.total_lead_in === 0

  return (
    <div className="space-y-4">
      {/* Stat cards: 4 columns */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 rounded border bg-zinc-500/10 border-zinc-500/30">
          <div className="text-xs text-muted-foreground">Total Lead Masuk</div>
          <div className="text-xl font-bold mt-1 text-zinc-600">{formatNumber(summary?.total_lead_in ?? 0)}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">{summary?.active_days ?? 0} hari aktif</div>
        </div>
        <div className="p-3 rounded border bg-emerald-500/10 border-emerald-500/30">
          <div className="text-xs text-muted-foreground">Total Closing</div>
          <div className="text-xl font-bold mt-1 text-emerald-600">{formatNumber(summary?.total_closing ?? 0)}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">dari laporan CS</div>
        </div>
        <div className="p-3 rounded border bg-zinc-500/10 border-zinc-500/30">
          <div className="text-xs text-muted-foreground">Close Rate</div>
          <div className="text-xl font-bold mt-1 text-zinc-600">{(summary?.close_rate ?? 0).toFixed(2)}%</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">closing / lead</div>
        </div>
        <div className="p-3 rounded border bg-amber-500/10 border-amber-500/30">
          <div className="text-xs text-muted-foreground">Avg Lead/Day</div>
          <div className="text-xl font-bold mt-1 text-amber-600">{(summary?.avg_lead_per_day ?? 0).toFixed(1)}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">{summary?.product_count ?? 0} produk</div>
        </div>
      </div>

      {/* Daily lead trend chart */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Daily Lead Trend (CS Report)
            </h3>
            <Link href="/cs-report"><Button variant="outline" size="sm">
              <FileEdit className="w-3.5 h-3.5 mr-2" />Input Laporan
            </Button></Link>
          </div>
          {noData ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Belum ada laporan CS di periode ini. Klik <Link href="/cs-report" className="text-zinc-500 hover:underline">Input Laporan</Link>.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={series} margin={{ top: 8, right: 8, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(148 163 184 / 0.2)" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} />
                <YAxis tick={{ fontSize: 10 }} />
                <RechartsTooltip
                  contentStyle={{ background: 'rgb(15 23 42 / 0.95)', border: '1px solid rgb(148 163 184 / 0.3)', borderRadius: 6, fontSize: 12 }}
                />
                <Area type="monotone" dataKey="total_lead_in" stroke="#3f6fd1" fill="#3f6fd1" fillOpacity={0.3} name="lead" />
                <Area type="monotone" dataKey="total_closing" stroke="#10b981" fill="#10b981" fillOpacity={0.3} name="closing" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Per-Produk mini table */}
      {!noData && perProductList.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="px-4 py-3 border-b flex items-center gap-2">
              <MessageCircle className="w-4 h-4" />
              <h3 className="text-sm font-semibold">Per-Produk Performance (CS Report)</h3>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produk</TableHead>
                  <TableHead className="text-right">Lead</TableHead>
                  <TableHead className="text-right">Closing</TableHead>
                  <TableHead className="text-center">Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {perProductList.slice(0, 10).map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="text-sm">
                      {p.name}
                      {p.sku && <span className="text-[10px] text-muted-foreground font-mono ml-2">{p.sku}</span>}
                    </TableCell>
                    <TableCell className="text-right text-xs font-semibold">{formatNumber(p.lead)}</TableCell>
                    <TableCell className="text-right text-xs text-emerald-600">{formatNumber(p.closing)}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={`text-[10px] ${p.rate >= 25 ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' : p.rate >= 10 ? 'bg-amber-500/10 text-amber-600 border-amber-500/30' : 'bg-zinc-500/10 text-zinc-600 border-zinc-500/30'}`}>
                        {p.rate.toFixed(1)}%
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {perProductList.length > 10 && (
                  <TableRow><TableCell colSpan={4} className="text-center py-2 text-xs text-muted-foreground">
                    + {perProductList.length - 10} produk lain — lihat di /analytics tab Funnel
                  </TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <div className="rounded-lg border border-zinc-500/20 bg-zinc-500/5 p-3 text-xs text-muted-foreground flex items-center gap-2">
        <TrendingUp className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
        <span>
          Cross-check Lead/Closing vs Meta Ads + System Orders di{' '}
          <Link href="/analytics" className="text-zinc-500 hover:underline">/analytics → Tab Funnel</Link>
          {' '}(owner only).
        </span>
      </div>
    </div>
  )
}
