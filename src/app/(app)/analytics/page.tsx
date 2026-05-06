'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PageHeader } from '@/components/ui/page-header'
import { LineChart, AlertTriangle, TrendingDown, TrendingUp, RefreshCw } from 'lucide-react'
import { formatRupiah } from '@/lib/format'

const supabase = createClient()

interface Product { id: number; name: string }
interface Profile { id: string; full_name: string; role: string }

interface CellData {
  leads: number
  closing: number
  rejected: number
  revenue: number
  hpp: number
  commission: number
  spend_share: number
}

interface ProfitData {
  revenue: number
  hpp: number
  ad_spend: number
  commission_estimated: number
  commission_earned: number
  expenses: number
  retur_rate_30d: number
}

const today = () => new Date().toISOString().split('T')[0]
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().split('T')[0] }

export default function AnalyticsPage() {
  const { role, loading: authLoading } = useAuth()
  const [from, setFrom] = useState(daysAgo(6))
  const [to, setTo] = useState(today())
  const [products, setProducts] = useState<Product[]>([])
  const [csList, setCsList] = useState<Profile[]>([])
  const [matrix, setMatrix] = useState<Record<string, CellData>>({})
  const [profit, setProfit] = useState<ProfitData | null>(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)

    // Load products & CS list
    const [{ data: prods }, { data: cs }] = await Promise.all([
      supabase.from('products').select('id, name').eq('active', true).order('name'),
      supabase.from('profiles').select('id, full_name, role').eq('role', 'cs').eq('active', true),
    ])
    const productList = prods || []
    const csListData = cs || []

    // Daily reports in range
    const { data: reports } = await supabase
      .from('cs_daily_leads')
      .select('cs_id, product_id, leads_count, closing_count, rejected_count')
      .gte('report_date', from)
      .lte('report_date', to)

    // Orders in range (closed)
    const { data: orders } = await supabase
      .from('orders')
      .select('id, cs_id, total, order_date, order_items(product_id, qty, price, hpp_snapshot)')
      .gte('order_date', from)
      .lte('order_date', to)
      .is('duplicate_of', null)
      .not('status', 'in', '(CANCEL,FAKE)')

    // Commissions in range
    const { data: commissions } = await supabase
      .from('commissions')
      .select('order_id, role, amount, status, orders!inner(order_date, cs_id, order_items(product_id))')
      .gte('orders.order_date', from)
      .lte('orders.order_date', to)

    // Ad spend in range
    const { data: spends } = await supabase
      .from('ad_spend')
      .select('campaign_id, spend, lead_platform, spend_date, campaigns(campaign_name)')
      .gte('spend_date', from)
      .lte('spend_date', to)

    // Expenses in range
    const { data: expenses } = await supabase
      .from('expenses')
      .select('amount')
      .gte('expense_date', from)
      .lte('expense_date', to)

    // Build matrix: key = cs_id|product_id
    const cellMap: Record<string, CellData> = {}
    const ensureCell = (csId: string, productId: number): CellData => {
      const k = `${csId}|${productId}`
      if (!cellMap[k]) cellMap[k] = { leads: 0, closing: 0, rejected: 0, revenue: 0, hpp: 0, commission: 0, spend_share: 0 }
      return cellMap[k]
    }

    // Lead/closing/rejected from cs_daily_leads
    ;(reports || []).forEach((r: any) => {
      const c = ensureCell(r.cs_id, r.product_id)
      c.leads += r.leads_count
      c.closing += r.closing_count
      c.rejected += r.rejected_count
    })

    // Revenue & HPP from orders
    let totalRevenue = 0
    let totalHpp = 0
    ;(orders || []).forEach((o: any) => {
      ;(o.order_items || []).forEach((it: any) => {
        if (!o.cs_id) return
        const c = ensureCell(o.cs_id, it.product_id)
        const itemRevenue = Number(it.price) * it.qty
        const itemHpp = Number(it.hpp_snapshot) * it.qty
        c.revenue += itemRevenue
        c.hpp += itemHpp
        totalRevenue += itemRevenue
        totalHpp += itemHpp
      })
    })

    // Commission: sum CS commissions per cs+product
    let totalCommissionEst = 0
    let totalCommissionEarned = 0
    ;(commissions || []).forEach((cm: any) => {
      const ord = cm.orders
      if (!ord?.cs_id) return
      const items = ord.order_items || []
      const productIds = [...new Set(items.map((it: any) => it.product_id))] as number[]
      // Allocate commission equally across products in the order
      const perProduct = productIds.length > 0 ? Number(cm.amount) / productIds.length : 0
      productIds.forEach(pid => {
        if (cm.role === 'cs') {
          const cell = ensureCell(ord.cs_id, pid)
          if (cm.status !== 'CANCELLED') cell.commission += perProduct
        }
      })
      if (cm.status === 'ESTIMATED') totalCommissionEst += Number(cm.amount)
      if (cm.status === 'EARNED') totalCommissionEarned += Number(cm.amount)
    })

    // Ad spend total
    const totalAdSpend = (spends || []).reduce((s: number, x: any) => s + Number(x.spend), 0)

    // Expenses total
    const totalExpenses = (expenses || []).reduce((s: number, x: any) => s + Number(x.amount), 0)

    // Calculate retur rate for last 30 days
    const fromRetur = daysAgo(30)
    const { data: returOrders } = await supabase
      .from('orders')
      .select('resi_status, status')
      .gte('order_date', fromRetur)
      .is('duplicate_of', null)
      .in('status', ['DIKIRIM','SAMPAI','SELESAI','RETUR'])
    const totalShipped = (returOrders || []).length
    const totalReturned = (returOrders || []).filter((o: any) => o.resi_status === 'RETUR' || o.status === 'RETUR').length
    const returRate = totalShipped > 0 ? (totalReturned / totalShipped) * 100 : 0

    setProducts(productList)
    setCsList(csListData)
    setMatrix(cellMap)
    setProfit({
      revenue: totalRevenue,
      hpp: totalHpp,
      ad_spend: totalAdSpend,
      commission_estimated: totalCommissionEst,
      commission_earned: totalCommissionEarned,
      expenses: totalExpenses,
      retur_rate_30d: returRate,
    })
    setLoading(false)
  }

  useEffect(() => { load() }, [from, to])

  const profitBestCase = useMemo(() => {
    if (!profit) return 0
    return profit.revenue - profit.hpp - profit.ad_spend - profit.commission_estimated - profit.commission_earned - profit.expenses
  }, [profit])

  const profitAdjusted = useMemo(() => {
    if (!profit) return 0
    return profitBestCase - (profit.revenue * profit.retur_rate_30d / 100 * 0.3) // assume 30% loss on returns
  }, [profit, profitBestCase])

  const margin = profit && profit.revenue > 0 ? (profitBestCase / profit.revenue) * 100 : 0

  if (authLoading) return <div className="text-sm text-muted-foreground">Memeriksa akses...</div>
  if (role !== 'owner') {
    return (
      <Card className="max-w-md mx-auto mt-8">
        <CardContent className="pt-6 text-center space-y-2">
          <AlertTriangle className="w-10 h-10 text-yellow-500 mx-auto" />
          <h2 className="text-lg font-semibold">Akses Dibatasi</h2>
          <p className="text-sm text-muted-foreground">Halaman analytics ini hanya untuk Owner.</p>
        </CardContent>
      </Card>
    )
  }

  const cellFor = (csId: string, productId: number) => matrix[`${csId}|${productId}`]

  return (
    <div className="space-y-6">
      <PageHeader
        icon={LineChart}
        title="Owner Analytics"
        description={`Matrix Produk × CS dan estimasi profit • ${from} s/d ${to}`}
        actions={
          <div className="flex items-center gap-2">
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-36" />
            <span className="text-muted-foreground text-xs">s/d</span>
            <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-36" />
            <Button variant="outline" size="icon" onClick={load} disabled={loading}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        }
      />

      {/* Profit Dashboard */}
      {profit && (
        <Card className="border-violet-500/30 bg-gradient-to-br from-violet-500/5 to-indigo-500/5 overflow-hidden">
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  💰 Estimasi Profit Periode Ini
                </CardTitle>
                <CardDescription>Asumsi: semua yang DIKIRIM ter-DITERIMA tanpa retur</CardDescription>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Best Case Profit</p>
                <p className={`text-3xl font-bold ${profitBestCase >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                  {formatRupiah(profitBestCase)}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">Margin {margin.toFixed(1)}%</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <div>
                <p className="text-xs text-muted-foreground uppercase">Revenue</p>
                <p className="font-semibold text-emerald-500">{formatRupiah(profit.revenue)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase">HPP</p>
                <p className="font-semibold">{formatRupiah(profit.hpp)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase">Ad Spend</p>
                <p className="font-semibold">{formatRupiah(profit.ad_spend)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase">Komisi (est)</p>
                <p className="font-semibold">{formatRupiah(profit.commission_estimated)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase">Komisi (earned)</p>
                <p className="font-semibold">{formatRupiah(profit.commission_earned)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase">Biaya Ops</p>
                <p className="font-semibold">{formatRupiah(profit.expenses)}</p>
              </div>
            </div>

            <div className="border-t border-violet-500/20 pt-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <span className="text-muted-foreground">Retur rate 30 hari: <strong className="text-amber-500">{profit.retur_rate_30d.toFixed(1)}%</strong></span>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Adjusted setelah retur estimasi</p>
                <p className={`font-semibold ${profitAdjusted >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatRupiah(profitAdjusted)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Matrix Produk × CS */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Matrix Produk × CS</CardTitle>
          <CardDescription>Setiap cell: Closing • CR • Revenue • Profit margin</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 bg-background min-w-[180px]">Produk</TableHead>
                  {csList.map(c => (
                    <TableHead key={c.id} className="text-center min-w-[160px]">{c.full_name}</TableHead>
                  ))}
                  <TableHead className="text-center min-w-[160px] bg-muted/30">TOTAL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}><TableCell colSpan={csList.length + 2}><div className="h-4 bg-muted animate-pulse rounded w-full" /></TableCell></TableRow>
                  ))
                ) : products.length === 0 ? (
                  <TableRow><TableCell colSpan={csList.length + 2} className="text-center py-12 text-muted-foreground">Belum ada produk aktif</TableCell></TableRow>
                ) : products.map(p => {
                  // Compute total per product
                  let totalLeads = 0, totalClosing = 0, totalRevenue = 0, totalHpp = 0, totalCommission = 0
                  csList.forEach(c => {
                    const cell = cellFor(c.id, p.id)
                    if (cell) {
                      totalLeads += cell.leads
                      totalClosing += cell.closing
                      totalRevenue += cell.revenue
                      totalHpp += cell.hpp
                      totalCommission += cell.commission
                    }
                  })
                  const totalProfit = totalRevenue - totalHpp - totalCommission
                  const totalMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0

                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-semibold sticky left-0 bg-background">{p.name}</TableCell>
                      {csList.map(c => {
                        const cell = cellFor(c.id, p.id)
                        if (!cell || (cell.leads === 0 && cell.closing === 0)) {
                          return <TableCell key={c.id} className="text-center text-xs text-muted-foreground">—</TableCell>
                        }
                        const cr = cell.leads > 0 ? (cell.closing / cell.leads) * 100 : 0
                        const profitCell = cell.revenue - cell.hpp - cell.commission
                        const marginCell = cell.revenue > 0 ? (profitCell / cell.revenue) * 100 : 0
                        const crColor = cr >= 60 ? 'text-emerald-500' : cr >= 30 ? 'text-amber-500' : 'text-red-500'
                        const marginColor = marginCell >= 20 ? 'bg-emerald-500/10 text-emerald-600' : marginCell >= 0 ? 'bg-amber-500/10 text-amber-600' : 'bg-red-500/10 text-red-600'

                        return (
                          <TableCell key={c.id} className="text-center text-xs space-y-0.5">
                            <div className="font-semibold">{cell.closing}/{cell.leads}</div>
                            <div className={crColor}>CR {cr.toFixed(0)}%</div>
                            <div className="text-muted-foreground text-[10px]">{formatRupiah(cell.revenue)}</div>
                            <Badge variant="outline" className={`${marginColor} text-[10px] px-1.5`}>
                              {marginCell >= 0 ? <TrendingUp className="w-3 h-3 inline mr-0.5" /> : <TrendingDown className="w-3 h-3 inline mr-0.5" />}
                              {marginCell.toFixed(0)}%
                            </Badge>
                          </TableCell>
                        )
                      })}
                      <TableCell className="text-center text-xs space-y-0.5 bg-muted/20 font-medium">
                        <div className="font-bold">{totalClosing}/{totalLeads}</div>
                        <div>{totalLeads > 0 ? `${((totalClosing/totalLeads)*100).toFixed(0)}%` : '—'}</div>
                        <div className="text-muted-foreground text-[10px]">{formatRupiah(totalRevenue)}</div>
                        <Badge variant="outline" className={`text-[10px] px-1.5 ${totalMargin >= 20 ? 'bg-emerald-500/10 text-emerald-600' : totalMargin >= 0 ? 'bg-amber-500/10 text-amber-600' : 'bg-red-500/10 text-red-600'}`}>
                          {totalMargin.toFixed(0)}%
                        </Badge>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card className="border-blue-500/20 bg-blue-500/5">
        <CardContent className="pt-4 pb-4 text-sm space-y-2">
          <p>📊 <strong>Cara baca matrix:</strong></p>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground">
            <li><strong>Closing/Lead</strong> — jumlah closing dari total lead masuk ke CS itu untuk produk itu</li>
            <li><strong>CR %</strong> — closing rate. <span className="text-emerald-500">Hijau</span> ≥60%, <span className="text-amber-500">amber</span> ≥30%, <span className="text-red-500">merah</span> &lt;30%</li>
            <li><strong>Revenue</strong> — total penjualan dari CS+produk itu</li>
            <li><strong>Margin badge</strong> — profit % setelah HPP & komisi (<span className="text-emerald-600">≥20% bagus</span>, <span className="text-amber-600">≥0% break-even</span>, <span className="text-red-600">&lt;0% rugi</span>)</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
