'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { AlertTriangle, Users } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { DateRangePicker, defaultRange, type DateRange } from '@/components/ui/date-range-picker'
import { formatRupiah } from '@/lib/format'

const supabase = createClient()

export default function CsListPage() {
  const { role, loading: authLoading } = useAuth()
  const [range, setRange] = useState<DateRange>(defaultRange())
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const [{ data: profiles }, { data: orders }, { data: leads }, { data: commissions }] = await Promise.all([
        supabase.from('profiles').select('id, full_name, role, active, created_at').eq('role', 'cs').order('full_name'),
        supabase.from('orders').select('id, cs_id, total, order_date, status, resi_status, shipping_cost, shipping_cost_actual').gte('order_date', range.from).lte('order_date', range.to).is('duplicate_of', null),
        supabase.from('cs_daily_leads').select('cs_id, leads_count, closing_count, rejected_count').gte('report_date', range.from).lte('report_date', range.to),
        supabase.from('commissions').select('user_id, amount, status, role, orders!inner(order_date)').gte('orders.order_date', range.from).lte('orders.order_date', range.to).eq('role', 'cs'),
      ])

      const list = (profiles || []).map((p: any) => {
        const myOrders = (orders || []).filter((o: any) => o.cs_id === p.id)
        const validOrders = myOrders.filter((o: any) => !['CANCEL', 'FAKE'].includes(o.status))
        const totalRevenue = validOrders.reduce((s: number, o: any) => s + Number(o.total), 0)
        const returnedCount = myOrders.filter((o: any) => o.resi_status === 'RETUR' || o.status === 'RETUR').length
        const myLeads = (leads || []).filter((l: any) => l.cs_id === p.id)
        const totalLeads = myLeads.reduce((s: number, l: any) => s + l.leads_count, 0)
        const totalClosing = myLeads.reduce((s: number, l: any) => s + l.closing_count, 0)
        const totalRejected = myLeads.reduce((s: number, l: any) => s + l.rejected_count, 0)
        const myCommissions = (commissions || []).filter((c: any) => c.user_id === p.id)
        const earned = myCommissions.filter((c: any) => c.status === 'EARNED').reduce((s: number, c: any) => s + Number(c.amount), 0)
        const estimated = myCommissions.filter((c: any) => c.status === 'ESTIMATED').reduce((s: number, c: any) => s + Number(c.amount), 0)
        let shippingDiff = 0
        myOrders.forEach((o: any) => {
          if (o.shipping_cost_actual !== null && o.shipping_cost_actual !== undefined) {
            shippingDiff += Number(o.shipping_cost) - Number(o.shipping_cost_actual)
          }
        })
        const cr = totalLeads > 0 ? (totalClosing / totalLeads) * 100 : 0
        const returRate = validOrders.length > 0 ? (returnedCount / validOrders.length) * 100 : 0
        return {
          ...p,
          orderCount: validOrders.length,
          totalRevenue,
          totalLeads, totalClosing, totalRejected,
          cr,
          returnedCount, returRate,
          earned, estimated,
          shippingDiff,
        }
      })

      setUsers(list)
      setLoading(false)
    }
    load()
  }, [range])

  const totals = useMemo(() => {
    return users.reduce((acc, u) => ({
      orders: acc.orders + u.orderCount,
      revenue: acc.revenue + u.totalRevenue,
      earned: acc.earned + u.earned,
      shippingDiff: acc.shippingDiff + u.shippingDiff,
    }), { orders: 0, revenue: 0, earned: 0, shippingDiff: 0 })
  }, [users])

  if (authLoading) return <div className="text-sm text-muted-foreground">Memeriksa akses...</div>
  if (role !== 'owner') {
    return (
      <Card className="max-w-md mx-auto mt-8">
        <CardContent className="pt-6 text-center space-y-2">
          <AlertTriangle className="w-10 h-10 text-yellow-500 mx-auto" />
          <h2 className="text-lg font-semibold">Akses Dibatasi</h2>
          <p className="text-sm text-muted-foreground">Hanya Owner yang dapat lihat daftar CS.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Users}
        title="Daftar CS"
        description={`${users.length} CS terdaftar`}
        actions={<DateRangePicker value={range} onChange={setRange} />}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card><CardContent className="pt-4 pb-4"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Order</p><p className="text-xl font-bold">{totals.orders}</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-4"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Revenue</p><p className="text-xl font-bold text-emerald-500">{formatRupiah(totals.revenue)}</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-4"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Komisi (EARNED)</p><p className="text-xl font-bold text-emerald-500">{formatRupiah(totals.earned)}</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-4"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Net Selisih Ongkir</p><p className={`text-xl font-bold ${totals.shippingDiff > 0 ? 'text-emerald-500' : totals.shippingDiff < 0 ? 'text-red-500' : ''}`}>{totals.shippingDiff > 0 ? '+' : ''}{formatRupiah(totals.shippingDiff)}</p></CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead className="text-center">Lead</TableHead>
                <TableHead className="text-center">Closing</TableHead>
                <TableHead className="text-center">CR</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-center">Retur</TableHead>
                <TableHead className="text-right">Komisi Earned</TableHead>
                <TableHead className="text-right">Selisih Ongkir</TableHead>
                <TableHead className="text-center">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => <TableRow key={i}><TableCell colSpan={9}><div className="h-4 bg-muted animate-pulse rounded" /></TableCell></TableRow>)
              ) : users.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="p-0"><EmptyState icon={Users} title="Belum ada CS" description="Tambah user dengan role 'cs' di Settings → Users." /></TableCell></TableRow>
              ) : users.map(u => {
                const crColor = u.cr >= 60 ? 'text-emerald-500' : u.cr >= 30 ? 'text-amber-500' : 'text-red-500'
                const returColor = u.returRate < 10 ? 'text-emerald-500' : u.returRate < 20 ? 'text-amber-500' : 'text-red-500'
                return (
                  <TableRow key={u.id} className={!u.active ? 'opacity-50' : ''}>
                    <TableCell>
                      <p className="font-medium">{u.full_name}</p>
                    </TableCell>
                    <TableCell className="text-center text-sm">{u.totalLeads}</TableCell>
                    <TableCell className="text-center text-sm font-semibold text-emerald-500">{u.totalClosing}<span className="text-xs text-muted-foreground"> / {u.orderCount}</span></TableCell>
                    <TableCell className={`text-center font-semibold ${crColor}`}>{u.totalLeads > 0 ? `${u.cr.toFixed(0)}%` : <span className="text-muted-foreground font-normal">—</span>}</TableCell>
                    <TableCell className="text-right">{formatRupiah(u.totalRevenue)}</TableCell>
                    <TableCell className={`text-center text-sm ${returColor}`}>{u.returnedCount > 0 ? `${u.returRate.toFixed(0)}% (${u.returnedCount})` : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-right text-emerald-500">{formatRupiah(u.earned)}<span className="text-[10px] text-muted-foreground block">+ pending {formatRupiah(u.estimated)}</span></TableCell>
                    <TableCell className={`text-right text-sm ${u.shippingDiff > 0 ? 'text-emerald-500' : u.shippingDiff < 0 ? 'text-red-500' : 'text-muted-foreground'}`}>{u.shippingDiff !== 0 ? `${u.shippingDiff > 0 ? '+' : ''}${formatRupiah(u.shippingDiff)}` : '—'}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={u.active ? 'bg-emerald-500/10 text-emerald-600' : 'bg-zinc-500/10'}>{u.active ? 'Aktif' : 'Nonaktif'}</Badge>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
