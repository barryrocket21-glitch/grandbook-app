'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DollarSign,
  ShoppingCart,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Package,
  AlertTriangle,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
  Target,
  Megaphone,
  CircleDollarSign,
  Activity,
} from 'lucide-react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
  PieChart,
  Pie,
  Cell,
} from 'recharts'
import { formatRupiah, formatNumber, formatPercent, getToday, getStartOfWeek, getStartOfMonth } from '@/lib/format'

// Chart colors
const CHART_COLORS = ['#8b5cf6', '#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#ef4444']

interface DashboardData {
  omzetHariIni: number
  omzetMingguIni: number
  omzetBulanIni: number
  totalOrdersHariIni: number
  totalOrdersBulanIni: number
  ordersByStatus: Record<string, number>
  totalAdSpendBulanIni: number
  blendedROAS: number
  profitEstimasi: number
  returPercentage: number
  fakePercentage: number
  dailyChart: Array<{
    date: string
    omzet: number
    spend: number
    profit: number
  }>
  topProducts: Array<{
    name: string
    qty: number
    revenue: number
  }>
  topCampaigns: Array<{
    name: string
    platform: string
    orders: number
    revenue: number
    spend: number
    roas: number
  }>
  cpaByPlatform: Array<{
    platform: string
    cpa: number
    orders: number
    spend: number
  }>
}

export default function DashboardPage() {
  const { profile, role } = useAuth()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const supabase = createClient()

  const fetchDashboardData = useCallback(async () => {
    try {
      const today = getToday()
      const startOfWeek = getStartOfWeek()
      const startOfMonth = getStartOfMonth()

      // Fetch orders for different periods
      const [
        { data: ordersToday },
        { data: ordersWeek },
        { data: ordersMonth },
        { data: allOrdersMonth },
        { data: adSpendMonth },
        { data: orderItems },
        { data: expenses },
      ] = await Promise.all([
        supabase.from('orders').select('total, status').eq('order_date', today),
        supabase.from('orders').select('total, status').gte('order_date', startOfWeek),
        supabase.from('orders').select('total, status').gte('order_date', startOfMonth),
        supabase.from('orders').select('*').gte('order_date', startOfMonth),
        supabase.from('ad_spend').select('spend, campaign_id, spend_date, campaigns(platform, campaign_name)').gte('spend_date', startOfMonth),
        supabase.from('order_items').select('qty, price, hpp_snapshot, product_id, products(name), order_id, orders!inner(order_date, status)').gte('orders.order_date', startOfMonth),
        supabase.from('expenses').select('amount').gte('expense_date', startOfMonth),
      ])

      const safeOrders = (arr: any[] | null) => arr || []

      // Calculate omzet
      const omzetHariIni = safeOrders(ordersToday)
        .filter(o => !['CANCEL', 'FAKE'].includes(o.status))
        .reduce((sum: number, o: any) => sum + Number(o.total), 0)
      const omzetMingguIni = safeOrders(ordersWeek)
        .filter(o => !['CANCEL', 'FAKE'].includes(o.status))
        .reduce((sum: number, o: any) => sum + Number(o.total), 0)
      const omzetBulanIni = safeOrders(ordersMonth)
        .filter(o => !['CANCEL', 'FAKE'].includes(o.status))
        .reduce((sum: number, o: any) => sum + Number(o.total), 0)

      // Orders by status
      const ordersByStatus: Record<string, number> = {}
      safeOrders(ordersMonth).forEach((o: any) => {
        ordersByStatus[o.status] = (ordersByStatus[o.status] || 0) + 1
      })

      // Ad spend
      const totalAdSpendBulanIni = safeOrders(adSpendMonth).reduce(
        (sum: number, s: any) => sum + Number(s.spend), 0
      )

      // HPP
      const totalHPP = safeOrders(orderItems)
        .filter((i: any) => !['CANCEL', 'FAKE'].includes(i.orders?.status))
        .reduce((sum: number, i: any) => sum + Number(i.hpp_snapshot) * i.qty, 0)

      // Expenses
      const totalExpenses = safeOrders(expenses).reduce(
        (sum: number, e: any) => sum + Number(e.amount), 0
      )

      // ROAS
      const blendedROAS = totalAdSpendBulanIni > 0 ? omzetBulanIni / totalAdSpendBulanIni : 0

      // Profit
      const profitEstimasi = omzetBulanIni - totalHPP - totalAdSpendBulanIni - totalExpenses

      // Retur & Fake %
      const totalOrdersMonth = safeOrders(ordersMonth).length
      const returCount = ordersByStatus['RETUR'] || 0
      const fakeCount = ordersByStatus['FAKE'] || 0
      const returPercentage = totalOrdersMonth > 0 ? (returCount / totalOrdersMonth) * 100 : 0
      const fakePercentage = totalOrdersMonth > 0 ? (fakeCount / totalOrdersMonth) * 100 : 0

      // Top products
      const productMap = new Map<string, { qty: number; revenue: number }>()
      safeOrders(orderItems)
        .filter((i: any) => !['CANCEL', 'FAKE'].includes(i.orders?.status))
        .forEach((i: any) => {
          const name = i.products?.name || 'Unknown'
          const existing = productMap.get(name) || { qty: 0, revenue: 0 }
          productMap.set(name, {
            qty: existing.qty + i.qty,
            revenue: existing.revenue + Number(i.price) * i.qty,
          })
        })
      const topProducts = Array.from(productMap.entries())
        .map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5)

      // Daily chart (last 30 days)
      const dailyMap = new Map<string, { omzet: number; spend: number }>()
      for (let i = 29; i >= 0; i--) {
        const d = new Date()
        d.setDate(d.getDate() - i)
        const key = d.toISOString().split('T')[0]
        dailyMap.set(key, { omzet: 0, spend: 0 })
      }

      safeOrders(allOrdersMonth)
        .filter((o: any) => !['CANCEL', 'FAKE'].includes(o.status))
        .forEach((o: any) => {
          const day = dailyMap.get(o.order_date)
          if (day) {
            day.omzet += Number(o.total)
          }
        })

      safeOrders(adSpendMonth).forEach((s: any) => {
        const day = dailyMap.get(s.spend_date)
        if (day) {
          day.spend += Number(s.spend)
        }
      })

      const dailyChart = Array.from(dailyMap.entries()).map(([date, vals]) => ({
        date: new Date(date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }),
        omzet: vals.omzet,
        spend: vals.spend,
        profit: vals.omzet - vals.spend,
      }))

      // Top campaigns - simplified since we don't have full join
      const topCampaigns: DashboardData['topCampaigns'] = []
      const cpaByPlatform: DashboardData['cpaByPlatform'] = []

      setData({
        omzetHariIni,
        omzetMingguIni,
        omzetBulanIni,
        totalOrdersHariIni: safeOrders(ordersToday).length,
        totalOrdersBulanIni: totalOrdersMonth,
        ordersByStatus,
        totalAdSpendBulanIni,
        blendedROAS,
        profitEstimasi,
        returPercentage,
        fakePercentage,
        dailyChart,
        topProducts,
        topCampaigns,
        cpaByPlatform,
      })
    } catch (error) {
      console.error('Error fetching dashboard data:', error)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [supabase])

  useEffect(() => {
    fetchDashboardData()

    // Auto-refresh every 60 seconds
    const interval = setInterval(fetchDashboardData, 60000)
    return () => clearInterval(interval)
  }, [fetchDashboardData])

  const handleRefresh = () => {
    setRefreshing(true)
    fetchDashboardData()
  }

  if (role && role !== 'owner') {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <AlertTriangle className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-2">Akses Terbatas</h2>
            <p className="text-muted-foreground">
              Dashboard ini hanya dapat diakses oleh Owner.
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-transparent">
            Dashboard
          </h1>
          <p className="text-muted-foreground mt-1">
            Selamat datang, {profile?.full_name} 👋
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing}
          className="gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Omzet Hari Ini"
          value={formatRupiah(data?.omzetHariIni || 0)}
          subtitle={`${data?.totalOrdersHariIni || 0} orders`}
          icon={DollarSign}
          trend="up"
          gradient="from-emerald-500 to-teal-600"
        />
        <StatCard
          title="Omzet Bulan Ini"
          value={formatRupiah(data?.omzetBulanIni || 0)}
          subtitle={`${data?.totalOrdersBulanIni || 0} orders`}
          icon={CircleDollarSign}
          trend="up"
          gradient="from-violet-500 to-indigo-600"
        />
        <StatCard
          title="Profit Estimasi"
          value={formatRupiah(data?.profitEstimasi || 0)}
          subtitle="Omzet - HPP - Ads - Ops"
          icon={(data?.profitEstimasi || 0) >= 0 ? TrendingUp : TrendingDown}
          trend={(data?.profitEstimasi || 0) >= 0 ? 'up' : 'down'}
          gradient={(data?.profitEstimasi || 0) >= 0 ? 'from-emerald-500 to-green-600' : 'from-red-500 to-rose-600'}
        />
        <StatCard
          title="ROAS Blended"
          value={`${(data?.blendedROAS || 0).toFixed(2)}x`}
          subtitle={`Ad Spend: ${formatRupiah(data?.totalAdSpendBulanIni || 0)}`}
          icon={Target}
          trend={(data?.blendedROAS || 0) >= 2 ? 'up' : 'down'}
          gradient="from-amber-500 to-orange-600"
        />
      </div>

      {/* Warning Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="border-orange-500/20 bg-orange-500/5">
          <CardContent className="pt-4 pb-4 flex items-center gap-4">
            <div className="p-2 bg-orange-500/15 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-orange-500" />
            </div>
            <div>
              <p className="text-sm font-medium">Retur Rate</p>
              <p className="text-2xl font-bold text-orange-500">
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
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Main chart - Omzet vs Spend vs Profit */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-violet-500" />
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
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
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
                  <Area type="monotone" dataKey="omzet" stroke="#8b5cf6" fill="url(#gradientOmzet)" strokeWidth={2} name="Omzet" />
                  <Area type="monotone" dataKey="spend" stroke="#ef4444" fill="url(#gradientSpend)" strokeWidth={2} name="Ad Spend" />
                  <Area type="monotone" dataKey="profit" stroke="#10b981" fill="url(#gradientProfit)" strokeWidth={2} name="Profit" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Order Status Pie */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-violet-500" />
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

      {/* Top Products & Campaigns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top Products */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="w-5 h-5 text-violet-500" />
              Top 5 Produk
            </CardTitle>
            <CardDescription>By revenue bulan ini</CardDescription>
          </CardHeader>
          <CardContent>
            {data?.topProducts && data.topProducts.length > 0 ? (
              <div className="space-y-3">
                {data.topProducts.map((product, idx) => (
                  <div key={product.name} className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500/20 to-indigo-500/20 text-violet-400 text-sm font-bold">
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

        {/* Top Campaigns */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Megaphone className="w-5 h-5 text-violet-500" />
              Top 5 Campaign
            </CardTitle>
            <CardDescription>By ROAS bulan ini</CardDescription>
          </CardHeader>
          <CardContent>
            {data?.topCampaigns && data.topCampaigns.length > 0 ? (
              <div className="space-y-3">
                {data.topCampaigns.map((campaign, idx) => (
                  <div key={campaign.name} className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500/20 to-orange-500/20 text-amber-400 text-sm font-bold">
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{campaign.name}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {campaign.platform}
                        </Badge>
                        <span>{campaign.orders} orders</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-emerald-500">
                        {campaign.roas.toFixed(2)}x
                      </p>
                      <p className="text-[10px] text-muted-foreground">ROAS</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm text-center py-8">Belum ada data campaign</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// Stat Card Component
function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  gradient,
}: {
  title: string
  value: string
  subtitle: string
  icon: any
  trend: 'up' | 'down'
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
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
