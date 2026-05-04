'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Separator } from '@/components/ui/separator'
import { Download, FileText, TrendingUp, TrendingDown, DollarSign, Receipt, Coins, BarChart3 } from 'lucide-react'
import { formatRupiah } from '@/lib/format'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'

export default function FinancialReportsPage() {
  const supabase = createClient()
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetch = async () => {
      setLoading(true)
      const start = `${month}-01`, end = `${month}-31`
      const [orders, items, spend, expenses] = await Promise.all([
        supabase.from('orders').select('total, status, order_date').gte('order_date', start).lte('order_date', end),
        supabase.from('order_items').select('qty, price, hpp_snapshot, products(name), orders!inner(order_date, status)').gte('orders.order_date', start).lte('orders.order_date', end),
        supabase.from('ad_spend').select('spend, campaigns(platform)').gte('spend_date', start).lte('spend_date', end),
        supabase.from('expenses').select('amount, category').gte('expense_date', start).lte('expense_date', end),
      ])

      const validOrders = (orders.data || []).filter(o => !['CANCEL', 'FAKE'].includes(o.status))
      const omzet = validOrders.reduce((s: number, o: any) => s + Number(o.total), 0)
      const validItems = (items.data || []).filter((i: any) => !['CANCEL', 'FAKE'].includes(i.orders?.status))
      const hpp = validItems.reduce((s: number, i: any) => s + Number(i.hpp_snapshot) * i.qty, 0)
      const totalSpend = (spend.data || []).reduce((s: number, x: any) => s + Number(x.spend), 0)
      const totalExpense = (expenses.data || []).reduce((s: number, x: any) => s + Number(x.amount), 0)
      const grossProfit = omzet - hpp
      const netProfit = grossProfit - totalSpend - totalExpense

      // By product
      const productMap = new Map()
      validItems.forEach((i: any) => {
        const n = i.products?.name || 'Unknown'
        const e = productMap.get(n) || { qty: 0, revenue: 0, hpp: 0 }
        productMap.set(n, { qty: e.qty + i.qty, revenue: e.revenue + Number(i.price) * i.qty, hpp: e.hpp + Number(i.hpp_snapshot) * i.qty })
      })

      // By platform
      const platformMap = new Map()
      ;(spend.data || []).forEach((s: any) => {
        const p = s.campaigns?.platform || 'OTHER'
        platformMap.set(p, (platformMap.get(p) || 0) + Number(s.spend))
      })

      // Daily chart
      const dailyMap = new Map()
      validOrders.forEach((o: any) => { dailyMap.set(o.order_date, (dailyMap.get(o.order_date) || 0) + Number(o.total)) })
      const daily = Array.from(dailyMap.entries()).sort().map(([date, omzet]) => ({ date: date.slice(5), omzet }))

      setData({
        omzet, hpp, grossProfit, totalSpend, totalExpense, netProfit,
        totalOrders: validOrders.length,
        byProduct: Array.from(productMap.entries()).map(([name, d]) => ({ name, ...d })).sort((a: any, b: any) => b.revenue - a.revenue),
        byPlatform: Array.from(platformMap.entries()).map(([platform, spend]) => ({ platform, spend })),
        daily,
        expenseCategories: Object.entries((expenses.data || []).reduce((a: any, e: any) => { a[e.category] = (a[e.category] || 0) + Number(e.amount); return a }, {})).map(([cat, amt]) => ({ category: cat, amount: amt })),
      })
      setLoading(false)
    }
    fetch()
  }, [month])

  const handleExportCSV = () => {
    if (!data) return
    const rows = [['Metrik', 'Nilai'], ['Omzet', data.omzet], ['HPP', data.hpp], ['Gross Profit', data.grossProfit], ['Ad Spend', data.totalSpend], ['Biaya Ops', data.totalExpense], ['Net Profit', data.netProfit]]
    const csv = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `laporan-${month}.csv`; a.click()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-transparent">Laporan Keuangan</h1>
          <p className="text-muted-foreground mt-1">Analisis keuangan bulanan</p>
        </div>
        <div className="flex gap-2">
          <Input type="month" value={month} onChange={e => setMonth(e.target.value)} className="w-40" />
          <Button variant="outline" onClick={handleExportCSV}><Download className="w-4 h-4 mr-2" />Export CSV</Button>
        </div>
      </div>

      {data && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: 'Omzet', value: data.omzet, icon: DollarSign, color: 'text-violet-500' },
              { label: 'HPP', value: data.hpp, icon: Receipt, color: 'text-orange-500' },
              { label: 'Gross Profit', value: data.grossProfit, icon: TrendingUp, color: 'text-emerald-500' },
              { label: 'Ad Spend', value: data.totalSpend, icon: BarChart3, color: 'text-red-500' },
              { label: 'Biaya Ops', value: data.totalExpense, icon: Coins, color: 'text-yellow-500' },
              { label: 'Net Profit', value: data.netProfit, icon: data.netProfit >= 0 ? TrendingUp : TrendingDown, color: data.netProfit >= 0 ? 'text-emerald-500' : 'text-red-500' },
            ].map(({ label, value, icon: Icon, color }) => (
              <Card key={label}><CardContent className="pt-4 pb-4"><div className="flex items-center gap-2 mb-1"><Icon className={`w-4 h-4 ${color}`} /><p className="text-xs text-muted-foreground">{label}</p></div><p className="text-lg font-bold">{formatRupiah(value)}</p></CardContent></Card>
            ))}
          </div>

          {/* Daily Chart */}
          <Card>
            <CardHeader><CardTitle className="text-base">Omzet Harian</CardTitle></CardHeader>
            <CardContent>
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.daily}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="rgba(255,255,255,0.3)" />
                    <YAxis tick={{ fontSize: 11 }} stroke="rgba(255,255,255,0.3)" tickFormatter={(v: number) => `${(v / 1000000).toFixed(1)}jt`} />
                    <Tooltip contentStyle={{ backgroundColor: 'rgba(24,24,27,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }} formatter={(v: any) => formatRupiah(Number(v))} />
                    <Bar dataKey="omzet" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Product Breakdown */}
          <Card>
            <CardHeader><CardTitle className="text-base">Breakdown per Produk</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Produk</TableHead><TableHead>Qty</TableHead><TableHead>Revenue</TableHead><TableHead>HPP</TableHead><TableHead>Margin</TableHead></TableRow></TableHeader>
                <TableBody>
                  {data.byProduct.map((p: any) => (
                    <TableRow key={p.name}><TableCell className="font-medium">{p.name}</TableCell><TableCell>{p.qty}</TableCell><TableCell>{formatRupiah(p.revenue)}</TableCell><TableCell>{formatRupiah(p.hpp)}</TableCell><TableCell className="font-semibold text-emerald-500">{formatRupiah(p.revenue - p.hpp)}</TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
