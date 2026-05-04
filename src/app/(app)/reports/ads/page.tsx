'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Target, TrendingUp, DollarSign, ShoppingCart } from 'lucide-react'
import { formatRupiah, formatNumber, calculateROAS, calculateCPA } from '@/lib/format'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

export default function AdsReportPage() {
  const supabase = createClient()
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const [campaigns, setCampaigns] = useState<any[]>([])

  useEffect(() => {
    const fetch = async () => {
      const start = `${month}-01`, end = `${month}-31`
      const [{ data: spends }, { data: orders }] = await Promise.all([
        supabase.from('ad_spend').select('spend, campaign_id, campaigns(campaign_name, platform)').gte('spend_date', start).lte('spend_date', end),
        supabase.from('orders').select('total, campaign_id, status').gte('order_date', start).lte('order_date', end).not('status', 'in', '("CANCEL","FAKE")'),
      ])

      const map = new Map<number, { name: string; platform: string; spend: number; orders: number; revenue: number }>()
      ;(spends || []).forEach((s: any) => {
        const e = map.get(s.campaign_id) || { name: s.campaigns?.campaign_name, platform: s.campaigns?.platform, spend: 0, orders: 0, revenue: 0 }
        e.spend += Number(s.spend)
        map.set(s.campaign_id, e)
      })
      ;(orders || []).forEach((o: any) => {
        if (o.campaign_id && map.has(o.campaign_id)) {
          const e = map.get(o.campaign_id)!
          e.orders += 1; e.revenue += Number(o.total)
        }
      })

      const result = Array.from(map.entries()).map(([id, d]) => ({
        id, ...d, roas: calculateROAS(d.revenue, d.spend), cpa: calculateCPA(d.spend, d.orders),
      })).sort((a, b) => b.roas - a.roas)
      setCampaigns(result)
    }
    fetch()
  }, [month])

  const totalSpend = campaigns.reduce((s, c) => s + c.spend, 0)
  const totalRevenue = campaigns.reduce((s, c) => s + c.revenue, 0)
  const totalOrders = campaigns.reduce((s, c) => s + c.orders, 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-transparent">Laporan Iklan</h1>
          <p className="text-muted-foreground mt-1">Performa campaign per bulan</p>
        </div>
        <Input type="month" value={month} onChange={e => setMonth(e.target.value)} className="w-40" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="pt-4 pb-4"><div className="flex items-center gap-2 mb-1"><DollarSign className="w-4 h-4 text-red-500" /><span className="text-xs text-muted-foreground">Total Spend</span></div><p className="text-lg font-bold">{formatRupiah(totalSpend)}</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-4"><div className="flex items-center gap-2 mb-1"><TrendingUp className="w-4 h-4 text-violet-500" /><span className="text-xs text-muted-foreground">Revenue</span></div><p className="text-lg font-bold">{formatRupiah(totalRevenue)}</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-4"><div className="flex items-center gap-2 mb-1"><Target className="w-4 h-4 text-emerald-500" /><span className="text-xs text-muted-foreground">ROAS</span></div><p className="text-lg font-bold">{calculateROAS(totalRevenue, totalSpend).toFixed(2)}x</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-4"><div className="flex items-center gap-2 mb-1"><ShoppingCart className="w-4 h-4 text-blue-500" /><span className="text-xs text-muted-foreground">CPA</span></div><p className="text-lg font-bold">{formatRupiah(calculateCPA(totalSpend, totalOrders))}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">ROAS per Campaign</CardTitle></CardHeader>
        <CardContent>
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={campaigns.slice(0, 10)} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis type="number" tick={{ fontSize: 11 }} stroke="rgba(255,255,255,0.3)" />
                <YAxis dataKey="name" type="category" width={150} tick={{ fontSize: 10 }} stroke="rgba(255,255,255,0.3)" />
                <Tooltip contentStyle={{ backgroundColor: 'rgba(24,24,27,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }} />
                <Bar dataKey="roas" fill="#8b5cf6" radius={[0, 4, 4, 0]} name="ROAS" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Campaign</TableHead><TableHead>Platform</TableHead><TableHead>Spend</TableHead><TableHead>Orders</TableHead><TableHead>Revenue</TableHead><TableHead>CPA</TableHead><TableHead>ROAS</TableHead></TableRow></TableHeader>
            <TableBody>
              {campaigns.map(c => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell><Badge variant="outline">{c.platform}</Badge></TableCell>
                  <TableCell>{formatRupiah(c.spend)}</TableCell>
                  <TableCell>{c.orders}</TableCell>
                  <TableCell>{formatRupiah(c.revenue)}</TableCell>
                  <TableCell>{formatRupiah(c.cpa)}</TableCell>
                  <TableCell><Badge variant="outline" className={c.roas >= 2 ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-600'}>{c.roas.toFixed(2)}x</Badge></TableCell>
                </TableRow>
              ))}
              {campaigns.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">Belum ada data</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
