'use client'
import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Coins, CheckCircle2, Clock, XCircle } from 'lucide-react'
import { formatRupiah, formatDate } from '@/lib/format'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'

const supabase = createClient()

const monthAgo = () => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0] }
const today = () => new Date().toISOString().split('T')[0]

const STATUS_COLOR: Record<string, string> = {
  ESTIMATED: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
  EARNED: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
  CANCELLED: 'bg-red-500/10 text-red-600 border-red-500/30',
}

export default function MyCommissionsPage() {
  const { user, role } = useAuth()
  const [from, setFrom] = useState(monthAgo())
  const [to, setTo] = useState(today())
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    const load = async () => {
      setLoading(true)
      const { data } = await supabase
        .from('commissions')
        .select('id, role, amount, status, earned_at, cancelled_at, cancelled_reason, created_at, orders!inner(order_number, order_date, customer_name, total, resi_status)')
        .eq('user_id', user.id)
        .gte('orders.order_date', from)
        .lte('orders.order_date', to)
        .order('created_at', { ascending: false })
      setRows(data || [])
      setLoading(false)
    }
    load()
  }, [user, from, to])

  const totals = useMemo(() => {
    const t = { estimated: 0, earned: 0, cancelled: 0 }
    rows.forEach(r => {
      if (r.status === 'ESTIMATED') t.estimated += Number(r.amount)
      else if (r.status === 'EARNED') t.earned += Number(r.amount)
      else if (r.status === 'CANCELLED') t.cancelled += Number(r.amount)
    })
    return t
  }, [rows])

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Coins}
        title="Komisi Saya"
        description="Komisi dari order kamu — estimasi (pending kirim), earned (sudah diterima customer), cancelled (retur/fake)"
        actions={
          <div className="flex items-center gap-2">
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-36" />
            <span className="text-xs text-muted-foreground">s/d</span>
            <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-36" />
          </div>
        }
      />

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="overflow-hidden relative group hover:shadow-lg transition-shadow">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 flex items-center gap-3 relative">
            <div className="p-2.5 bg-emerald-500/15 rounded-xl ring-1 ring-emerald-500/20"><CheckCircle2 className="w-5 h-5 text-emerald-500" /></div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Confirmed (Earned)</p>
              <p className="text-xl font-bold text-emerald-500">{formatRupiah(totals.earned)}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">akan dibayar</p>
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden relative group hover:shadow-lg transition-shadow">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 flex items-center gap-3 relative">
            <div className="p-2.5 bg-amber-500/15 rounded-xl ring-1 ring-amber-500/20"><Clock className="w-5 h-5 text-amber-500" /></div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Pending (Estimated)</p>
              <p className="text-xl font-bold text-amber-500">{formatRupiah(totals.estimated)}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">masih dikirim</p>
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden relative group hover:shadow-lg transition-shadow">
          <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 flex items-center gap-3 relative">
            <div className="p-2.5 bg-red-500/15 rounded-xl ring-1 ring-red-500/20"><XCircle className="w-5 h-5 text-red-500" /></div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Batal (Retur/Fake)</p>
              <p className="text-xl font-bold text-red-500">{formatRupiah(totals.cancelled)}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">tidak dihitung</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tanggal Order</TableHead>
                <TableHead>No. Order</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Komisi</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={6} className="py-3"><div className="h-4 bg-muted animate-pulse rounded w-full" /></TableCell></TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="p-0">
                    <EmptyState icon={Coins} title="Belum ada komisi di periode ini" description="Komisi muncul saat order kamu sudah berstatus DIKIRIM. Estimasi jadi confirmed setelah resi DITERIMA." />
                  </TableCell>
                </TableRow>
              ) : rows.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="text-sm">{formatDate(r.orders.order_date)}</TableCell>
                  <TableCell className="font-mono text-xs">{r.orders.order_number}</TableCell>
                  <TableCell className="text-sm">{r.orders.customer_name}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{r.role}</Badge></TableCell>
                  <TableCell className={`font-semibold text-right ${r.status === 'CANCELLED' ? 'line-through text-muted-foreground' : ''}`}>
                    {formatRupiah(Number(r.amount))}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={STATUS_COLOR[r.status] || ''}>
                      {r.status}
                    </Badge>
                    {r.cancelled_reason && <p className="text-[10px] text-muted-foreground mt-0.5">{r.cancelled_reason}</p>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="border-blue-500/20 bg-blue-500/5">
        <CardContent className="pt-4 pb-4 text-sm text-muted-foreground">
          💡 <strong className="text-foreground">Cara kerja komisi:</strong> Estimasi muncul saat order DIKIRIM. Begitu resi <Badge variant="outline" className="text-xs">DITERIMA</Badge> dari ekspedisi, komisi otomatis pindah ke <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-600">EARNED</Badge>. Kalau RETUR atau FAKE, komisi <Badge variant="outline" className="text-xs bg-red-500/10 text-red-600">CANCELLED</Badge>. Yang dibayar akhir bulan = total EARNED.
        </CardContent>
      </Card>
    </div>
  )
}
