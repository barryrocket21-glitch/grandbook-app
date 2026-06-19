'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DollarSign, CircleDollarSign, Target, ShoppingCart, Package,
  AlertTriangle, RefreshCw, Activity, Scale, Wallet, ArrowRight,
  LayoutDashboard,
} from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell,
} from 'recharts'
import { formatRupiah, formatPercent, getToday, getStartOfMonth } from '@/lib/format'
import { PageHeader } from '@/components/ui/page-header'
import { PendingPickupWidget } from '@/components/dashboard/pending-pickup-widget'
import { CashflowSummaryWidget } from '@/components/dashboard/cashflow-summary-widget'

// Chart colors
const CHART_COLORS = ['#3f6fd1', '#71717a', '#a1a1aa', '#10b981', '#f59e0b', '#ef4444']

// Supabase client dibuat sekali di module level agar tidak trigger re-render loop
const supabase = createClient()

interface DashboardData {
  omzetHariIni: number
  omzetBulanIni: number
  totalOrdersHariIni: number
  totalOrdersBulanIni: number
  ordersByStatus: Record<string, number>
  totalAdSpendBulanIni: number
  blendedROAS: number
  // Brief #16 — EST (order berjalan/draft) vs AKTUAL (delivered). Sumber UNION
  // orders_draft + orders (akar masalah: orders kosong, order hidup di draft).
  estProfit: number
  estBiaya: number
  estFeeCod: number
  estPpn: number
  aktualProfit: number
  deliveredCount: number
  // Sub-brief #17 — pencairan COD (real, ganti placeholder #16)
  codCair: number
  codUncair: number
  uncairCount: number
  returPercentage: number
  fakePercentage: number
  dailyChart: Array<{ date: string; omzet: number; spend: number; profit: number }>
  topProducts: Array<{ name: string; qty: number; revenue: number }>
}

export default function DashboardPage() {
  const { profile, role } = useAuth()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const fetchingRef = useRef(false)

  const fetchDashboardData = useCallback(async () => {
    if (fetchingRef.current) return // prevent overlapping fetches
    fetchingRef.current = true
    try {
      const today = getToday()
      const startOfMonth = getStartOfMonth()

      // Brief #16 — sumber UNION: order berjalan ada di orders_draft, terminal
      // (delivered/retur/batal) di orders. Agregasi keuangan dari KEDUANYA.
      const SEL = 'total, status, order_date, estimated_profit, estimated_total_cost, estimated_cod_fee, estimated_ppn'
      const [
        { data: draftAllMonth },
        { data: ordersAllMonth },
        { data: adSpendMonth },
        { data: draftItems },
        { data: orderItems },
        { data: payoutPos },
      ] = await Promise.all([
        supabase.from('orders_draft').select(SEL).gte('order_date', startOfMonth),
        supabase.from('orders').select(SEL).gte('order_date', startOfMonth),
        supabase.from('ad_spend').select('spend, spend_date').gte('spend_date', startOfMonth),
        supabase.from('order_items_draft').select('qty, price, products(name), orders_draft!inner(order_date, status)').gte('orders_draft.order_date', startOfMonth),
        supabase.from('order_items').select('qty, price, products(name), orders!inner(order_date, status)').gte('orders.order_date', startOfMonth),
        supabase.rpc('get_payout_position'),
      ])
      const pay: any = Array.isArray(payoutPos) ? payoutPos[0] : null
      const codCair = Number(pay?.cair_total) || 0
      const codUncair = Number(pay?.uncair_total) || 0
      const uncairCount = Number(pay?.uncair_count) || 0
      const safeArr = (arr: any[] | null) => arr || []

      const TERMINAL = ['DITERIMA', 'RETUR', 'CANCEL', 'FAKE']
      const draftMonth = safeArr(draftAllMonth)   // order berjalan (EST)
      const ordersMonth = safeArr(ordersAllMonth) // order terminal (AKTUAL)
      const allMonth = [...draftMonth, ...ordersMonth]
      const allToday = allMonth.filter((o: any) => o.order_date === today)

      const sumOmzet = (arr: any[]) => arr
        .filter((o) => !['CANCEL', 'FAKE'].includes(o.status))
        .reduce((sum: number, o: any) => sum + Number(o.total), 0)
      const omzetHariIni = sumOmzet(allToday)
      const omzetBulanIni = sumOmzet(allMonth)

      // Orders by status (union)
      const ordersByStatus: Record<string, number> = {}
      allMonth.forEach((o: any) => {
        ordersByStatus[o.status] = (ordersByStatus[o.status] || 0) + 1
      })

      // Ad spend + ROAS
      const totalAdSpendBulanIni = safeArr(adSpendMonth).reduce(
        (sum: number, s: any) => sum + Number(s.spend), 0,
      )
      const blendedROAS = totalAdSpendBulanIni > 0 ? omzetBulanIni / totalAdSpendBulanIni : 0

      // EST (order berjalan, belum terminal) vs AKTUAL (delivered)
      const sumF = (arr: any[], k: string) => arr.reduce((s: number, o: any) => s + (Number(o[k]) || 0), 0)
      const running = allMonth.filter((o: any) => !TERMINAL.includes(o.status))
      const estProfit = sumF(running, 'estimated_profit')
      const estBiaya = sumF(running, 'estimated_total_cost')
      const estFeeCod = sumF(running, 'estimated_cod_fee')
      const estPpn = sumF(running, 'estimated_ppn')
      const delivered = ordersMonth.filter((o: any) => o.status === 'DITERIMA')
      const aktualProfit = sumF(delivered, 'estimated_profit') // post-promote estimated_* = pakai ongkir aktual
      const deliveredCount = delivered.length

      // Retur & Fake %
      const totalOrdersMonth = allMonth.length
      const returCount = ordersByStatus['RETUR'] || 0
      const fakeCount = ordersByStatus['FAKE'] || 0
      // Retur Rate: % dari order yang udah selesai (diterima+retur), match
      // formula di Laba Rugi RPC — bukan retur / total (yang ke-dilute order
      // in-transit dan bikin angkanya beda sama Laba Rugi).
      const finishedCount = (ordersByStatus['DITERIMA'] || 0) + returCount
      const returPercentage = finishedCount > 0 ? (returCount / finishedCount) * 100 : 0
      const fakePercentage = totalOrdersMonth > 0 ? (fakeCount / totalOrdersMonth) * 100 : 0

      // Top products — union order_items_draft + order_items
      const allItems = [
        ...safeArr(draftItems).map((i: any) => ({ ...i, _status: i.orders_draft?.status })),
        ...safeArr(orderItems).map((i: any) => ({ ...i, _status: i.orders?.status })),
      ]
      const productMap = new Map<string, { qty: number; revenue: number }>()
      allItems
        .filter((i: any) => !['CANCEL', 'FAKE'].includes(i._status))
        .forEach((i: any) => {
          const name = i.products?.name || 'Unknown'
          const existing = productMap.get(name) || { qty: 0, revenue: 0 }
          productMap.set(name, {
            qty: existing.qty + i.qty,
            revenue: existing.revenue + Number(i.price) * i.qty,
          })
        })
      const topProducts = Array.from(productMap.entries())
        .map(([name, d]) => ({ name, ...d }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5)

      // Daily chart (last 30 days)
      const dailyMap = new Map<string, { omzet: number; spend: number }>()
      for (let i = 29; i >= 0; i--) {
        const d = new Date()
        d.setDate(d.getDate() - i)
        dailyMap.set(d.toISOString().split('T')[0], { omzet: 0, spend: 0 })
      }
      allMonth
        .filter((o: any) => !['CANCEL', 'FAKE'].includes(o.status))
        .forEach((o: any) => {
          const day = dailyMap.get(o.order_date)
          if (day) day.omzet += Number(o.total)
        })
      safeArr(adSpendMonth).forEach((s: any) => {
        const day = dailyMap.get(s.spend_date)
        if (day) day.spend += Number(s.spend)
      })
      const dailyChart = Array.from(dailyMap.entries()).map(([date, vals]) => ({
        date: new Date(date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }),
        omzet: vals.omzet,
        spend: vals.spend,
        profit: vals.omzet - vals.spend,
      }))

      setData({
        omzetHariIni,
        omzetBulanIni,
        totalOrdersHariIni: allToday.length,
        totalOrdersBulanIni: totalOrdersMonth,
        ordersByStatus,
        totalAdSpendBulanIni,
        blendedROAS,
        estProfit,
        estBiaya,
        estFeeCod,
        estPpn,
        aktualProfit,
        deliveredCount,
        codCair,
        codUncair,
        uncairCount,
        returPercentage,
        fakePercentage,
        dailyChart,
        topProducts,
      })
    } catch (error) {
      console.error('Error fetching dashboard data:', error)
    } finally {
      setLoading(false)
      setRefreshing(false)
      fetchingRef.current = false
    }
  }, [])

  useEffect(() => {
    fetchDashboardData()
  }, [fetchDashboardData])

  const handleRefresh = () => {
    setRefreshing(true)
    fetchDashboardData()
  }

  // Phase 8H audit — Admin Indra perlu KPI overview operasional.
  if (role && role !== 'owner' && role !== 'admin') {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-2">Akses Terbatas</h2>
            <p className="text-muted-foreground">
              Dashboard ini hanya dapat diakses oleh Owner atau Admin.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (loading) {
    return <DashboardSkeleton />
  }

  const statusPieData = data ? Object.entries(data.ordersByStatus).map(([status, count]) => ({
    name: status,
    value: count,
  })) : []
  const profitPositive = (data?.estProfit || 0) >= 0

  return (
    <div className="space-y-6">
      <PageHeader
        icon={LayoutDashboard}
        title="Dashboard"
        description={`Selamat datang, ${profile?.full_name || ''} 👋`}
        actions={
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        }
      />

      {/* Hero — Laba Bersih & Posisi Bersih (link ke halaman detail) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link href="/laba-rugi" className="group block">
          <Card className={`h-full transition-all hover:shadow-md ${profitPositive ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
            <CardContent className="pt-5 pb-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div className={`p-2 rounded-lg ${profitPositive ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
                    <Scale className={`w-4 h-4 ${profitPositive ? 'text-emerald-600' : 'text-red-600'}`} />
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Profit Estimasi — Bulan Ini</div>
                    <div className="text-[10px] text-muted-foreground">Order berjalan (belum delivered)</div>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </div>
              <div className={`text-3xl font-bold tabular-nums mt-3 ${profitPositive ? 'text-emerald-600' : 'text-red-600'}`}>
                {formatRupiah(data?.estProfit || 0)}
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                Est. biaya {formatRupiah(data?.estBiaya || 0)} · fee COD {formatRupiah(data?.estFeeCod || 0)} · PPN {formatRupiah(data?.estPpn || 0)}
              </div>
              <div className="text-[11px] mt-1">
                <span className="text-muted-foreground">Aktual (delivered): </span>
                <span className="font-semibold tabular-nums text-emerald-600">{formatRupiah(data?.aktualProfit || 0)}</span>
                <span className="text-muted-foreground"> · {data?.deliveredCount || 0} order Diterima</span>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/financial-position" className="group block">
          <Card className="h-full transition-all hover:shadow-md border-zinc-500/30 bg-zinc-500/5">
            <CardContent className="pt-5 pb-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-zinc-500/10">
                    <Wallet className="w-4 h-4 text-zinc-600" />
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">COD Sudah Cair</div>
                    <div className="text-[10px] text-muted-foreground">Payout SPX masuk</div>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </div>
              <div className="text-3xl font-bold tabular-nums mt-3 text-emerald-600">
                {formatRupiah(data?.codCair || 0)}
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                Belum cair {formatRupiah(data?.codUncair || 0)} · {data?.uncairCount || 0} order delivered nunggu payout
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          title="Omzet Hari Ini"
          value={formatRupiah(data?.omzetHariIni || 0)}
          subtitle={`${data?.totalOrdersHariIni || 0} orders`}
          icon={DollarSign}
          gradient="from-emerald-500 to-zinc-600"
        />
        <StatCard
          title="Omzet Bulan Ini"
          value={formatRupiah(data?.omzetBulanIni || 0)}
          subtitle={`${data?.totalOrdersBulanIni || 0} orders`}
          icon={CircleDollarSign}
          gradient="from-zinc-500 to-zinc-600"
        />
        <StatCard
          title="ROAS Blended"
          value={`${(data?.blendedROAS || 0).toFixed(2)}x`}
          subtitle={`Ad Spend: ${formatRupiah(data?.totalAdSpendBulanIni || 0)}`}
          icon={Target}
          gradient="from-amber-500 to-amber-600"
        />
      </div>

      {/* Warning Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardContent className="pt-4 pb-4 flex items-center gap-4">
            <div className="p-2 bg-amber-500/15 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <p className="text-sm font-medium">Retur Rate</p>
              <p className="text-2xl font-bold text-amber-500">
                {formatPercent(data?.returPercentage || 0)}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-red-500/20 bg-red-500/5">
          <CardContent className="pt-4 pb-4 flex items-center gap-4">
            <div className="p-2 bg-red-500/15 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-red-500" />
            </div>
            <div>
              <p className="text-sm font-medium">Fake Order Rate</p>
              <p className="text-2xl font-bold text-red-500">
                {formatPercent(data?.fakePercentage || 0)}
              </p>
            </div>
          </CardContent>
        </Card>
        {/* Phase 8B — Resi pending pickup widget (owner+admin only). */}
        {(role === 'owner' || role === 'admin') && <PendingPickupWidget />}
        {/* Phase 8I-v2 — Saldo SPX & Cashflow widget. */}
        {(role === 'owner' || role === 'admin' || role === 'akunting') && <CashflowSummaryWidget />}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Main chart - Omzet vs Spend vs Profit */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-zinc-500" />
              Trend 30 Hari Terakhir
            </CardTitle>
            <CardDescription>Omzet vs Ad Spend vs Profit</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data?.dailyChart || []}>
                  <defs>
                    <linearGradient id="gradientOmzet" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3f6fd1" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3f6fd1" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradientSpend" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradientProfit" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="rgba(255,255,255,0.3)" />
                  <YAxis tick={{ fontSize: 11 }} stroke="rgba(255,255,255,0.3)" tickFormatter={(v) => `${(v / 1000000).toFixed(1)}jt`} />
                  <RechartsTooltip
                    contentStyle={{
                      backgroundColor: 'rgba(24,24,27,0.95)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                    formatter={(value: any) => formatRupiah(Number(value))}
                  />
                  <Legend />
                  <Area type="monotone" dataKey="omzet" stroke="#3f6fd1" fill="url(#gradientOmzet)" strokeWidth={2} name="Omzet" />
                  <Area type="monotone" dataKey="spend" stroke="#ef4444" fill="url(#gradientSpend)" strokeWidth={2} name="Ad Spend" />
                  <Area type="monotone" dataKey="profit" stroke="#10b981" fill="url(#gradientProfit)" strokeWidth={2} name="Omzet − Ad Spend" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Order Status Pie */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-zinc-500" />
              Status Order
            </CardTitle>
            <CardDescription>Bulan ini</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusPieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {statusPieData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    contentStyle={{
                      backgroundColor: 'rgba(24,24,27,0.95)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {statusPieData.map((item, idx) => (
                <div key={item.name} className="flex items-center gap-1.5 text-xs">
                  <div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }}
                  />
                  <span className="text-muted-foreground">{item.name}: {item.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top Products */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="w-5 h-5 text-zinc-500" />
            Top 5 Produk
          </CardTitle>
          <CardDescription>By revenue bulan ini</CardDescription>
        </CardHeader>
        <CardContent>
          {data?.topProducts && data.topProducts.length > 0 ? (
            <div className="space-y-3">
              {data.topProducts.map((product, idx) => (
                <div key={product.name} className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-zinc-500/20 to-zinc-500/20 text-zinc-400 text-sm font-bold">
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{product.name}</p>
                    <p className="text-xs text-muted-foreground">{product.qty} unit terjual</p>
                  </div>
                  <p className="text-sm font-semibold text-emerald-500">
                    {formatRupiah(product.revenue)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm text-center py-8">Belum ada data produk</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// Stat Card Component
function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  gradient,
}: {
  title: string
  value: string
  subtitle: string
  icon: any
  gradient: string
}) {
  return (
    <Card className="relative overflow-hidden group hover:shadow-lg transition-all duration-300">
      <div className={`absolute inset-0 bg-gradient-to-br ${gradient} opacity-[0.03] group-hover:opacity-[0.06] transition-opacity`} />
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
            <p className="text-xl md:text-2xl font-bold">{value}</p>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
          <div className={`p-2.5 rounded-xl bg-gradient-to-br ${gradient} shadow-lg`}>
            <Icon className="w-5 h-5 text-white" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// Loading Skeleton
function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64 mt-2" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[...Array(2)].map((_, i) => (
          <Card key={i}>
            <CardContent className="pt-5 pb-5">
              <Skeleton className="h-4 w-32 mb-3" />
              <Skeleton className="h-8 w-40 mb-2" />
              <Skeleton className="h-3 w-48" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => (
          <Card key={i}>
            <CardContent className="pt-5 pb-4">
              <Skeleton className="h-4 w-24 mb-2" />
              <Skeleton className="h-7 w-32 mb-1" />
              <Skeleton className="h-3 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardContent className="pt-6">
            <Skeleton className="h-[320px] w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <Skeleton className="h-[320px] w-full" />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
