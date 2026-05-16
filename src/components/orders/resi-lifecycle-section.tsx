'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { PermissionGuard } from '@/components/settings/permission-guard'
import { toast } from 'sonner'
import { Printer, Truck, PackageCheck, Pencil, AlertTriangle, Loader2 } from 'lucide-react'
import { formatDateTime } from '@/lib/format'
import type { OrderStatus, UserRole } from '@/lib/types'

const supabase = createClient()

interface Props {
  orderId: number
  status: OrderStatus
  resiPrintedAt: string | null
  pickedUpAt: string | null
  role: UserRole | null | undefined
  onUpdated: () => void
}

/**
 * Phase 8B — section di order detail yang tampilkan 3 milestone:
 * - Resi Dicetak (resi_printed_at)
 * - Di-pickup ekspedisi (picked_up_at)
 * - Diterima customer (status DITERIMA + status_changed_at, read-only di sini)
 *
 * Owner & admin bisa edit 2 timestamp pertama secara manual (datetime-local).
 * Pickup-pending badge muncul warning kalau >2 hari, danger kalau >7.
 */
export function ResiLifecycleSection({
  orderId, status, resiPrintedAt, pickedUpAt, role, onUpdated,
}: Props) {
  const [editing, setEditing] = useState<'resi_printed_at' | 'picked_up_at' | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const openEdit = (field: 'resi_printed_at' | 'picked_up_at') => {
    const current = field === 'resi_printed_at' ? resiPrintedAt : pickedUpAt
    setDraft(current ? toDatetimeLocal(current) : '')
    setEditing(field)
  }

  const save = async () => {
    if (!editing) return
    setSaving(true)
    try {
      const isoValue = draft ? new Date(draft).toISOString() : null
      const { error } = await supabase
        .from('orders')
        .update({ [editing]: isoValue })
        .eq('id', orderId)
      if (error) throw error
      toast.success('Timestamp diupdate')
      setEditing(null)
      onUpdated()
    } catch (err) {
      toast.error('Gagal simpan', { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setSaving(false)
    }
  }

  const pendingDays = computePendingDays(resiPrintedAt, pickedUpAt, status)

  return (
    <div className="space-y-2 text-sm">
      <h3 className="font-semibold text-base flex items-center gap-2">
        <span className="w-1.5 h-5 bg-emerald-500 rounded" />Resi Lifecycle
      </h3>

      <LifecycleRow
        icon={Printer}
        label="Resi Dicetak"
        value={resiPrintedAt}
        emptyLabel="(belum)"
        canEdit={role === 'owner' || role === 'admin'}
        onEdit={() => openEdit('resi_printed_at')}
      />

      <LifecycleRow
        icon={Truck}
        label="Di-pickup Ekspedisi"
        value={pickedUpAt}
        emptyLabel={status === 'SIAP_KIRIM' ? '(belum)' : '—'}
        canEdit={role === 'owner' || role === 'admin'}
        onEdit={() => openEdit('picked_up_at')}
        extra={
          pendingDays !== null ? (
            <Badge
              variant="outline"
              className={
                pendingDays > 7
                  ? 'bg-red-500/15 text-red-600 border-red-500/30'
                  : pendingDays > 2
                  ? 'bg-amber-500/15 text-amber-600 border-amber-500/30'
                  : 'bg-zinc-500/15 text-muted-foreground'
              }
            >
              {pendingDays > 7 ? <AlertTriangle className="w-3 h-3 mr-1" /> : null}
              {pendingDays > 0 ? `${pendingDays.toFixed(1)} hari` : 'baru saja'}
              {pendingDays > 2 ? ' pending' : ''}
            </Badge>
          ) : null
        }
      />

      <LifecycleRow
        icon={PackageCheck}
        label="Diterima"
        value={status === 'DITERIMA' ? pickedUpAt /* DITERIMA tidak tracked tersendiri di 8B */ : null}
        emptyLabel={status === 'DITERIMA' ? '(via status DITERIMA)' : '—'}
        canEdit={false}
      />

      {/* Edit dialog (owner+admin only via canEdit guard) */}
      <Dialog open={!!editing} onOpenChange={v => !v && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Edit {editing === 'resi_printed_at' ? 'Waktu Resi Dicetak' : 'Waktu Pickup'}
            </DialogTitle>
            <DialogDescription>
              Override timestamp manual. Kosongkan untuk clear value (kembali ke NULL).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Tanggal & Jam</Label>
            <Input
              type="datetime-local"
              value={draft}
              onChange={e => setDraft(e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground">
              Zona waktu lokal (browser). Disimpan sebagai UTC di DB.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>
              Batal
            </Button>
            <PermissionGuard role={role} allowedRoles={['owner', 'admin']}>
              <Button onClick={save} disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Simpan
              </Button>
            </PermissionGuard>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function LifecycleRow({
  icon: Icon, label, value, emptyLabel, canEdit, onEdit, extra,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string | null
  emptyLabel: string
  canEdit: boolean
  onEdit?: () => void
  extra?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2 py-1">
      <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
      <span className="text-xs text-muted-foreground w-32 shrink-0">{label}</span>
      <span className={`text-sm flex-1 ${value ? '' : 'italic text-muted-foreground'}`}>
        {value ? formatDateTime(value) : emptyLabel}
      </span>
      {extra}
      {canEdit && onEdit && (
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onEdit}>
          <Pencil className="w-3 h-3" />
        </Button>
      )}
    </div>
  )
}

/**
 * Konversi ISO timestamp → string yang valid untuk `<input type="datetime-local">`
 * (format: YYYY-MM-DDTHH:mm dalam zona waktu lokal browser).
 */
function toDatetimeLocal(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Compute hari pending pickup. Returns null kalau tidak relevan
 * (status bukan SIAP_KIRIM, atau sudah pickup, atau belum dicetak).
 */
function computePendingDays(
  resiPrintedAt: string | null,
  pickedUpAt: string | null,
  status: OrderStatus,
): number | null {
  if (status !== 'SIAP_KIRIM') return null
  if (pickedUpAt) return null
  if (!resiPrintedAt) return null
  const diffMs = Date.now() - new Date(resiPrintedAt).getTime()
  return diffMs / (1000 * 60 * 60 * 24)
}
