'use client'
// =============================================================
// /shipping-diff — Phase 6.5 revival
//
// Per-order shipping diff: 3 angka ongkir (customer/gross/net) + 2 selisih
// (margin sebelum vs setelah cashback). Filter by date range, channel,
// courier, status. Stat cards summary di top, sortable table di bawah.
// =============================================================
import { useState, useEffect, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Truck, RefreshCw, Loader2, Package, TrendingUp, TrendingDown,
  AlertTriangle, ChevronUp, ChevronDown, ArrowUpDown,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { DateRangePicker, thisMonth, type DateRange } from '@/components/ui/date-range-picker'
import { formatRupiah, formatDate } from '@/lib/format'
import {
  fetchShippingDiffRows, fetchShippingDiffSummary,
  type ShippingDiffRow, type ShippingDiffSummary,
} from '@/lib/supabase/queries/shipping-diff'
import { INTERNAL_STATUSES, STATUS_BADGE_COLOR, STATUS_LABEL } from '@/lib/schemas/settings'
import type { OrderStatus } from '@/lib/types'

const supabase = createClient()

type SortKey =
  | 'order_date' | 'order_number' | 'channel' | 'courier'
  | 'ongkir_customer' | 'ongkir_gross' | 'ongkir_net'
  | 'selisih_net' | 'margin_pct_net'
type SortDir = 'asc' | 'desc'

interface Option { id: number; name: string }

export default function ShippingDiffPage() {
  const { role, loading: authLoading } = useAuth()
  const canAccess = role === 'owner' || role === 'admin'

  const [range, setRange] = useState<DateRange>(thisMonth)
  const [rangeReady, setRangeReady] = useState(false)
  const [channels, setChannels] = useState<Option[]>([])
  const [couriers, setCouriers] = useState<Option[]>([])

  const [channelId, setChannelId] = useState<string>('ALL')
  const [courierId, setCourierId] = useState<string>('ALL')
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'ALL'>('ALL')

  const [rows, setRows] = useState<ShippingDiffRow[]>([])
  const [summary, setSummary] = useState<ShippingDiffSummary | null>(null)
  const [loading, setLoading] = useState(true)

  const [sortKey, setSortKey] = useState<SortKey>('order_date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  useEffect(() => {
    setRange(thisMonth())
    setRangeReady(true)
  }, [])

  // Load dropdown options once
  useEffect(() => {
    const loadOpts = async () => {
      const [{ data: ch }, { data: co }] = await Promise.all([
        supabase.from('courier_channels').select('id, name').eq('active', true).order('name'),
        supabase.from('couriers').select('id, name').eq('active', true).order('name'),
      ])
      setChannels((ch || []) as Option[])
      setCouriers((co || []) as Option[])
    }
    void loadOpts()
  }, [])

  const load = useCallback(async () => {
    if (!rangeReady || !canAccess) return
    setLoading(true)
    try {
      const args = {
        from: range.from,
        to: range.to,
        channelId: channelId === 'ALL' ? null : Number(channelId),
        courierId: courierId === 'ALL' ? null : Number(courierId),
        status: statusFilter,
      }
      const [r, s] = await Promise.all([
        fetchShippingDiffRows(supabase, args),
        fetchShippingDiffSummary(supabase, args),
      ])
      setRows(r)
      setSummary(s)
    } finally {
      setLoading(false)
    }
  }, [range.from, range.to, rangeReady, canAccess, channelId, courierId, statusFilter])

  useEffect(() => {
    if (!authLoading) void load()
  }, [authLoading, load])

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setSortDir(k === 'order_date' ? 'desc' : 'asc') }
  }

  const sortedRows = useMemo(() => {
    const dir = sortDir === 'desc' ? -1 : 1
    return [...rows].sort((a, b) => {
      let av: string | number, bv: string | number
      switch (sortKey) {
        case 'order_number':
          av = a.order_number; bv = b.order_number
          return av.localeCompare(bv) * dir
        case 'channel':
          av = a.channel_name ?? ''; bv = b.channel_name ?? ''
          return av.localeCompare(bv) * dir
        case 'courier':
          av = a.courier_name ?? ''; bv = b.courier_name ?? ''
          return av.localeCompare(bv) * dir
        case 'ongkir_customer':
          return (Number(a.ongkir_customer) - Number(b.ongkir_customer)) * dir
        case 'ongkir_gross':
          return (Number(a.ongkir_gross) - Number(b.ongkir_gross)) * dir
        case 'ongkir_net':
          return (Number(a.ongkir_net) - Number(b.ongkir_net)) * dir
        case 'selisih_net':
          return (Number(a.selisih_net) - Number(b.selisih_net)) * dir
        case 'margin_pct_net':
          return (Number(a.margin_pct_net) - Number(b.margin_pct_net)) * dir
        case 'order_date':
        default:
          av = a.order_date; bv = b.order_date
          if (av !== bv) return av.localeCompare(bv) * dir
          // Tiebreaker: order_id desc untuk stable
          return (b.order_id - a.order_id) * dir
      }
    })
  }, [rows, sortKey, sortDir])

  if (authLoading) return null
  if (!canAccess) {
    return (
      <div className="space-y-6">
        <PageHeader icon={Truck} title="Selisih Ongkir" />
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          Page ini owner/admin only. Untuk overview shipping diff per channel, buka{' '}
          <Link href="/analytics?section=channel" className="text-violet-500 hover:underline">
            /analytics → Per Channel
          </Link>.
        </CardContent></Card>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Truck}
        title="Selisih Ongkir per Order"
        description="3 angka ongkir per order — yang lu charge customer vs tagihan ekspedisi gross vs after cashback. Identify margin profit / loss tersembunyi."
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <DateRangePicker value={range} onChange={setRange} />
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            </Button>
          </div>
        }
      />

      {/* Filter bar */}
      <Card>
        <CardContent className="pt-4 pb-4 flex flex-col sm:flex-row gap-3">
          <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Channel</label>
              <Select value={channelId} onValueChange={v => v && setChannelId(v)}>
                <SelectTrigger><SelectValue placeholder="Channel">{(v: string | null) => !v || v === 'ALL' ? 'Semua channel' : (channels.find(c => String(c.id) === v)?.name ?? v)}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Semua channel</SelectItem>
                  {channels.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Courier</label>
              <Select value={courierId} onValueChange={v => v && setCourierId(v)}>
                <SelectTrigger><SelectValue placeholder="Courier">{(v: string | null) => !v || v === 'ALL' ? 'Semua courier' : (couriers.find(c => String(c.id) === v)?.name ?? v)}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Semua courier</SelectItem>
                  {couriers.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Status</label>
              <Select value={statusFilter} onValueChange={v => v && setStatusFilter(v as OrderStatus | 'ALL')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Semua status</SelectItem>
                  {INTERNAL_STATUSES.map(s => (
                    <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={Package} color="violet"
          label="Total Orders"
          value={String(summary?.total_orders ?? 0)}
          sub={`${summary?.orders_profit ?? 0} profit · ${summary?.orders_breakeven ?? 0} BE · ${summary?.orders_with_loss ?? 0} loss`}
        />
        <StatCard
          icon={TrendingUp} color={(summary?.total_selisih_net ?? 0) >= 0 ? 'emerald' : 'red'}
          label="Selisih After CB"
          value={formatRupiah(summary?.total_selisih_net ?? 0)}
          sub="margin actual setelah cashback"
        />
        <StatCard
          icon={TrendingUp} color="amber"
          label="Selisih Before CB"
          value={formatRupiah(summary?.total_selisih_gross ?? 0)}
          sub="charge − gross"
        />
        <StatCard
          icon={summary && summary.avg_margin_pct_net >= 0 ? TrendingUp : TrendingDown}
          color={summary && summary.avg_margin_pct_net >= 0 ? 'emerald' : 'red'}
          label="Avg Margin %"
          value={`${(summary?.avg_margin_pct_net ?? 0).toFixed(2)}%`}
          sub={`gross avg: ${(summary?.avg_margin_pct_gross ?? 0).toFixed(2)}%`}
        />
      </div>

      {/* Detail breakdown */}
      {summary && summary.total_orders > 0 && (
        <Card className="border-zinc-500/30 bg-zinc-500/5">
          <CardContent className="pt-4 pb-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <Detail label="Total charge customer" value={formatRupiah(summary.total_ongkir_customer)} />
            <Detail label="Total gross ekspedisi" value={formatRupiah(summary.total_ongkir_gross)} />
            <Detail label="Total net after CB" value={formatRupiah(summary.total_ongkir_net)} />
            <Detail label="Total cashback" value={formatRupiah(summary.total_cashback)} />
          </CardContent>
        </Card>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHead k="order_number" current={sortKey} dir={sortDir} onClick={toggleSort} label="Order #" />
                <SortHead k="order_date" current={sortKey} dir={sortDir} onClick={toggleSort} label="Date" />
                <SortHead k="channel" current={sortKey} dir={sortDir} onClick={toggleSort} label="Channel" />
                <SortHead k="courier" current={sortKey} dir={sortDir} onClick={toggleSort} label="Courier" />
                <TableHead>Status</TableHead>
                <SortHead k="ongkir_customer" current={sortKey} dir={sortDir} onClick={toggleSort} label="Charge" align="right" />
                <SortHead k="ongkir_gross" current={sortKey} dir={sortDir} onClick={toggleSort} label="Gross" align="right" />
                <SortHead k="ongkir_net" current={sortKey} dir={sortDir} onClick={toggleSort} label="Net" align="right" />
                <TableHead className="text-right">Cashback</TableHead>
                <SortHead k="selisih_net" current={sortKey} dir={sortDir} onClick={toggleSort} label="Sel Net" align="right" />
                <SortHead k="margin_pct_net" current={sortKey} dir={sortDir} onClick={toggleSort} label="Margin %" align="right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={11} className="py-12 text-center">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                  </TableCell>
                </TableRow>
              ) : sortedRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="p-0">
                    <EmptyState
                      icon={Truck}
                      title="Belum ada order dalam filter ini"
                      description="Coba ubah date range atau filter — atau cek bahwa orders sudah punya shipping_cost + shipping_cost_actual."
                    />
                  </TableCell>
                </TableRow>
              ) : sortedRows.map(r => {
                const selNet = Number(r.selisih_net)
                const marginNet = Number(r.margin_pct_net)
                const selClass = selNet > 0
                  ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                  : selNet < 0
                    ? 'text-red-600 dark:text-red-400 font-medium'
                    : 'text-muted-foreground'
                return (
                  <TableRow key={r.order_id}>
                    <TableCell>
                      <Link href={`/orders/${r.order_id}`} className="font-mono text-xs text-violet-500 hover:underline">
                        {r.order_number}
                      </Link>
                      <div className="text-[10px] text-muted-foreground truncate max-w-[200px]">{r.customer_name}</div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(r.order_date)}</TableCell>
                    <TableCell className="text-xs">{r.channel_name || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-xs">{r.courier_name || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] ${STATUS_BADGE_COLOR[r.status]}`}>
                        {STATUS_LABEL[r.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-xs">{formatRupiah(Number(r.ongkir_customer))}</TableCell>
                    <TableCell className="text-right text-xs">{formatRupiah(Number(r.ongkir_gross))}</TableCell>
                    <TableCell className="text-right text-xs">{formatRupiah(Number(r.ongkir_net))}</TableCell>
                    <TableCell className="text-right text-xs">
                      {Number(r.cashback_amount) > 0 ? (
                        <div>
                          <div className="text-emerald-600 dark:text-emerald-400">{formatRupiah(Number(r.cashback_amount))}</div>
                          <div className="text-[10px] text-muted-foreground">{Number(r.cashback_pct).toFixed(0)}%</div>
                        </div>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className={`text-right text-xs whitespace-nowrap ${selClass}`}>
                      {selNet > 0 ? '+' : ''}{formatRupiah(selNet)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant="outline" className={`text-[10px] ${marginNet >= 30 ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' : marginNet >= 0 ? 'bg-amber-500/10 text-amber-600 border-amber-500/30' : 'bg-red-500/10 text-red-600 border-red-500/30'}`}>
                        {marginNet.toFixed(1)}%
                      </Badge>
                    </TableCell>
                  </TableRow>
                )
              })}
              {/* Footer totals row */}
              {!loading && sortedRows.length > 0 && summary && (
                <TableRow className="bg-muted/30 font-semibold border-t-2">
                  <TableCell colSpan={5}>TOTAL ({summary.total_orders} order)</TableCell>
                  <TableCell className="text-right text-xs">{formatRupiah(summary.total_ongkir_customer)}</TableCell>
                  <TableCell className="text-right text-xs">{formatRupiah(summary.total_ongkir_gross)}</TableCell>
                  <TableCell className="text-right text-xs">{formatRupiah(summary.total_ongkir_net)}</TableCell>
                  <TableCell className="text-right text-xs text-emerald-600 dark:text-emerald-400">{formatRupiah(summary.total_cashback)}</TableCell>
                  <TableCell className={`text-right text-xs ${summary.total_selisih_net >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                    {summary.total_selisih_net > 0 ? '+' : ''}{formatRupiah(summary.total_selisih_net)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant="outline" className={`text-[10px] ${summary.avg_margin_pct_net >= 30 ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' : summary.avg_margin_pct_net >= 0 ? 'bg-amber-500/10 text-amber-600 border-amber-500/30' : 'bg-red-500/10 text-red-600 border-red-500/30'}`}>
                      {summary.avg_margin_pct_net.toFixed(1)}%
                    </Badge>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Legend */}
      <Card className="border-blue-500/20 bg-blue-500/5">
        <CardContent className="pt-4 pb-4 text-xs space-y-2">
          <p className="font-medium">📊 Legend kolom:</p>
          <ul className="text-muted-foreground space-y-1 list-disc list-inside">
            <li><strong>Charge</strong> = ongkir yang lu charge ke customer (<code>orders.shipping_cost</code>)</li>
            <li><strong>Gross</strong> = tagihan ekspedisi sebelum cashback (<code>orders.shipping_cost_actual</code>)</li>
            <li><strong>Net</strong> = tagihan setelah cashback (<code>orders.estimated_shipping_net</code>, dari Phase 4C engine)</li>
            <li><strong>Cashback</strong> = gross − net (positive berarti dapat cashback dari ekspedisi)</li>
            <li><strong>Sel Net</strong> = charge − net (margin actual setelah cashback — angka final profit ongkir)</li>
            <li><strong>Margin %</strong> = sel_net / charge × 100. <span className="text-emerald-600">≥30% bagus</span> · <span className="text-amber-600">0-30% tipis</span> · <span className="text-red-600">&lt;0% rugi</span></li>
          </ul>
          <p className="pt-1 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
            <span>Order tanpa <code>shipping_cost_actual</code> (pre-Phase 4C atau belum di-trigger compute) di-fallback ke <code>shipping_cost</code> — selisih jadi 0.</span>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

// =============================================================
// Sub-components
// =============================================================

function StatCard({ icon: Icon, color, label, value, sub }: {
  icon: typeof Truck
  color: 'violet' | 'emerald' | 'amber' | 'red'
  label: string
  value: string
  sub: string
}) {
  const colorClass: Record<typeof color, string> = {
    violet: 'bg-violet-500/15 ring-violet-500/20 text-violet-500',
    emerald: 'bg-emerald-500/15 ring-emerald-500/20 text-emerald-500',
    amber: 'bg-amber-500/15 ring-amber-500/20 text-amber-500',
    red: 'bg-red-500/15 ring-red-500/20 text-red-500',
  }
  return (
    <Card>
      <CardContent className="pt-4 pb-4 flex items-center gap-3">
        <div className={`p-2.5 rounded-xl ring-1 ${colorClass[color]}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
          <p className="text-xl font-bold truncate">{value}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{sub}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  )
}

function SortHead({
  k, current, dir, onClick, label, align = 'left',
}: {
  k: SortKey
  current: SortKey
  dir: SortDir
  onClick: (k: SortKey) => void
  label: string
  align?: 'left' | 'right'
}) {
  const active = k === current
  return (
    <TableHead
      className={`cursor-pointer select-none hover:bg-muted/50 text-${align}`}
      onClick={() => onClick(k)}
    >
      <span className={`inline-flex items-center gap-1 ${active ? 'text-violet-500 font-semibold' : ''}`}>
        {label}
        {active
          ? dir === 'desc' ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />
          : <ArrowUpDown className="w-3 h-3 opacity-30" />}
      </span>
    </TableHead>
  )
}
