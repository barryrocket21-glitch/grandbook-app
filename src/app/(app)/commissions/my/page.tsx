'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Coins, TrendingUp } from 'lucide-react'
import { formatRupiah } from '@/lib/format'
import { COMMISSION_STATUS_COLORS } from '@/lib/constants'

const supabase = createClient()

export default function MyCommissionsPage() {
  const { user } = useAuth()
  const [commissions, setCommissions] = useState<any[]>([])

  useEffect(() => {
    if (!user) return
    const fetch = async () => {
      const { data } = await supabase.from('commissions').select('*').eq('user_id', user.id).order('period_start', { ascending: false })
      setCommissions(data || [])
    }
    fetch()
  }, [user])

  const totalEarned = commissions.filter(c => c.status === 'PAID').reduce((s: number, c: any) => s + Number(c.amount), 0)
  const totalPending = commissions.filter(c => c.status !== 'PAID').reduce((s: number, c: any) => s + Number(c.amount), 0)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-transparent">Komisi Saya</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="border-emerald-500/20"><CardContent className="pt-4 pb-4 flex items-center gap-3"><div className="p-2 bg-emerald-500/15 rounded-lg"><TrendingUp className="w-5 h-5 text-emerald-500" /></div><div><p className="text-xs text-muted-foreground">Total Diterima</p><p className="text-xl font-bold text-emerald-500">{formatRupiah(totalEarned)}</p></div></CardContent></Card>
        <Card className="border-yellow-500/20"><CardContent className="pt-4 pb-4 flex items-center gap-3"><div className="p-2 bg-yellow-500/15 rounded-lg"><Coins className="w-5 h-5 text-yellow-500" /></div><div><p className="text-xs text-muted-foreground">Pending</p><p className="text-xl font-bold text-yellow-500">{formatRupiah(totalPending)}</p></div></CardContent></Card>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Periode</TableHead><TableHead>Jumlah</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>
              {commissions.map((c: any) => (
                <TableRow key={c.id}>
                  <TableCell>{c.period_start} - {c.period_end}</TableCell>
                  <TableCell className="font-semibold">{formatRupiah(c.amount)}</TableCell>
                  <TableCell><Badge variant="outline" className={COMMISSION_STATUS_COLORS[c.status as keyof typeof COMMISSION_STATUS_COLORS]}>{c.status}</Badge></TableCell>
                </TableRow>
              ))}
              {commissions.length === 0 && <TableRow><TableCell colSpan={3} className="text-center py-12 text-muted-foreground">Belum ada data komisi</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
