'use client'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  MoreHorizontal, Pencil, Trash2, Loader2, AlertTriangle, MapPin, Phone, Package,
  User, Wallet, Truck, CheckCircle2,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { STATUS_BADGE_COLOR, STATUS_LABEL } from '@/lib/schemas/settings'
import { formatRupiah, formatDate } from '@/lib/format'
import type { OrderDraftEnriched, OrderStatus } from '@/lib/types'

const supabase = createClient()

interface Props {
  row: OrderDraftEnriched
  onUpdated: () => void
  onEdit: () => void
}

/**
 * Aksi per row di /orders/draft. Tombol ⋮ → buka DIALOG "Detail Order" (bukan
 * dropdown — dropdown lama nge-scroll halaman karena anchor mepet tepi tabel
 * yang horizontal-scroll). Dialog nampilin detail order utuh + Edit cepat +
 * Hapus (owner/admin).
 */
export function DraftRowActions({ row, onUpdated, onEdit }: Props) {
  const { role } = useAuth()
  const isOwnerOrAdmin = role === 'owner' || role === 'admin'

  const [detailOpen, setDetailOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [addrDetail, setAddrDetail] = useState<string | null>(null)

  // Ambil alamat detail mentah (gak ada di enriched row) pas dialog kebuka
  useEffect(() => {
    if (!detailOpen) return
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('orders_draft')
        .select('customer_address_detail, customer_address')
        .eq('id', row.id).single()
      if (!cancelled && data) {
        const d = data as { customer_address_detail: string | null; customer_address: string | null }
        setAddrDetail(d.customer_address_detail || d.customer_address || null)
      }
    })()
    return () => { cancelled = true }
  }, [detailOpen, row.id])

  const handleDelete = async () => {
    setDeleting(true)
    try {
      const { error } = await supabase.from('orders_draft').delete().eq('id', row.id)
      if (error) throw error
      toast.success('Draft dihapus', { description: `Order ${row.order_number} dihapus dari Antrian Kerja.` })
      setDeleteOpen(false)
      setDetailOpen(false)
      onUpdated()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error('Gagal hapus draft', { description: msg })
    } finally {
      setDeleting(false)
    }
  }

  const status = row.status as OrderStatus
  const statusColor = STATUS_BADGE_COLOR[status] || 'bg-zinc-500/10 text-zinc-600 border-zinc-500/30'
  const ready = !!row.wilayah_id
  const wilayahLine = [row.customer_subdistrict, row.customer_city, row.customer_province]
    .filter(Boolean).join(', ') || '—'

  const Field = ({ icon: Icon, label, value }: { icon: typeof MapPin; label: string; value: React.ReactNode }) => (
    <div className="flex items-start gap-2 text-sm">
      <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" />
      <span className="text-muted-foreground w-24 shrink-0">{label}</span>
      <span className="flex-1 break-words">{value}</span>
    </div>
  )

  return (
    <>
      <Button
        variant="ghost" size="icon" className="h-7 w-7"
        onClick={() => setDetailOpen(true)}
        title="Lihat detail order"
        aria-label="Detail order"
      >
        <MoreHorizontal className="w-4 h-4" />
      </Button>

      {/* Detail Order */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 pr-8">
              <Package className="w-4 h-4 text-violet-500 shrink-0" />
              <span className="font-mono text-sm">{row.order_number}</span>
              <Badge variant="outline" className={`${statusColor} text-[10px] ml-auto`}>{STATUS_LABEL[status] || row.status}</Badge>
            </DialogTitle>
            <DialogDescription>Input {formatDate(row.created_at)}</DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-1">
            <Field icon={User} label="Customer" value={row.customer_name || '—'} />
            <Field icon={Phone} label="No HP" value={row.customer_phone || <span className="text-muted-foreground italic">—</span>} />
            <Field icon={MapPin} label="Wilayah" value={
              <span className="inline-flex items-center gap-1">
                {wilayahLine}
                {ready
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  : <span className="inline-flex items-center gap-0.5 text-orange-600 text-xs"><AlertTriangle className="w-3 h-3" />perlu dibenerin</span>}
                {row.customer_zip ? <span className="text-muted-foreground">· {row.customer_zip}</span> : null}
              </span>
            } />
            <Field icon={MapPin} label="Detail/patokan" value={addrDetail ?? <span className="text-muted-foreground italic">memuat…</span>} />
            <Field icon={Package} label="Produk" value={row.product_summary || '—'} />
            <Field icon={Wallet} label="Total" value={
              <>
                {formatRupiah(Number(row.total))}
                {row.cod_amount != null && <span className="text-muted-foreground"> · COD {formatRupiah(Number(row.cod_amount))}</span>}
                <span className="text-muted-foreground"> · {row.payment_method}</span>
              </>
            } />
            <Field icon={Truck} label="Ekspedisi" value={row.channel_name || '—'} />
            <Field icon={User} label="CS" value={row.cs_name || '—'} />
            {row.customer_note && <Field icon={Pencil} label="Catatan cust" value={row.customer_note} />}
            {row.internal_note && <Field icon={Pencil} label="Catatan internal" value={row.internal_note} />}
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            {isOwnerOrAdmin && (
              <Button
                variant="outline" onClick={() => setDeleteOpen(true)}
                className="gap-1.5 border-red-500/40 text-red-600 hover:bg-red-500/10 mr-auto"
              >
                <Trash2 className="w-3.5 h-3.5" /> Hapus
              </Button>
            )}
            <Button variant="outline" onClick={() => setDetailOpen(false)}>Tutup</Button>
            <Button onClick={() => { setDetailOpen(false); onEdit() }} className="gap-1.5 bg-violet-600 hover:bg-violet-700">
              <Pencil className="w-3.5 h-3.5" /> Edit cepat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hapus confirm */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              Hapus draft?
            </DialogTitle>
            <DialogDescription>
              Draft <span className="font-mono text-foreground">{row.order_number}</span> ({row.customer_name}) akan dihapus permanent dari Antrian Kerja. Audit log tetap mencatat event ini.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>Batal</Button>
            <Button onClick={handleDelete} disabled={deleting} className="bg-red-600 hover:bg-red-700 text-white gap-2">
              {deleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Ya, hapus
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
