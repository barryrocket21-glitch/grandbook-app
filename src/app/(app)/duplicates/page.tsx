'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { Copy, AlertTriangle, Eye, Undo2 } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { formatRupiah, formatDate } from '@/lib/format'
import Link from 'next/link'

const supabase = createClient()

export default function DuplicatesPage() {
  const { role, loading: authLoading } = useAuth()
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('orders')
      .select(`
        id, order_number, customer_name, customer_phone, total, order_date, status,
        cs:profiles!cs_id(full_name),
        original:orders!duplicate_of(id, order_number, customer_name, order_date, total, status, cs:profiles!cs_id(full_name))
      `)
      .not('duplicate_of', 'is', null)
      .order('created_at', { ascending: false })
      .limit(100)
    setRows(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const undoMark = async (id: number) => {
    if (!confirm('Hapus tanda duplicate dari order ini? Order ini akan kembali dihitung untuk komisi/CR.')) return
    const { error } = await supabase.from('orders').update({ duplicate_of: null }).eq('id', id)
    if (error) { toast.error('Gagal', { description: error.message }); return }
    toast.success('Order tidak lagi ditandai duplicate')
    load()
  }

  if (authLoading) return <div className="text-sm text-muted-foreground">Memeriksa akses...</div>
  if (role !== 'owner') {
    return (
      <Card className="max-w-md mx-auto mt-8">
        <CardContent className="pt-6 text-center space-y-2">
          <AlertTriangle className="w-10 h-10 text-yellow-500 mx-auto" />
          <h2 className="text-lg font-semibold">Akses Dibatasi</h2>
          <p className="text-sm text-muted-foreground">Halaman duplicate inbox hanya untuk Owner.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Copy}
        title="Duplicate Inbox"
        description={`${rows.length} order yang ditandai duplicate (tidak dihitung di analytics & komisi)`}
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tanggal</TableHead>
                <TableHead>Order Duplicate</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>CS</TableHead>
                <TableHead>Original Order</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
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
                    <EmptyState
                      icon={Copy}
                      title="Belum ada order duplicate"
                      description="Saat CS bikin order dengan customer phone yang sudah ada di 7 hari terakhir, order itu otomatis ditandai duplicate dan masuk ke sini."
                    />
                  </TableCell>
                </TableRow>
              ) : rows.map((r: any) => {
                const original = r.original
                const sameCs = original?.cs?.full_name === r.cs?.full_name
                return (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm">{formatDate(r.order_date)}</TableCell>
                    <TableCell>
                      <div>
                        <p className="font-mono text-xs">{r.order_number}</p>
                        <Badge variant="outline" className="text-[10px] mt-0.5">{r.status}</Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <p className="font-medium text-sm">{r.customer_name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{r.customer_phone}</p>
                    </TableCell>
                    <TableCell className="text-sm">{r.cs?.full_name || '-'}</TableCell>
                    <TableCell>
                      {original ? (
                        <div className="text-xs space-y-0.5">
                          <p className="font-mono">{original.order_number}</p>
                          <p className="text-muted-foreground">{formatDate(original.order_date)} • {original.cs?.full_name}</p>
                          {!sameCs && original?.cs?.full_name && (
                            <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-600">CS lain</Badge>
                          )}
                        </div>
                      ) : <span className="text-xs text-muted-foreground">order asli sudah dihapus</span>}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm line-through text-muted-foreground">{formatRupiah(r.total)}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" title="Lihat detail order" render={<Link href={`/orders/${r.id}`} />}><Eye className="w-4 h-4" /></Button>
                        <Button variant="ghost" size="icon" title="Bukan duplicate — hitung lagi" onClick={() => undoMark(r.id)}><Undo2 className="w-4 h-4 text-emerald-500" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="border-blue-500/20 bg-blue-500/5">
        <CardContent className="pt-4 pb-4 text-sm space-y-2">
          <p>📋 <strong>Cara kerja duplicate detection:</strong></p>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground text-xs">
            <li>Saat CS bikin order baru dengan customer_phone yang sudah ada di 7 hari terakhir, sistem warning</li>
            <li>Kalau CS lanjut → order tetap dibuat, tapi <code className="px-1 bg-muted rounded">duplicate_of</code> di-set ke order asal</li>
            <li>Order duplicate <strong>tidak dihitung</strong> di analytics matrix, profit dashboard, atau komisi</li>
            <li>Kalau ternyata bukan duplicate beneran (customer order ulang sungguhan), klik <Undo2 className="w-3 h-3 inline text-emerald-500" /> untuk un-mark</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
