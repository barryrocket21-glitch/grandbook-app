'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { BarChart3, Download, Loader2, RefreshCw } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { formatNumber, formatPercent, formatRupiah } from '@/lib/format'
import { buildOwnerProfitWorkbook } from '@/lib/reports/owner-profit-export'

const READ_ONLY_OWNER_PROFIT_COCKPIT = 'READ_ONLY_OWNER_PROFIT_COCKPIT'
const COCKPIT_MODE_LABEL = 'READ_ONLY_OWNER_PROFIT_COCKPIT'
const OWNER_PROFIT_EXPORT_LABEL = 'Owner Profit Cockpit Export'
const DEFAULT_MONTH = new Date().toISOString().slice(0, 7)

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

type ApiPayload = {
  month: string
  platformFilter: string
  readOnlyMode: string
  filters: {
    month: string
    platform: string
    availablePlatforms: string[]
  }
  summary: SummaryRow[]
  productPlatform: ProductPlatformRow[]
  totals: Omit<SummaryRow, 'platform'>
  notes: string[]
}

function moneyClass(v: number) {
  if (v < 0) return 'text-red-600 font-semibold'
  if (v > 0) return 'text-emerald-600'
  return 'text-muted-foreground'
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-xl font-bold tabular-nums">{value}</div>
        {sub ? <div className="text-[11px] text-muted-foreground mt-1">{sub}</div> : null}
      </CardContent>
    </Card>
  )
}

export default function OwnerProfitCockpitPage() {
  const [month, setMonth] = useState(DEFAULT_MONTH)
  const [platform, setPlatform] = useState('ALL')
  const [data, setData] = useState<ApiPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/reports/owner-profit?month=${encodeURIComponent(month)}&platform=${encodeURIComponent(platform)}`, {
        cache: 'no-store',
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Gagal memuat Owner Profit Cockpit')
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat Owner Profit Cockpit')
    } finally {
      setLoading(false)
    }
  }, [month, platform])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const availablePlatforms = useMemo(() => data?.filters.availablePlatforms || ['ALL'], [data])

  function exportOwnerProfitWorkbook() {
    if (!data) return
    const blob = buildOwnerProfitWorkbook({
      month: data.month,
      platformFilter: data.platformFilter,
      summary: data.summary,
      productPlatform: data.productPlatform,
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `owner-profit-cockpit-${data.month}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <PageHeader
        icon={BarChart3}
        title="Owner Profit Cockpit"
        description="Profit Setelah Ads per platform dan Produk × Platform. Read-only untuk keputusan owner — bukan apply finance."
        badge={<Badge variant="outline">{COCKPIT_MODE_LABEL}</Badge>}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => void load()} disabled={loading} className="gap-1.5">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </Button>
            <Button onClick={exportOwnerProfitWorkbook} disabled={loading || !data} className="gap-1.5" title={OWNER_PROFIT_EXPORT_LABEL}>
              <Download className="w-4 h-4" /> Export Excel
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="pt-4 pb-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
            <label className="text-sm space-y-1">
              <span className="font-medium">Bulan</span>
              <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </label>
            <label className="text-sm space-y-1">
              <span className="font-medium">Platform</span>
              <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="h-10 rounded-md border bg-background px-3 text-sm">
                {availablePlatforms.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
          </div>
          <div className="rounded-lg border bg-amber-500/5 border-amber-500/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
            <div className="font-medium">Mode {READ_ONLY_OWNER_PROFIT_COCKPIT}</div>
            <div>Tidak ada data live yang berubah sebelum Apply dikonfirmasi.</div>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <Card><CardContent className="pt-4 pb-4 text-sm text-red-600">{error}</CardContent></Card>
      ) : null}

      {loading && !data ? (
        <Card><CardContent className="pt-10 pb-10 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></CardContent></Card>
      ) : null}

      {data ? (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
            <StatCard label="Orders" value={formatNumber(data.totals.total_orders)} sub={`${formatNumber(data.totals.delivered)} delivered`} />
            <StatCard label="Profit Setelah Ads" value={formatRupiah(data.totals.profit_after_ads)} sub={`Ads ${formatRupiah(data.totals.ads_allocated)}`} />
            <StatCard label="Gross Before Ads" value={formatRupiah(data.totals.gross_profit_before_ads)} sub={`Omset ${formatRupiah(data.totals.omset)}`} />
            <StatCard label="Return Rate" value={formatPercent(data.totals.return_rate, 1)} sub={`${formatNumber(data.totals.retur)} retur`} />
            <StatCard label="Delivered Rate" value={formatPercent(data.totals.delivered_rate, 1)} sub={`Selisih Ongkir ${formatRupiah(data.totals.shipping_diff)}`} />
          </div>

          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="font-semibold mb-3">Ringkasan Platform</div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Platform</TableHead>
                      <TableHead className="text-right">Orders</TableHead>
                      <TableHead className="text-right">Delivered</TableHead>
                      <TableHead className="text-right">Retur</TableHead>
                      <TableHead className="text-right">Delivered Rate</TableHead>
                      <TableHead className="text-right">Return Rate</TableHead>
                      <TableHead className="text-right">Omset</TableHead>
                      <TableHead className="text-right">Selisih Ongkir</TableHead>
                      <TableHead className="text-right">Ads</TableHead>
                      <TableHead className="text-right">Profit Setelah Ads</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.summary.length === 0 ? (
                      <TableRow><TableCell colSpan={10} className="text-center py-8 text-sm text-muted-foreground">Belum ada data di filter ini.</TableCell></TableRow>
                    ) : data.summary.map((row) => (
                      <TableRow key={row.platform}>
                        <TableCell className="font-medium">{row.platform}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(row.total_orders)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(row.delivered)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(row.retur)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatPercent(row.delivered_rate, 1)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatPercent(row.return_rate, 1)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatRupiah(row.omset)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatRupiah(row.shipping_diff)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatRupiah(row.ads_allocated)}</TableCell>
                        <TableCell className={`text-right tabular-nums ${moneyClass(row.profit_after_ads)}`}>{formatRupiah(row.profit_after_ads)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <div className="font-semibold">Produk × Platform</div>
                  <div className="text-xs text-muted-foreground">Diurutkan dari paling boncos dulu, fokus ke Profit Setelah Ads.</div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produk</TableHead>
                      <TableHead>Platform</TableHead>
                      <TableHead className="text-right">Orders</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Delivered</TableHead>
                      <TableHead className="text-right">Retur</TableHead>
                      <TableHead className="text-right">Delivered Rate</TableHead>
                      <TableHead className="text-right">Return Rate</TableHead>
                      <TableHead className="text-right">Omset</TableHead>
                      <TableHead className="text-right">Selisih Ongkir</TableHead>
                      <TableHead className="text-right">Ads</TableHead>
                      <TableHead className="text-right">Profit Setelah Ads</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.productPlatform.length === 0 ? (
                      <TableRow><TableCell colSpan={12} className="text-center py-8 text-sm text-muted-foreground">Belum ada row Produk × Platform.</TableCell></TableRow>
                    ) : data.productPlatform.map((row, idx) => (
                      <TableRow key={`${row.product_id || 'x'}-${row.platform}-${idx}`}>
                        <TableCell className="font-medium">{row.product_name}</TableCell>
                        <TableCell>{row.platform}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(row.total_orders)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(row.qty)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(row.delivered)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(row.retur)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatPercent(row.delivered_rate, 1)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatPercent(row.return_rate, 1)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatRupiah(row.omset)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatRupiah(row.shipping_diff)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatRupiah(row.ads_allocated)}</TableCell>
                        <TableCell className={`text-right tabular-nums ${moneyClass(row.profit_after_ads)}`}>{formatRupiah(row.profit_after_ads)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  )
}
