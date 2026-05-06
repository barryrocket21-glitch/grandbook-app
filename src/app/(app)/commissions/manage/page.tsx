'use client'
import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Coins, CheckCircle2, Clock, XCircle, AlertTriangle } from 'lucide-react'
import { formatRupiah, formatDate } from '@/lib/format'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { DateRangePicker, type DateRange } from '@/components/ui/date-range-picker'

const supabase = createClient()

const STATUS_COLOR: Record<string, string> = {
  ESTIMATED: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
  EARNED: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
  CANCELLED: 'bg-red-500/10 text-red-600 border-red-500/30',
}

const startOfThisMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0] }
const today = () => new Date().toISOString().split('T')[0]

export default function ManageCommissionsPage() {
  const { role } = useAuth()
  const [range, setRange] = useState<DateRange>({ from: startOfThisMonth(), to: today(), label: 'Bulan ini' })
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (role !== 'owner' && role !== 'admin') return
    const load = async () => {
      setLoading(true)
      const { data } = await supabase
        .from('commissions')
        .select('id, role, amount, status, earned_at, cancelled_at, cancelled_reason, created_at, user:profiles!user_id(id, full_name, role), orders!inner(order_number, order_date, customer_name, total)')
        .gte('orders.order_date', range.from)
        .lte('orders.order_date', range.to)
        .order('created_at', { ascending: false })
      setRows(data || [])
      setLoading(false)
    }
    load()
  }, [range, role])

  const totals = useMemo(() => {
    const t = { estimated: 0, earned: 0, cancelled: 0, byUser: new Map<string, { user: any, est: number, earned: number, cancelled: number }>() }
    rows.forEach(r => {
      const amount = Number(r.amount)
      if (r.status === 'ESTIMATED') t.estimated += amount
      else if (r.status === 'EARNED') t.earned += amount
      else if (r.status === 'CANCELLED') t.cancelled += amount

      if (r.user?.id) {
        const u = t.byUser.get(r.user.id) || { user: r.user, est: 0, earned: 0, cancelled: 0 }
        if (r.status === 'ESTIMATED') u.est += amount
        else if (r.status === 'EARNED') u.earned += amount
        else if (r.status === 'CANCELLED') u.cancelled += amount
        t.byUser.set(r.user.id, u)
      }
    })
    return t
  }, [rows])

  if (role && !['owner', 'admin'].includes(role)) {
    return (
      <Card className="max-w-md mx-auto mt-8">
        <CardContent className="pt-6 text-center space-y-2">
          <AlertTriangle className="w-10 h-10 text-yellow-500 mx-auto" />
          <h2 className="text-lg font-semibold">Akses Dibatasi</h2>
          <p className="text-sm text-muted-foreground">Halaman ini untuk Owner & Admin.</p>
        </CardContent>
      </Card>
    )
  }

  const totalToPay = totals.earned // yang final, akan dibayar

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Coins}
        title="Kelola Komisi"
        description="Monitor komisi semua user"
        actions={<DateRangePicker value={range} onChange={setRange} />}
      />

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card className="overflow-hidden relative group hover:shadow-lg transition-shadow border-violet-500/30 bg-gradient-to-br from-violet-500/5 to-indigo-500/5">
          <CardContent className="pt-4 pb-4 relative">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Total yang akan dibayar</p>
            <p className="text-2xl font-bold text-violet-500 mt-1">{formatRupiah(totalToPay)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">EARNED only — sudah final</p>
          </CardContent>
        </Card>
        <Card className="overflow-hidden relative group hover:shadow-lg transition-shadow">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 flex items-center gap-3 relative">
            <div className="p-2.5 bg-emerald-500/15 rounded-xl ring-1 ring-emerald-500/20"><CheckCircle2 className="w-5 h-5 text-emerald-500" /></div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Earned</p>
              <p className="text-lg font-bold text-emerald-500">{formatRupiah(totals.earned)}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden relative group hover:shadow-lg transition-shadow">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 flex items-center gap-3 relative">
            <div className="p-2.5 bg-amber-500/15 rounded-xl ring-1 ring-amber-500/20"><Clock className="w-5 h-5 text-amber-500" /></div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Estimated</p>
              <p className="text-lg font-bold text-amber-500">{formatRupiah(totals.estimated)}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden relative group hover:shadow-lg transition-shadow">
          <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 flex items-center gap-3 relative">
            <div className="p-2.5 bg-red-500/15 rounded-xl ring-1 ring-red-500/20"><XCircle className="w-5 h-5 text-red-500" /></div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Cancelled</p>
              <p className="text-lg font-bold text-red-500">{formatRupiah(totals.cancelled)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Per-user summary */}
      {totals.byUser.size > 0 && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-right">Estimated</TableHead>
                  <TableHead className="text-right">Earned</TableHead>
                  <TableHead className="text-right">Cancelled</TableHead>
                  <TableHead className="text-right">Yang dibayar</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from(totals.byUser.values()).sort((a, b) => b.earned - a.earned).map(u => (
                  <TableRow key={u.user.id}>
                    <TableCell className="font-medium">{u.user.full_name}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{u.user.role}</Badge></TableCell>
                    <TableCell className="text-right text-amber-600">{formatRupiah(u.est)}</TableCell>
                    <TableCell className="text-right text-emerald-600 font-semibold">{formatRupiah(u.earned)}</TableCell>
                    <TableCell className="text-right text-red-500">{formatRupiah(u.cancelled)}</TableCell>
                    <TableCell className="text-right font-bold text-violet-500">{formatRupiah(u.earned)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Detail rows */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tanggal</TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Komisi</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={7} className="py-3"><div className="h-4 bg-muted animate-pulse rounded w-full" /></TableCell></TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="p-0">
                    <EmptyState icon={Coins} title="Belum ada komisi di bulan ini" description="Komisi otomatis ter-create saat order DIKIRIM. Pastikan ada commission rules aktif di Settings." />
                  </TableCell>
                </TableRow>
              ) : rows.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="text-sm">{formatDate(r.orders.order_date)}</TableCell>
                  <TableCell className="font-mono text-xs">{r.orders.order_number}</TableCell>
                  <TableCell className="text-sm">{r.orders.customer_name}</TableCell>
                  <TableCell className="font-medium">{r.user?.full_name || '-'}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{r.role}</Badge></TableCell>
                  <TableCell className={`font-semibold text-right ${r.status === 'CANCELLED' ? 'line-through text-muted-foreground' : ''}`}>{formatRupiah(Number(r.amount))}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={STATUS_COLOR[r.status] || ''}>{r.status}</Badge>
                    {r.cancelled_reason && <p className="text-[10px] text-muted-foreground mt-0.5">{r.cancelled_reason}</p>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
