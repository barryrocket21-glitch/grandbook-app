'use client'
import { useState, useEffect } from 'react'
import { getErrorMessage } from '@/lib/errors'
import { createClient } from '@/lib/supabase/client'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import type { OrderDraftEnriched } from '@/lib/types'
import { formatRupiah } from '@/lib/format'

const supabase = createClient()

/**
 * Phase 8I-v3 — Resi Input Dialog (Quick Action)
 *
 * Click row di draft table → modal slide. Ketik resi → submit → UPDATE
 * orders_draft.resi → trigger promote_draft_to_orders fires → row hilang
 * dari draft, muncul di orders archive.
 */
export function ResiInputDialog({
  open,
  onOpenChange,
  draft,
  onPromoted,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  draft: OrderDraftEnriched | null
  onPromoted: () => void
}) {
  const [resi, setResi] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setResi('')
  }, [open])

  if (!draft) return null

  const submit = async () => {
    const cleaned = resi.trim()
    if (!cleaned) {
      toast.error('Resi wajib diisi')
      return
    }
    if (cleaned.length < 8) {
      toast.error('Resi minimal 8 karakter')
      return
    }
    setSaving(true)
    try {
      const { error } = await supabase
        .from('orders_draft')
        .update({ resi: cleaned, status: 'SIAP_KIRIM', status_changed_at: new Date().toISOString() })
        .eq('id', draft.id)
      if (error) throw error
      toast.success(`Resi ter-set — order pindah ke Arsip`, {
        description: `${draft.order_number} → resi ${cleaned}`,
      })
      onOpenChange(false)
      onPromoted()
    } catch (err) {
      const msg = getErrorMessage(err)
      toast.error('Gagal set resi', { description: msg })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            Input Resi — Cetak &amp; Pindah ke Arsip
          </DialogTitle>
          <DialogDescription>
            Set resi untuk order <span className="font-mono text-violet-500">{draft.order_number}</span>.
            Begitu resi tersimpan, order otomatis pindah dari Antrian Kerja ke Arsip.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="text-muted-foreground uppercase tracking-wide">Customer</div>
              <div className="font-medium mt-0.5">{draft.customer_name}</div>
            </div>
            <div>
              <div className="text-muted-foreground uppercase tracking-wide">Kota</div>
              <div className="font-medium mt-0.5">{draft.customer_city || '—'}</div>
            </div>
            <div>
              <div className="text-muted-foreground uppercase tracking-wide">Produk</div>
              <div className="font-medium mt-0.5 truncate" title={draft.product_summary || ''}>
                {draft.product_summary || '—'}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground uppercase tracking-wide">Total</div>
              <div className="font-medium tabular-nums mt-0.5">{formatRupiah(Number(draft.total))}</div>
            </div>
          </div>

          <div className="border-t pt-3 space-y-1.5">
            <Label htmlFor="resi-input" className="text-sm">Resi</Label>
            <Input
              id="resi-input"
              value={resi}
              onChange={(e) => setResi(e.target.value)}
              placeholder="SPXIDxxxxxxxxxxxx"
              className="font-mono"
              autoFocus
              autoComplete="off"
              onKeyDown={(e) => { if (e.key === 'Enter') void submit() }}
            />
            <p className="text-[10px] text-muted-foreground">
              SPX format: <code>SPXID</code> + 12 digit (total 17 char). Enter untuk submit.
            </p>
          </div>

          <div className="text-xs flex items-start gap-1.5 p-2 bg-amber-500/10 border border-amber-500/30 rounded">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-600" />
            <span className="text-amber-700 dark:text-amber-400">
              Trigger DB <code>promote_draft_to_orders</code> akan auto-pindah row ini ke <code>orders</code> + delete draft. Audit log catat event <code>PROMOTE_TO_ORDERS</code>.
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Batal</Button>
          <Button
            onClick={submit}
            disabled={saving || resi.trim().length < 8}
            className="bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white"
          >
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
            Cetak &amp; Pindah ke Arsip
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
