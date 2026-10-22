'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { isCalendarDate } from '@/lib/date/ranges'
import { getErrorMessage } from '@/lib/errors'
import Link from 'next/link'
import { useRouter, useParams } from 'next/navigation'
import { ArrowLeft, Users, ShieldOff } from 'lucide-react'
import { toast } from 'sonner'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer,
} from 'recharts'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { StatCard } from '@/components/ui/stat-card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { DateRangePicker, thisMonth, type DateRange } from '@/components/ui/date-range-picker'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { canViewTeamPerformance } from '@/lib/auth/permissions'
import { CsRegions } from '@/components/team/cs-regions'
import { fetchCsTeamDetail } from '@/lib/supabase/queries/team'
import { formatRupiah, formatDateTime } from '@/lib/format'
import { ORDER_STATUSES } from '@/lib/constants'
import type { CsDetailResponse } from '@/lib/types'
import { ProductBreakdownChart } from '@/components/team/product-breakdown-chart'
import { ProductBreakdownTable } from '@/components/team/product-breakdown-table'

const supabase = createClient()

export default function CsDetailPage() {
  const router = useRouter()
  const [csOptions, setCsOptions] = useState<{id:string;full_name:string}[]>([])
  const params = useParams<{ userId: string }>()
  const userId = params?.userId ?? ''
  const { role, loading: authLoading } = useAuth()
  const allowed = canViewTeamPerformance(role)

  const [range, setRange] = useState<DateRange>(thisMonth)
  const [rangeReady, setRangeReady] = useState(false)
  const [data, setData] = useState<CsDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const from = params.get('from') || '', to = params.get('to') || ''
    // Read browser URL after SSR to keep hydration stable.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isCalendarDate(from) && isCalendarDate(to) && from <= to) setRange({ from, to })
    setRangeReady(true)
  }, [])
  useEffect(() => {
    if (!allowed) return
    let cancelled = false
    void supabase.from('profiles').select('id,full_name').eq('role', 'cs').order('full_name').then(({data}) => {
      if (!cancelled) setCsOptions(data || [])
    })
    return () => { cancelled = true }
  }, [allowed])

  const requestRef = useRef(0)
  const load = useCallback(async () => {
    const request = ++requestRef.current
    if (!rangeReady || !allowed || !userId) return
    setLoading(true)
    setData(null)
    try {
      const d = await fetchCsTeamDetail(supabase, userId, range.from, range.to)
      if (request === requestRef.current) setData(d)
    } catch (err) {
      if (request === requestRef.current) toast.error('Gagal load data', { description: getErrorMessage(err) })
    } finally {
      if (request === requestRef.current) setLoading(false)
    }
  }, [allowed, rangeReady, userId, range.from, range.to])

  // Fetch remote metrics and invalidate stale responses when the range changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); return () => { requestRef.current++ } }, [load])

  if (authLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>
  if (!allowed) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-500">
              <ShieldOff className="size-5" /> Akses ditolak
            </CardTitle>
            <CardDescription>Halaman ini hanya untuk owner atau admin.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  const stats = data?.stats
  const orderStatusMap = Object.fromEntries(ORDER_STATUSES.map(s => [s.value, s]))

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={`/team/cs?from=${range.from}&to=${range.to}`} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
          Kembali ke Daftar CS
        </Link>
        <div className="flex flex-wrap gap-2">
          <select aria-label="Pilih CS" value={userId} onChange={e => router.push(`/team/cs/${e.target.value}?from=${range.from}&to=${range.to}`)} className="rounded border bg-background px-3 py-2 text-sm">
            <option value={userId}>{stats?.full_name || 'Pilih CS'}</option>
            {csOptions.filter(cs => cs.id !== userId).map(cs => <option key={cs.id} value={cs.id}>{cs.full_name}</option>)}
          </select>
          <DateRangePicker value={range} onChange={setRange} />
        </div>
      </div>

      <PageHeader
        title={stats?.full_name || (loading ? 'Memuat…' : 'CS tidak ditemukan')}
        description={stats?.email || 'Detail performance per periode.'}
        icon={Users}
        badge={
          stats && (
            <Badge variant="outline" className={stats.is_active ? 'bg-emerald-500/10 text-emerald-600' : 'bg-zinc-500/10 text-zinc-500'}>
              {stats.is_active ? 'Aktif' : 'Nonaktif'}
            </Badge>
          )
        }
      />

      <p className="text-sm text-muted-foreground">Pengiriman berdasarkan tanggal dibuat di SPX, {range.from} – {range.to} WIB. Delivered adalah kiriman diterima, bukan jumlah closing dari laporan harian CS.</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="GB dengan resi" value={String(stats?.gb_with_resi ?? '—')} sub="berdasarkan tanggal order GB" />
        <StatCard label="GB belum ada resi" value={String(stats?.gb_without_resi ?? '—')} sub="termasuk order WA dalam periode" />
        <StatCard label="Returned" value={String(stats?.retur_count ?? '—')} sub={`${stats?.retur_rate ?? 0}% dari resi periode SPX`} />
        <StatCard label="Closing laporan CS" value={String(stats?.closing_reported ?? '—')} sub={`${stats?.leads_reported ?? 0} leads dilaporkan`} />
      </div>
      {!!stats?.incomplete_hpp_orders && <p role="status" className="text-sm text-amber-600">{stats.incomplete_hpp_orders} order delivered belum memiliki HPP lengkap. Profit masih estimasi.</p>}
      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Resi SPX" value={stats ? stats.total_orders.toLocaleString('id-ID') : '—'} />
        <StatCard label="Delivered" value={stats ? stats.closing_count.toLocaleString('id-ID') : '—'} />
        <StatCard
          label="Conv rate"
          value={stats ? `${stats.conv_rate.toFixed(1)}%` : '—'}
          tone={stats && stats.conv_rate >= 50 ? 'emerald' : stats && stats.conv_rate >= 30 ? 'amber' : 'default'}
        />
        <StatCard label="Komisi unpaid" value={stats ? formatRupiah(stats.commission_unpaid) : '—'} sub="EARNED, belum PAID" />
      </div>

      {/* Daily trend chart */}
      <Card>
        <CardContent className="p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-2">
            Daily trend
          </p>
          {!data || data.daily_trend.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">
              Tidak ada data di periode ini
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={data.daily_trend} margin={{ top: 8, right: 8, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(148 163 184 / 0.2)" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <RechartsTooltip
                  contentStyle={{ background: 'rgb(15 23 42 / 0.95)', border: '1px solid rgb(148 163 184 / 0.3)', borderRadius: 6, fontSize: 12 }}
                />
                <Area type="monotone" dataKey="orders"  stroke="#3f6fd1" fill="#3f6fd1" fillOpacity={0.3} name="orders" />
                <Area type="monotone" dataKey="closing" stroke="#10b981" fill="#10b981" fillOpacity={0.3} name="delivered" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card><CardContent className="p-4 space-y-3">
        <h2 className="font-semibold">Produk paling banyak dipesan melalui CS</h2>
        <p className="text-xs text-muted-foreground">Mengikuti tanggal order GB, termasuk WA yang belum memiliki resi. Satu order dengan beberapa produk dihitung pada masing-masing produk.</p>
        <div className="overflow-x-auto"><Table>
          <TableHeader><TableRow><TableHead>Produk</TableHead><TableHead>Order GB</TableHead><TableHead>Jumlah barang</TableHead><TableHead>Dengan resi</TableHead><TableHead>Belum ada resi</TableHead></TableRow></TableHeader>
          <TableBody>{(data?.gb_products ?? []).map(p => <TableRow key={`${p.product_id}:${p.product_name}`}><TableCell>{p.product_name}</TableCell><TableCell>{p.orders}</TableCell><TableCell>{p.units}</TableCell><TableCell>{p.with_resi}</TableCell><TableCell>{p.without_resi}</TableCell></TableRow>)}</TableBody>
        </Table></div>
      </CardContent></Card>
      {/* Per-produk breakdown chart */}
      <Card>
        <CardContent className="p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-2">
            Produk dengan delivered terbanyak
          </p>
          <ProductBreakdownChart rows={data?.product_breakdown ?? []} />
        </CardContent>
      </Card>

      <CsRegions rows={data?.regions ?? []} />

      {/* Tabs */}
      <Tabs defaultValue="orders">
        <TabsList>
          <TabsTrigger value="orders">Recent Orders ({data?.recent_orders.length ?? 0})</TabsTrigger>
          <TabsTrigger value="commissions">Commission History ({data?.commission_history.length ?? 0})</TabsTrigger>
          <TabsTrigger value="products">Per Produk ({data?.product_breakdown.length ?? 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="orders">
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              {!data || data.recent_orders.length === 0 ? (
                <EmptyState icon={Users} title="Tidak ada order di periode ini" description="Coba ganti date range." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order #</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Resi</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Tanggal</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.recent_orders.map(o => {
                      const s = orderStatusMap[o.status]
                      return (
                        <TableRow key={`${o.source}:${o.id}`}>
                          <TableCell>
                            <Link href={`/orders/data?q=${encodeURIComponent(o.order_number)}`} className="text-zinc-500 hover:underline font-mono text-xs">
                              {o.order_number}
                            </Link>
                          </TableCell>
                          <TableCell className="font-medium">{o.customer_name}</TableCell>
                          <TableCell><span className="font-mono text-xs">{o.tracking_no || '—'}</span></TableCell>
                          <TableCell>
                            <Badge variant="outline" className={s?.color || ''}>{s?.label || o.status}</Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{formatRupiah(o.total)}</TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">{formatDateTime(o.spx_created_at || o.created_at)}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="products">
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <ProductBreakdownTable rows={data?.product_breakdown ?? []} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="commissions">
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              {!data || data.commission_history.length === 0 ? (
                <EmptyState icon={Users} title="Tidak ada komisi di periode ini" description="Komisi muncul setelah order DITERIMA / RETUR." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order #</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Created</TableHead>
                      <TableHead className="text-right">Paid</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.commission_history.map(c => (
                      <TableRow key={c.id}>
                        <TableCell>
                          {c.order_number ? (
                            <span className="font-mono text-xs">{c.order_number}</span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={
                            c.status === 'PAID' ? 'bg-emerald-500/15 text-emerald-700' :
                            c.status === 'EARNED' ? 'bg-zinc-500/15 text-zinc-700' :
                            c.status === 'CANCELLED' ? 'bg-red-500/15 text-red-700' :
                            'bg-zinc-500/15 text-zinc-700'
                          }>
                            {c.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatRupiah(c.amount)}</TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">{formatDateTime(c.created_at)}</TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">{c.paid_at ? formatDateTime(c.paid_at) : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
