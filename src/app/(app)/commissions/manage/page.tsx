'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { Coins, CheckCircle, DollarSign } from 'lucide-react'
import { formatRupiah } from '@/lib/format'
import { COMMISSION_STATUS_COLORS, ROLE_LABELS } from '@/lib/constants'
import type { Commission, Profile } from '@/lib/types'

const supabase = createClient()

export default function ManageCommissionsPage() {
  const { role } = useAuth()
  const [commissions, setCommissions] = useState<(Commission & { user?: Profile })[]>([])
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))

  const fetch = async () => {
    const start = `${month}-01`, end = `${month}-31`
    const { data } = await supabase.from('commissions').select('*, user:profiles(*)').gte('period_start', start).lte('period_end', end).order('created_at', { ascending: false })
    setCommissions(data || [])
  }
  useEffect(() => { fetch() }, [month])

  const updateStatus = async (id: number, status: string) => {
    const { error } = await supabase.from('commissions').update({ status }).eq('id', id)
    if (error) { toast.error(error.message); return }
    toast.success(`Status diupdate ke ${status}`); fetch()
  }

  const calculateCommissions = async () => {
    toast.info('Menghitung komisi...', { description: 'Proses ini memerlukan backend function. Sementara ini placeholder.' })
  }

  const totalPending = commissions.filter(c => c.status === 'PENDING').reduce((s, c) => s + Number(c.amount), 0)
  const totalApproved = commissions.filter(c => c.status === 'APPROVED').reduce((s, c) => s + Number(c.amount), 0)
  const totalPaid = commissions.filter(c => c.status === 'PAID').reduce((s, c) => s + Number(c.amount), 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-transparent">Kelola Komisi</h1>
          <p className="text-muted-foreground mt-1">Approve dan track pembayaran komisi</p>
        </div>
        <div className="flex gap-2">
          <Input type="month" value={month} onChange={e => setMonth(e.target.value)} className="w-40" />
          {role === 'owner' && <Button onClick={calculateCommissions} className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white"><Coins className="w-4 h-4 mr-2" />Hitung Komisi</Button>}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-yellow-500/20"><CardContent className="pt-4 pb-4 flex items-center gap-3"><div className="p-2 bg-yellow-500/15 rounded-lg"><Coins className="w-5 h-5 text-yellow-500" /></div><div><p className="text-xs text-muted-foreground">Pending</p><p className="text-lg font-bold">{formatRupiah(totalPending)}</p></div></CardContent></Card>
        <Card className="border-blue-500/20"><CardContent className="pt-4 pb-4 flex items-center gap-3"><div className="p-2 bg-blue-500/15 rounded-lg"><CheckCircle className="w-5 h-5 text-blue-500" /></div><div><p className="text-xs text-muted-foreground">Approved</p><p className="text-lg font-bold">{formatRupiah(totalApproved)}</p></div></CardContent></Card>
        <Card className="border-emerald-500/20"><CardContent className="pt-4 pb-4 flex items-center gap-3"><div className="p-2 bg-emerald-500/15 rounded-lg"><DollarSign className="w-5 h-5 text-emerald-500" /></div><div><p className="text-xs text-muted-foreground">Paid</p><p className="text-lg font-bold">{formatRupiah(totalPaid)}</p></div></CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>User</TableHead><TableHead>Role</TableHead><TableHead>Periode</TableHead><TableHead>Jumlah</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {commissions.map(c => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.user?.full_name || '-'}</TableCell>
                  <TableCell><Badge variant="outline">{c.user?.role ? ROLE_LABELS[c.user.role] : '-'}</Badge></TableCell>
                  <TableCell className="text-sm">{c.period_start} - {c.period_end}</TableCell>
                  <TableCell className="font-semibold">{formatRupiah(c.amount)}</TableCell>
                  <TableCell><Badge variant="outline" className={COMMISSION_STATUS_COLORS[c.status]}>{c.status}</Badge></TableCell>
                  <TableCell>
                    {role === 'owner' && c.status === 'PENDING' && <Button size="sm" variant="outline" onClick={() => updateStatus(c.id, 'APPROVED')}>Approve</Button>}
                    {role === 'owner' && c.status === 'APPROVED' && <Button size="sm" variant="outline" onClick={() => updateStatus(c.id, 'PAID')}>Mark Paid</Button>}
                  </TableCell>
                </TableRow>
              ))}
              {commissions.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">Belum ada data komisi</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
