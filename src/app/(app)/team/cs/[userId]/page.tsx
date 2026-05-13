'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, Users, ShieldOff } from 'lucide-react'
import { toast } from 'sonner'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer,
} from 'recharts'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { DateRangePicker, thisMonth, type DateRange } from '@/components/ui/date-range-picker'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { canViewTeamPerformance } from '@/lib/auth/permissions'
import { fetchCsTeamDetail } from '@/lib/supabase/queries/team'
import { formatRupiah, formatDateTime } from '@/lib/format'
import { ORDER_STATUSES } from '@/lib/constants'
import type { CsDetailResponse } from '@/lib/types'
import { cn } from '@/lib/utils'
import { ProductBreakdownChart } from '@/components/team/product-breakdown-chart'
import { ProductBreakdownTable } from '@/components/team/product-breakdown-table'

const supabase = createClient()

export default function CsDetailPage() {
  const params = useParams<{ userId: string }>()
  const userId = params?.userId ?? ''
  const { role, loading: authLoading } = useAuth()
  const allowed = canViewTeamPerformance(role)

  const [range, setRange] = useState<DateRange>(thisMonth)
  const [rangeReady, setRangeReady] = useState(false)
  const [data, setData] = useState<CsDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { setRange(thisMonth()); setRangeReady(true) }, [])

  const load = useCallback(async () => {
    if (!rangeReady || !allowed || !userId) return
    setLoading(true)
    try {
      const d = await fetchCsTeamDetail(supabase, userId, range.from, range.to)
      setData(d)
    } catch (err) {
      toast.error('Gagal load data', { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setLoading(false)
    }
  }, [allowed, rangeReady, userId, range.from, range.to])

  useEffect(() => { load() }, [load])

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
        <Link href="/team/cs" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
          Kembali ke Daftar CS
        </Link>
        <DateRangePicker value={range} onChange={setRange} />
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

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Orders" value={stats ? stats.total_orders.toLocaleString('id-ID') : '—'} />
        <StatCard label="Closing" value={stats ? stats.closing_count.toLocaleString('id-ID') : '—'} />
        <StatCard
          label="Conv rate"
          value={stats ? `${stats.conv_rate.toFixed(1)}%` : '—'}
          valueClass={stats && stats.conv_rate >= 50 ? 'text-emerald-500' : stats && stats.conv_rate >= 30 ? 'text-amber-500' : ''}
        />
        <StatCard label="Komisi unpaid" value={stats ? formatRupiah(stats.commission_unpaid) : '—'} hint="EARNED, belum PAID" />
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
                <Area type="monotone" dataKey="orders"  stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.3} name="orders" />
                <Area type="monotone" dataKey="closing" stroke="#10b981" fill="#10b981" fillOpacity={0.3} name="closing" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Per-produk breakdown chart */}
      <Card>
        <CardContent className="p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-2">
            Breakdown per produk
          </p>
          <ProductBreakdownChart rows={data?.product_breakdown ?? []} />
        </CardContent>
      </Card>

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
                      <TableHead>Channel</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Tanggal</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.recent_orders.map(o => {
                      const s = orderStatusMap[o.status]
                      return (
                        <TableRow key={o.id}>
                          <TableCell>
                            <Link href={`/orders/${o.id}`} className="text-violet-500 hover:underline font-mono text-xs">
                              {o.order_number}
                            </Link>
                          </TableCell>
                          <TableCell className="font-medium">{o.customer_name}</TableCell>
                          <TableCell><span className="font-mono text-xs">{o.channel_code || '—'}</span></TableCell>
                          <TableCell>
                            <Badge variant="outline" className={s?.color || ''}>{s?.label || o.status}</Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{formatRupiah(o.total)}</TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">{formatDateTime(o.created_at)}</TableCell>
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
                            c.status === 'EARNED' ? 'bg-blue-500/15 text-blue-700' :
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

function StatCard({ label, value, hint, valueClass }: { label: string; value: string; hint?: string; valueClass?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
        <p className={cn('text-2xl font-bold tabular-nums mt-1', valueClass)}>{value}</p>
        {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
      </CardContent>
    </Card>
  )
}
