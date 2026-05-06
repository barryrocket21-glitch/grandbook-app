'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CheckCircle2, Clock, XCircle, Package, ClipboardCheck, Eye, AlertTriangle, TrendingUp, Truck } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { formatRupiah, formatDate } from '@/lib/format'
import Link from 'next/link'

const supabase = createClient()

const today = () => new Date().toISOString().split('T')[0]
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().split('T')[0] }
const startOfMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0] }

interface CommissionStats { today: number; week: number; month: number; earned: number; estimated: number }
interface PipelineRow { product_name: string; active_pipeline: number; oldest_days: number }

export default function CsDashboardPage() {
  const { profile, role, user, loading: authLoading } = useAuth()
  const [commission, setCommission] = useState<CommissionStats>({ today: 0, week: 0, month: 0, earned: 0, estimated: 0 })
  const [pipeline, setPipeline] = useState<PipelineRow[]>([])
  const [recentOrders, setRecentOrders] = useState<any[]>([])
  const [stats, setStats] = useState({ ordersToday: 0, ordersMonth: 0, returnedMonth: 0, shippingDiff: 0, shippingDiffCount: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user?.id) return
    const load = async () => {
      setLoading(true)
      const t = today()
      const w = daysAgo(6)
      const m = startOfMonth()

      const [
        { data: comms },
        { data: leads },
        { data: orders },
        { data: monthOrders },
      ] = await Promise.all([
        supabase
          .from('commissions')
          .select('amount, status, orders!inner(order_date, cs_id)')
          .eq('user_id', user.id)
          .gte('orders.order_date', m),
        supabase
          .from('cs_daily_leads')
          .select('product_id, leads_count, closing_count, rejected_count, report_date, products(name)')
          .eq('cs_id', user.id)
          .gte('report_date', daysAgo(60)),
        supabase
          .from('orders')
          .select('id, order_number, customer_name, total, status, order_date, resi_status')
          .eq('cs_id', user.id)
          .order('created_at', { ascending: false })
          .limit(10),
        supabase
          .from('orders')
          .select('id, order_date, status, resi_status, shipping_cost, shipping_cost_actual')
          .eq('cs_id', user.id)
          .gte('order_date', m)
          .is('duplicate_of', null),
      ])

      // Commission stats
      const cStats: CommissionStats = { today: 0, week: 0, month: 0, earned: 0, estimated: 0 }
      ;(comms || []).forEach((c: any) => {
        const amount = Number(c.amount)
        const date = c.orders.order_date
        if (c.status === 'CANCELLED') return
        cStats.month += amount
        if (date >= w) cStats.week += amount
        if (date === t) cStats.today += amount
        if (c.status === 'EARNED') cStats.earned += amount
        else if (c.status === 'ESTIMATED') cStats.estimated += amount
      })
      setCommission(cStats)

      // Pipeline: aggregate (leads - closing - rejected) per product
      const pipelineMap = new Map<number, { name: string; pipeline: number; oldestDate: string }>()
      ;(leads || []).forEach((l: any) => {
        const productId = l.product_id
        const productName = l.products?.name || 'Unknown'
        const pipelineDelta = l.leads_count - l.closing_count - l.rejected_count
        const existing = pipelineMap.get(productId) || { name: productName, pipeline: 0, oldestDate: l.report_date }
        existing.pipeline += pipelineDelta
        if (l.report_date < existing.oldestDate && pipelineDelta > 0) existing.oldestDate = l.report_date
        pipelineMap.set(productId, existing)
      })
      const today2 = new Date()
      const pipelineRows: PipelineRow[] = Array.from(pipelineMap.values())
        .filter(p => p.pipeline > 0)
        .map(p => ({
          product_name: p.name,
          active_pipeline: p.pipeline,
          oldest_days: Math.floor((today2.getTime() - new Date(p.oldestDate).getTime()) / (1000 * 60 * 60 * 24)),
        }))
        .sort((a, b) => b.active_pipeline - a.active_pipeline)
      setPipeline(pipelineRows)

      // Recent orders
      setRecentOrders(orders || [])

      // Order stats this month
      const todayOrders = (monthOrders || []).filter((o: any) => o.order_date === t).length
      const monthOrdersCount = (monthOrders || []).length
      const returned = (monthOrders || []).filter((o: any) => o.resi_status === 'RETUR' || o.status === 'RETUR').length
      let shippingDiff = 0
      let shippingDiffCount = 0
      ;(monthOrders || []).forEach((o: any) => {
        if (o.shipping_cost_actual !== null && o.shipping_cost_actual !== undefined) {
          const d = Number(o.shipping_cost) - Number(o.shipping_cost_actual)
          if (d !== 0) {
            shippingDiff += d
            shippingDiffCount += 1
          }
        }
      })
      setStats({ ordersToday: todayOrders, ordersMonth: monthOrdersCount, returnedMonth: returned, shippingDiff, shippingDiffCount })

      setLoading(false)
    }
    load()
  }, [user?.id])

  const totalPipelineActive = useMemo(() => pipeline.reduce((s, p) => s + p.active_pipeline, 0), [pipeline])
  const monthReturRate = stats.ordersMonth > 0 ? (stats.returnedMonth / stats.ordersMonth) * 100 : 0

  if (authLoading) return <div className="text-sm text-muted-foreground">Memeriksa akses...</div>
  if (role && !['cs', 'owner', 'admin'].includes(role)) {
    return (
      <Card className="max-w-md mx-auto mt-8">
        <CardContent className="pt-6 text-center space-y-2">
          <AlertTriangle className="w-10 h-10 text-yellow-500 mx-auto" />
          <h2 className="text-lg font-semibold">Akses Dibatasi</h2>
          <p className="text-sm text-muted-foreground">Halaman ini untuk role CS.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ClipboardCheck}
        title={`Halo, ${profile?.full_name || 'CS'} 👋`}
        description="Ringkasan komisi, pipeline lead, dan order kamu"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" render={<Link href="/cs-report" />}>
              <ClipboardCheck className="w-4 h-4 mr-2" />Laporan Harian
            </Button>
            <Button render={<Link href="/orders/new" />} className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/20">
              + Input Order
            </Button>
          </div>
        }
      />

      {/* Commission cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="overflow-hidden relative group hover:shadow-lg transition-shadow border-emerald-500/30">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-transparent" />
          <CardContent className="pt-4 pb-4 relative">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Confirmed</p>
            </div>
            <p className="text-xl font-bold text-emerald-500">{formatRupiah(commission.earned)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">akan dibayar bulan ini</p>
          </CardContent>
        </Card>
        <Card className="overflow-hidden relative group hover:shadow-lg transition-shadow border-amber-500/30">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/10 to-transparent" />
          <CardContent className="pt-4 pb-4 relative">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-amber-500" />
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Pending</p>
            </div>
            <p className="text-xl font-bold text-amber-500">{formatRupiah(commission.estimated)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">masih dikirim</p>
          </CardContent>
        </Card>
        <Card className="overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 relative">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Komisi 7 hari</p>
            <p className="text-xl font-bold mt-1">{formatRupiah(commission.week)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">earned + estimated</p>
          </CardContent>
        </Card>
        <Card className="overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 relative">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Komisi Hari Ini</p>
            <p className="text-xl font-bold mt-1">{formatRupiah(commission.today)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{stats.ordersToday} order hari ini</p>
          </CardContent>
        </Card>
      </div>

      {/* Order stats this month */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <div className="p-2.5 bg-violet-500/15 rounded-xl ring-1 ring-violet-500/20"><Package className="w-5 h-5 text-violet-500" /></div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Order Bulan Ini</p>
              <p className="text-xl font-bold">{stats.ordersMonth}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <div className="p-2.5 bg-amber-500/15 rounded-xl ring-1 ring-amber-500/20"><TrendingUp className="w-5 h-5 text-amber-500" /></div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Pipeline Aktif</p>
              <p className="text-xl font-bold">{totalPipelineActive}</p>
              <p className="text-[10px] text-muted-foreground">lead belum closing</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <div className="p-2.5 bg-red-500/15 rounded-xl ring-1 ring-red-500/20"><XCircle className="w-5 h-5 text-red-500" /></div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Retur Rate Bulan Ini</p>
              <p className="text-xl font-bold">{monthReturRate.toFixed(1)}%</p>
              <p className="text-[10px] text-muted-foreground">{stats.returnedMonth} retur dari {stats.ordersMonth}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <div className={`p-2.5 rounded-xl ring-1 ${stats.shippingDiff > 0 ? 'bg-emerald-500/15 ring-emerald-500/20' : stats.shippingDiff < 0 ? 'bg-red-500/15 ring-red-500/20' : 'bg-zinc-500/15 ring-zinc-500/20'}`}>
              <Truck className={`w-5 h-5 ${stats.shippingDiff > 0 ? 'text-emerald-500' : stats.shippingDiff < 0 ? 'text-red-500' : 'text-muted-foreground'}`} />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Selisih Ongkir</p>
              <p className={`text-xl font-bold ${stats.shippingDiff > 0 ? 'text-emerald-500' : stats.shippingDiff < 0 ? 'text-red-500' : ''}`}>
                {stats.shippingDiff > 0 ? '+' : ''}{formatRupiah(stats.shippingDiff)}
              </p>
              <p className="text-[10px] text-muted-foreground">{stats.shippingDiffCount} order tercatat</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pipeline */}
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold flex items-center gap-2"><TrendingUp className="w-4 h-4 text-amber-500" />Pipeline Lead Aktif</h3>
              <Badge variant="outline" className="text-xs">{totalPipelineActive} total</Badge>
            </div>
            {loading ? (
              <div className="h-32 bg-muted animate-pulse rounded" />
            ) : pipeline.length === 0 ? (
              <EmptyState compact icon={TrendingUp} title="Pipeline kosong" description="Semua lead sudah ter-closing atau ter-reject. Kerja bagus!" />
            ) : (
              <div className="space-y-2">
                {pipeline.slice(0, 5).map((p, i) => (
                  <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-muted/30 border">
                    <div>
                      <p className="font-medium text-sm">{p.product_name}</p>
                      <p className="text-[10px] text-muted-foreground">Lead tertua: {p.oldest_days} hari lalu {p.oldest_days > 30 && '⚠️'}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-amber-500">{p.active_pipeline}</p>
                      <p className="text-[10px] text-muted-foreground">aktif</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent orders */}
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold flex items-center gap-2"><Package className="w-4 h-4 text-violet-500" />Order Terakhir</h3>
              <Button variant="ghost" size="sm" render={<Link href="/orders/list" />}>Lihat semua</Button>
            </div>
            {loading ? (
              <div className="h-32 bg-muted animate-pulse rounded" />
            ) : recentOrders.length === 0 ? (
              <EmptyState compact icon={Package} title="Belum ada order" description="Order kamu akan muncul di sini." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Order</TableHead>
                    <TableHead className="text-xs">Customer</TableHead>
                    <TableHead className="text-xs text-right">Total</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentOrders.slice(0, 8).map(o => (
                    <TableRow key={o.id}>
                      <TableCell className="font-mono text-[11px]">{o.order_number}</TableCell>
                      <TableCell className="text-sm">{o.customer_name}</TableCell>
                      <TableCell className="text-right text-sm font-medium">{formatRupiah(o.total)}</TableCell>
                      <TableCell><Button variant="ghost" size="icon" render={<Link href={`/orders/${o.id}`} />}><Eye className="w-3.5 h-3.5" /></Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
