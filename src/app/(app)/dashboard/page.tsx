'use client'

import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DollarSign, CircleDollarSign, Target, ShoppingCart, Package,
  AlertTriangle, RefreshCw, Activity, Scale, Wallet, ArrowRight,
  LayoutDashboard, type LucideIcon,
} from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell,
} from 'recharts'
import { formatRupiah, formatPercent } from '@/lib/format'
import { PageHeader } from '@/components/ui/page-header'
import { PendingPickupWidget } from '@/components/dashboard/pending-pickup-widget'
import { CashflowSummaryWidget } from '@/components/dashboard/cashflow-summary-widget'

import { useDashboardRead } from '@/lib/dashboard/use-dashboard-read'
import { readDashboard } from '@/lib/dashboard/read'

const loadDashboard = (signal: AbortSignal) => readDashboard(supabase, signal)
const money = (value: number | null) => value === null ? '—' : formatRupiah(value)

// Chart colors
const CHART_COLORS = ['#3f6fd1', '#71717a', '#a1a1aa', '#10b981', '#f59e0b', '#ef4444']

// Supabase client dibuat sekali di module level agar tidak trigger re-render loop
const supabase = createClient()

export default function DashboardPage() {
  const { user, profile, role, loading: authLoading } = useAuth()
  const verified = !authLoading && user?.id === profile?.id && (role === 'owner' || role === 'admin')
  const key = verified ? user!.id + ':' + profile?.organization_id + ':' + role : null
  const { data, loading, error, readAt, refresh: handleRefresh } = useDashboardRead(key, loadDashboard)
  const refreshing = loading

  // Phase 8H audit — Admin Indra perlu KPI overview operasional.
  if (authLoading || ((role === 'owner' || role === 'admin') && !verified)) return <DashboardSkeleton />

  if (role !== 'owner' && role !== 'admin') {
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

  if (error || !data) {
    return (
      <div className="space-y-6">
        <PageHeader icon={LayoutDashboard} title="Dashboard" description="Ringkasan Owner" />
        <Card role="alert">
          <CardContent className="pt-6 space-y-3">
            <h2 className="font-semibold">Dashboard belum dapat ditampilkan</h2>
            <p className="text-sm text-muted-foreground">Data belum terbaca lengkap atau berubah saat dimuat. Angka tidak ditampilkan agar tidak menyesatkan.</p>
            <Button onClick={() => void handleRefresh()} variant="outline">Coba lagi</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const statusPieData = data ? Object.entries(data.ordersByStatus).map(([status, count]) => ({
    name: status,
    value: count,
  })) : []
  const profitPositive = (data.estProfit ?? 0) >= 0

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

      <div className="text-xs text-muted-foreground space-y-1" data-dashboard-coverage>
        <p>Periode bulanan: {data.period.month} – {data.period.today} (WIB). Grafik: {data.period.days[0]} – {data.period.today}.</p>
        <p>Sumber {data.period.start} – {data.period.today}, terbaca lengkap: {data.coverage.drafts + data.coverage.orders} order, {data.coverage.draftItems + data.coverage.items} item bulan ini, {data.coverage.spend} baris iklan untuk periode sumber. Dimuat {readAt ? new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'short', timeStyle: 'short' }).format(new Date(readAt)) : '—'} WIB.</p>
        <p>Estimasi tersimpan sesuai sumber. Delivered belum berarti COD sudah cair; pencairan tercatat bukan laba kas atau verifikasi saldo bank.</p>
        {(data.incompleteEstimates > 0 || data.incompleteDelivered > 0) && <p role="status">Estimasi belum lengkap: {data.incompleteEstimates} order berjalan dan {data.incompleteDelivered} order delivered. Total terkait ditampilkan —.</p>}
      </div>

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
                {money(data.estProfit)}
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                Est. biaya {money(data.estBiaya)} · fee COD {money(data.estFeeCod)} · PPN {money(data.estPpn)}
              </div>
              <div className="text-[11px] mt-1">
                <span className="text-muted-foreground">Estimasi order delivered: </span>
                <span className="font-semibold tabular-nums text-emerald-600">{money(data.aktualProfit)}</span>
                <span className="text-muted-foreground"> · {data.deliveredCount} order Diterima</span>
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
                    <div className="text-[10px] text-muted-foreground">Pencairan tercatat · semua periode</div>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </div>
              <div className="text-3xl font-bold tabular-nums mt-3 text-emerald-600">
                {formatRupiah(data.codCair)}
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                Belum cair {formatRupiah(data.codUncair)} · {data.uncairCount} order delivered nunggu payout
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          title="Omzet Hari Ini"
          value={formatRupiah(data.omzetHariIni)}
          subtitle={`${data.totalOrdersHariIni} orders`}
          icon={DollarSign}
          gradient="from-emerald-500 to-zinc-600"
        />
        <StatCard
          title="Omzet Bulan Ini"
          value={formatRupiah(data.omzetBulanIni)}
          subtitle={`${data.totalOrdersBulanIni} orders`}
          icon={CircleDollarSign}
          gradient="from-zinc-500 to-zinc-600"
        />
        <StatCard
          title="ROAS Blended"
          value={`${(data.blendedROAS).toFixed(2)}x`}
          subtitle={`Ad Spend: ${formatRupiah(data.totalAdSpendBulanIni)}`}
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
                {formatPercent(data.returPercentage)}
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
                {formatPercent(data.fakePercentage)}
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
            <CardDescription>Omzet, Ad Spend, dan selisih keduanya; bukan laba bersih</CardDescription>
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
                    formatter={(value) => formatRupiah(Number(value))}
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
  icon: LucideIcon
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
