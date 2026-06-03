'use client'
import { useCallback, useEffect, useState } from 'react'
import { getErrorMessage } from '@/lib/errors'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, Megaphone, ShieldOff } from 'lucide-react'
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
import { EmptyState } from '@/components/ui/empty-state'
import { DateRangePicker, thisMonth, type DateRange } from '@/components/ui/date-range-picker'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { canViewTeamPerformance } from '@/lib/auth/permissions'
import { fetchAdvertiserTeamDetail } from '@/lib/supabase/queries/team'
import { formatRupiah, formatDateTime } from '@/lib/format'
import type { AdvertiserDetailResponse } from '@/lib/types'
import { cn } from '@/lib/utils'
import { ProductBreakdownChart } from '@/components/team/product-breakdown-chart'
import { ProductBreakdownTable } from '@/components/team/product-breakdown-table'

const supabase = createClient()

const CAMPAIGN_STATUS_COLOR: Record<string, string> = {
  ACTIVE: 'bg-emerald-500/15 text-emerald-700',
  PAUSED: 'bg-amber-500/15 text-amber-700',
  ENDED:  'bg-zinc-500/15 text-zinc-700',
}

export default function AdvertiserDetailPage() {
  const params = useParams<{ userId: string }>()
  const userId = params?.userId ?? ''
  const { role, loading: authLoading } = useAuth()
  const allowed = canViewTeamPerformance(role)

  const [range, setRange] = useState<DateRange>(thisMonth)
  const [rangeReady, setRangeReady] = useState(false)
  const [data, setData] = useState<AdvertiserDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { setRange(thisMonth()); setRangeReady(true) }, [])

  const load = useCallback(async () => {
    if (!rangeReady || !allowed || !userId) return
    setLoading(true)
    try {
      const d = await fetchAdvertiserTeamDetail(supabase, userId, range.from, range.to)
      setData(d)
    } catch (err) {
      toast.error('Gagal load data', { description: getErrorMessage(err) })
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

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/team/advertisers" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
          Kembali ke Daftar Advertiser
        </Link>
        <DateRangePicker value={range} onChange={setRange} />
      </div>

      <PageHeader
        title={stats?.full_name || (loading ? 'Memuat…' : 'Advertiser tidak ditemukan')}
        description={stats?.email || 'Detail performance per periode.'}
        icon={Megaphone}
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
        <StatCard label="Spend" value={stats ? formatRupiah(stats.total_spend) : '—'} />
        <StatCard label="Revenue" value={stats ? formatRupiah(stats.revenue_attributed) : '—'} />
        <StatCard
          label="ROAS"
          value={stats ? `${stats.roas.toFixed(2)}x` : '—'}
          valueClass={stats && stats.roas >= 2 ? 'text-emerald-500' : stats && stats.roas >= 1 ? 'text-amber-500' : 'text-red-500'}
        />
        <StatCard label="Komisi unpaid" value={stats ? formatRupiah(stats.commission_unpaid) : '—'} hint="EARNED, belum PAID" />
      </div>

      {/* Daily spend chart */}
      <Card>
        <CardContent className="p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-2">
            Daily spend
          </p>
          {!data || data.daily_spend.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">
              Tidak ada spend di periode ini
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={data.daily_spend} margin={{ top: 8, right: 8, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(148 163 184 / 0.2)" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${(Number(v) / 1000).toFixed(0)}k`} />
                <RechartsTooltip
                  contentStyle={{ background: 'rgb(15 23 42 / 0.95)', border: '1px solid rgb(148 163 184 / 0.3)', borderRadius: 6, fontSize: 12 }}
                  formatter={(value) => [formatRupiah(Number(value)), 'spend']}
                />
                <Area type="monotone" dataKey="spend" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.3} name="spend" />
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

      <Tabs defaultValue="campaigns">
        <TabsList>
          <TabsTrigger value="campaigns">Campaigns ({data?.campaigns.length ?? 0})</TabsTrigger>
          <TabsTrigger value="products">Per Produk ({data?.product_breakdown.length ?? 0})</TabsTrigger>
          <TabsTrigger value="commissions">Commission History ({data?.commission_history.length ?? 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="campaigns">
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              {!data || data.campaigns.length === 0 ? (
                <EmptyState icon={Megaphone} title="Tidak ada campaign untuk advertiser ini" description="Tambahkan campaign di /campaigns dan assign ke advertiser ini." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Campaign</TableHead>
                      <TableHead>Platform</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Spend</TableHead>
                      <TableHead className="text-right">Orders</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                      <TableHead className="text-right">ROAS</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.campaigns.map(c => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">
                          <Link href={`/campaigns?focus=${c.id}`} className="hover:underline">
                            {c.campaign_name}
                          </Link>
                        </TableCell>
                        <TableCell><span className="font-mono text-xs">{c.platform}</span></TableCell>
                        <TableCell>
                          <Badge variant="outline" className={CAMPAIGN_STATUS_COLOR[c.status] || ''}>
                            {c.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatRupiah(c.spend)}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.orders}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatRupiah(c.revenue)}</TableCell>
                        <TableCell className={cn('text-right tabular-nums', c.roas >= 2 ? 'text-emerald-500' : c.roas >= 1 ? 'text-amber-500' : 'text-red-500')}>
                          {c.roas.toFixed(2)}x
                        </TableCell>
                      </TableRow>
                    ))}
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
                <EmptyState icon={Megaphone} title="Tidak ada komisi di periode ini" description="Komisi advertiser muncul saat order dari campaign-nya DITERIMA." />
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
                          {c.order_number ? <span className="font-mono text-xs">{c.order_number}</span> : <span className="text-muted-foreground">—</span>}
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
