'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Truck, AlertTriangle, TrendingUp, TrendingDown, Eye } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { DateRangePicker, defaultRange, type DateRange } from '@/components/ui/date-range-picker'
import { formatRupiah, formatDate } from '@/lib/format'
import Link from 'next/link'

const supabase = createClient()

interface OrderRow {
  id: number
  order_number: string
  order_date: string
  customer_name: string
  shipping_cost: number
  shipping_cost_actual: number | null
  cs_id: string | null
  cs?: { full_name: string } | null
  ekspedisi: string | null
}

export default function ShippingDiffPage() {
  const { role, loading: authLoading } = useAuth()
  const [range, setRange] = useState<DateRange>(defaultRange())
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const { data } = await supabase
        .from('orders')
        .select('id, order_number, order_date, customer_name, shipping_cost, shipping_cost_actual, cs_id, ekspedisi, cs:profiles!cs_id(full_name)')
        .gte('order_date', range.from)
        .lte('order_date', range.to)
        .not('shipping_cost_actual', 'is', null)
        .is('duplicate_of', null)
        .order('order_date', { ascending: false })
      setOrders((data || []) as any)
      setLoading(false)
    }
    load()
  }, [range])

  // Per-CS aggregation
  const byCs = useMemo(() => {
    const m = new Map<string, { name: string; total: number; profit: number; loss: number; profitCount: number; lossCount: number; count: number }>()
    orders.forEach(o => {
      const csKey = o.cs_id || 'UNASSIGNED'
      const csName = o.cs?.full_name || 'Tidak ditugaskan'
      const diff = Number(o.shipping_cost) - Number(o.shipping_cost_actual)
      const cur = m.get(csKey) || { name: csName, total: 0, profit: 0, loss: 0, profitCount: 0, lossCount: 0, count: 0 }
      cur.total += diff
      cur.count += 1
      if (diff > 0) { cur.profit += diff; cur.profitCount += 1 }
      else if (diff < 0) { cur.loss += Math.abs(diff); cur.lossCount += 1 }
      m.set(csKey, cur)
    })
    return Array.from(m.entries()).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.total - a.total)
  }, [orders])

  const totals = useMemo(() => {
    let total = 0, profit = 0, loss = 0, profitCount = 0, lossCount = 0
    orders.forEach(o => {
      const diff = Number(o.shipping_cost) - Number(o.shipping_cost_actual)
      total += diff
      if (diff > 0) { profit += diff; profitCount += 1 }
      else if (diff < 0) { loss += Math.abs(diff); lossCount += 1 }
    })
    return { total, profit, loss, profitCount, lossCount }
  }, [orders])

  if (authLoading) return <div className="text-sm text-muted-foreground">Memeriksa akses...</div>
  if (role !== 'owner') {
    return (
      <Card className="max-w-md mx-auto mt-8">
        <CardContent className="pt-6 text-center space-y-2">
          <AlertTriangle className="w-10 h-10 text-yellow-500 mx-auto" />
          <h2 className="text-lg font-semibold">Akses Dibatasi</h2>
          <p className="text-sm text-muted-foreground">Halaman selisih ongkir hanya untuk Owner.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Truck}
        title="Selisih Ongkir"
        description="Selisih antara ongkir yang charged ke customer vs yang kita bayar ke ekspedisi"
        actions={<DateRangePicker value={range} onChange={setRange} />}
      />

      {/* Top stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className={`overflow-hidden relative ${totals.total > 0 ? 'border-emerald-500/30' : totals.total < 0 ? 'border-red-500/30' : ''}`}>
          <div className={`absolute inset-0 bg-gradient-to-br ${totals.total > 0 ? 'from-emerald-500/10' : totals.total < 0 ? 'from-red-500/10' : 'from-zinc-500/5'} to-transparent`} />
          <CardContent className="pt-4 pb-4 relative">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Net Selisih</p>
            <p className={`text-3xl font-bold mt-1 ${totals.total > 0 ? 'text-emerald-500' : totals.total < 0 ? 'text-red-500' : ''}`}>
              {totals.total > 0 ? '+' : ''}{formatRupiah(totals.total)}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{orders.length} order tercatat</p>
          </CardContent>
        </Card>
        <Card className="overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 flex items-center gap-3 relative">
            <div className="p-2.5 bg-emerald-500/15 rounded-xl ring-1 ring-emerald-500/20"><TrendingUp className="w-5 h-5 text-emerald-500" /></div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Profit Ekspedisi</p>
              <p className="text-xl font-bold text-emerald-500">+{formatRupiah(totals.profit)}</p>
              <p className="text-[10px] text-muted-foreground">{totals.profitCount} order, kita untung dari diskon ekspedisi</p>
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 flex items-center gap-3 relative">
            <div className="p-2.5 bg-red-500/15 rounded-xl ring-1 ring-red-500/20"><TrendingDown className="w-5 h-5 text-red-500" /></div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Rugi (CS Diskon)</p>
              <p className="text-xl font-bold text-red-500">-{formatRupiah(totals.loss)}</p>
              <p className="text-[10px] text-muted-foreground">{totals.lossCount} order, CS kasih diskon ke customer</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Per CS breakdown */}
      <Card>
        <CardContent className="p-0">
          <div className="p-4 pb-2">
            <h3 className="font-semibold text-base">Breakdown per CS</h3>
            <p className="text-xs text-muted-foreground">Sortir dari yang paling profit ke paling rugi</p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>CS</TableHead>
                <TableHead className="text-center">Order Tercatat</TableHead>
                <TableHead className="text-right">Profit</TableHead>
                <TableHead className="text-right">Rugi</TableHead>
                <TableHead className="text-right">Net</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => <TableRow key={i}><TableCell colSpan={5}><div className="h-4 bg-muted animate-pulse rounded" /></TableCell></TableRow>)
              ) : byCs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="p-0">
                    <EmptyState icon={Truck} title="Belum ada data selisih ongkir" description="Selisih muncul setelah admin/CS isi field 'Ongkir Actual' di order detail (yang sebenarnya kita bayar ke ekspedisi)." />
                  </TableCell>
                </TableRow>
              ) : byCs.map(c => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="text-center text-sm">{c.count}</TableCell>
                  <TableCell className="text-right text-emerald-500 text-sm">+{formatRupiah(c.profit)} <span className="text-[10px] text-muted-foreground">({c.profitCount})</span></TableCell>
                  <TableCell className="text-right text-red-500 text-sm">-{formatRupiah(c.loss)} <span className="text-[10px] text-muted-foreground">({c.lossCount})</span></TableCell>
                  <TableCell className={`text-right font-bold ${c.total > 0 ? 'text-emerald-500' : c.total < 0 ? 'text-red-500' : ''}`}>
                    {c.total > 0 ? '+' : ''}{formatRupiah(c.total)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Detail order rows */}
      <Card>
        <CardContent className="p-0">
          <div className="p-4 pb-2">
            <h3 className="font-semibold text-base">Detail per Order</h3>
            <p className="text-xs text-muted-foreground">Semua order yang sudah ada data ongkir actual-nya</p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tanggal</TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>CS</TableHead>
                <TableHead>Ekspedisi</TableHead>
                <TableHead className="text-right">Charged</TableHead>
                <TableHead className="text-right">Actual</TableHead>
                <TableHead className="text-right">Selisih</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => <TableRow key={i}><TableCell colSpan={9}><div className="h-4 bg-muted animate-pulse rounded" /></TableCell></TableRow>)
              ) : orders.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center py-12 text-sm text-muted-foreground">Belum ada order dengan ongkir actual</TableCell></TableRow>
              ) : orders.map(o => {
                const diff = Number(o.shipping_cost) - Number(o.shipping_cost_actual)
                return (
                  <TableRow key={o.id}>
                    <TableCell className="text-xs">{formatDate(o.order_date)}</TableCell>
                    <TableCell className="font-mono text-xs">{o.order_number}</TableCell>
                    <TableCell className="text-sm">{o.customer_name}</TableCell>
                    <TableCell className="text-sm">{o.cs?.full_name || <span className="text-muted-foreground">-</span>}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{o.ekspedisi || '-'}</Badge></TableCell>
                    <TableCell className="text-right text-sm">{formatRupiah(Number(o.shipping_cost))}</TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">{formatRupiah(Number(o.shipping_cost_actual))}</TableCell>
                    <TableCell className={`text-right font-semibold ${diff > 0 ? 'text-emerald-500' : diff < 0 ? 'text-red-500' : ''}`}>
                      {diff > 0 ? '+' : ''}{formatRupiah(diff)}
                    </TableCell>
                    <TableCell><Button variant="ghost" size="icon" render={<Link href={`/orders/${o.id}`} />}><Eye className="w-3.5 h-3.5" /></Button></TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="border-blue-500/20 bg-blue-500/5">
        <CardContent className="pt-4 pb-4 text-sm space-y-2">
          <p>📋 <strong>Cara isi data:</strong></p>
          <ul className="list-disc list-inside text-xs text-muted-foreground space-y-1">
            <li>Buka detail order → klik <strong>Edit</strong> → isi field <strong>Ongkir Actual</strong> (yang kita bayar ke ekspedisi sesuai invoice)</li>
            <li><span className="text-emerald-500">Selisih +</span> = kita untung (ekspedisi kasih diskon volume / promo)</li>
            <li><span className="text-red-500">Selisih −</span> = kita rugi (CS kasih diskon ongkir ke customer)</li>
            <li>Net selisih jangka panjang harusnya net positif kalau negosiasi ekspedisi & CS disiplin</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
