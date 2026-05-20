'use client'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { MoreHorizontal, Pencil, Trash2, Loader2, AlertTriangle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import type { OrderDraftEnriched } from '@/lib/types'

const supabase = createClient()

interface Props {
  row: OrderDraftEnriched
  onUpdated: () => void
  onEdit: () => void
}

/**
 * Dropdown actions per row di /orders/draft (Antrian Kerja).
 *
 * Items:
 * - Edit cepat   → DraftQuickEditDialog (semua role kecuali viewer)
 * - Hapus draft  → confirm + DELETE (owner+admin only, sesuai RLS)
 *
 * Workflow Resi (cetak + promote ke arsip) tetap via tombol "Resi" di kolom
 * actions — bukan via dropdown ini.
 */
export function DraftRowActions({ row, onUpdated, onEdit }: Props) {
  const { role } = useAuth()
  const isOwnerOrAdmin = role === 'owner' || role === 'admin'

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    setDeleting(true)
    try {
      const { error } = await supabase.from('orders_draft').delete().eq('id', row.id)
      if (error) throw error
      toast.success('Draft dihapus', { description: `Order ${row.order_number} dihapus dari Antrian Kerja.` })
      setDeleteOpen(false)
      onUpdated()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error('Gagal hapus draft', { description: msg })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={
          <Button variant="ghost" size="icon" className="h-7 w-7">
            <MoreHorizontal className="w-4 h-4" />
          </Button>
        } />
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel>Aksi Draft</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onEdit}>
            <Pencil className="w-3.5 h-3.5 mr-2" />
            Edit cepat
          </DropdownMenuItem>
          {isOwnerOrAdmin && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setDeleteOpen(true)}
                className="text-red-600 focus:text-red-600 focus:bg-red-500/10"
              >
                <Trash2 className="w-3.5 h-3.5 mr-2" />
                Hapus draft
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              Hapus draft?
            </DialogTitle>
            <DialogDescription>
              Draft <span className="font-mono text-foreground">{row.order_number}</span> ({row.customer_name}) akan dihapus permanent dari Antrian Kerja.
              Audit log tetap mencatat event ini.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md bg-red-500/5 border border-red-500/20 p-3 text-xs space-y-1">
            <div><span className="text-muted-foreground">Customer:</span> {row.customer_name}</div>
            <div><span className="text-muted-foreground">Kota:</span> {row.customer_city || '—'}</div>
            <div><span className="text-muted-foreground">Produk:</span> {row.product_summary || '—'}</div>
            <div><span className="text-muted-foreground">Total:</span> Rp {Number(row.total).toLocaleString('id-ID')}</div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>Batal</Button>
            <Button
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white gap-2"
            >
              {deleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Ya, hapus
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
