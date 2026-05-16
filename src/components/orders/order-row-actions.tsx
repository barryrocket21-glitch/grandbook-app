'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import {
  MoreHorizontal, Pencil, Copy, Ban, Ghost, History, Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import { generateOrderNumber } from '@/lib/orders/order-number'
import { canApproveOrders, canCreateOrders } from '@/lib/auth/permissions'
import { formatDateTime } from '@/lib/format'
import type { OrderEnriched, AuditLogRow } from '@/lib/types'

const supabase = createClient()

type ActionMode = 'cancel' | 'fake' | 'audit' | null

interface Props {
  row: OrderEnriched
  onUpdated: () => void
}

/**
 * Phase 8E — Dropdown actions per row di /orders/list.
 *
 * Items:
 * - Edit         → navigate /orders/[id]
 * - Duplicate    → create new order copy (owner+admin+cs)
 * - Cancel       → status CANCEL + alasan (owner+admin)
 * - Mark as Fake → status FAKE + alasan (owner+admin)
 * - View Audit   → modal show audit log for this order (owner only)
 */
export function OrderRowActions({ row, onUpdated }: Props) {
  const { user, profile, role } = useAuth()
  const router = useRouter()
  const [mode, setMode] = useState<ActionMode>(null)
  const [reason, setReason] = useState('')
  const [duplicating, setDuplicating] = useState(false)
  const [saving, setSaving] = useState(false)

  const canApprove = canApproveOrders(role)   // owner + admin
  const canCreate  = canCreateOrders(role)    // owner + admin + cs
  const isOwner    = role === 'owner'

  const handleDuplicate = async () => {
    if (!user) return
    setDuplicating(true)
    try {
      const orgId = profile?.organization_id || 1
      const newNumber = await generateOrderNumber(supabase, orgId)

      // 1. Load full order data
      const { data: fullOrder, error: fetchErr } = await supabase
        .from('orders').select('*').eq('id', row.id).single()
      if (fetchErr || !fullOrder) throw fetchErr || new Error('Order tidak ditemukan')

      // 2. Build payload — copy hampir semua field kecuali identity & status-related
      const omit = new Set([
        'id', 'order_number', 'external_order_id', 'resi', 'status', 'status_changed_at',
        'created_at', 'updated_at', 'cost_computed_at',
        'shipping_cost_actual', 'payout_amount', 'cod_amount',
        'estimated_shipping_net', 'estimated_cod_fee', 'estimated_ppn',
        'estimated_total_cost', 'estimated_cash_in', 'estimated_profit',
        'resi_printed_at', 'picked_up_at', 'delivered_at', 'returned_at',
        'reject_reason', 'last_contact_at', 'cs_attempts',
      ])
      const payload: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(fullOrder)) {
        if (omit.has(k)) continue
        payload[k] = v
      }
      payload.order_number = newNumber
      payload.status = 'BARU'
      payload.created_by = user.id
      payload.cs_attempts = 0

      const { data: newRow, error: insertErr } = await supabase
        .from('orders').insert(payload).select('id').single()
      if (insertErr || !newRow) throw insertErr || new Error('Insert gagal')

      // 3. Copy order_items
      const { data: items } = await supabase
        .from('order_items').select('*').eq('order_id', row.id)
      if (items && items.length > 0) {
        const newItems = items.map((it: Record<string, unknown>) => {
          const copy: Record<string, unknown> = { ...it }
          delete copy.id
          delete copy.created_at
          copy.order_id = newRow.id
          return copy
        })
        await supabase.from('order_items').insert(newItems)
      }

      toast.success(`Order baru ${newNumber} dibuat`)
      router.push(`/orders/${newRow.id}`)
    } catch (err) {
      toast.error('Gagal duplicate', { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setDuplicating(false)
    }
  }

  const handleSetStatus = async (newStatus: 'CANCEL' | 'FAKE') => {
    if (!reason.trim()) {
      toast.error('Alasan wajib diisi')
      return
    }
    setSaving(true)
    try {
      const { error } = await supabase
        .from('orders')
        .update({ status: newStatus, reject_reason: reason.trim() })
        .eq('id', row.id)
      if (error) throw error
      toast.success(`Order ${row.order_number} → ${newStatus}`)
      setMode(null)
      setReason('')
      onUpdated()
    } catch (err) {
      toast.error('Gagal update status', { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setSaving(false)
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
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wider">
            Order {row.order_number}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          <DropdownMenuItem render={<Link href={`/orders/${row.id}`} />}>
            <Pencil className="w-3.5 h-3.5 mr-2" />
            Edit
          </DropdownMenuItem>

          {canCreate && (
            <DropdownMenuItem onClick={handleDuplicate} disabled={duplicating}>
              {duplicating
                ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                : <Copy className="w-3.5 h-3.5 mr-2" />}
              Duplicate
            </DropdownMenuItem>
          )}

          {canApprove && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setMode('cancel')} className="text-amber-600">
                <Ban className="w-3.5 h-3.5 mr-2" />
                Cancel Order
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setMode('fake')} className="text-red-600">
                <Ghost className="w-3.5 h-3.5 mr-2" />
                Mark as Fake
              </DropdownMenuItem>
            </>
          )}

          {isOwner && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setMode('audit')}>
                <History className="w-3.5 h-3.5 mr-2" />
                View Audit Trail
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Cancel / Fake dialog (shared) */}
      <Dialog open={mode === 'cancel' || mode === 'fake'} onOpenChange={v => { if (!v) { setMode(null); setReason('') } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className={mode === 'cancel' ? 'text-amber-600' : 'text-red-600'}>
              {mode === 'cancel' ? 'Cancel Order?' : 'Mark as Fake?'}
            </DialogTitle>
            <DialogDescription>
              Order <span className="font-mono">{row.order_number}</span> akan ditandai
              {' '}<strong>{mode === 'cancel' ? 'CANCEL' : 'FAKE'}</strong>.
              Soft-delete — data tetap di DB, tidak hilang dari audit log.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-sm">Alasan *</Label>
            <Textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder={mode === 'cancel' ? 'Customer ga jadi, salah input, dst' : 'Order palsu, spam, test, dst'}
            />
            <p className="text-[10px] text-muted-foreground">Alasan disimpan di field reject_reason untuk audit.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setMode(null); setReason('') }} disabled={saving}>Batal</Button>
            <Button
              onClick={() => handleSetStatus(mode === 'cancel' ? 'CANCEL' : 'FAKE')}
              disabled={saving || !reason.trim()}
              className={mode === 'cancel' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-red-600 hover:bg-red-700'}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Konfirmasi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Audit trail dialog (owner only) */}
      {mode === 'audit' && (
        <AuditTrailDialog
          orderId={row.id}
          orderNumber={row.order_number}
          onClose={() => setMode(null)}
        />
      )}
    </>
  )
}

function AuditTrailDialog({ orderId, orderNumber, onClose }: {
  orderId: number; orderNumber: string; onClose: () => void
}) {
  const [logs, setLogs] = useState<AuditLogRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data, error } = await supabase.rpc('list_audit_logs', {
          p_from: null, p_to: null, p_user_id: null,
          p_table_name: 'orders', p_action: null,
          p_search: String(orderId),
          p_limit: 50, p_offset: 0,
        })
        if (error) throw error
        if (!cancelled) setLogs((data || []) as AuditLogRow[])
      } catch (err) {
        if (!cancelled) {
          toast.error('Gagal load audit log', { description: err instanceof Error ? err.message : String(err) })
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [orderId])

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="w-4 h-4" />
            Audit Trail — <span className="font-mono">{orderNumber}</span>
          </DialogTitle>
          <DialogDescription>
            Semua mutasi data untuk order ini.{' '}
            <Link href="/settings/audit-log" className="text-violet-500 hover:underline">
              Buka full audit log →
            </Link>
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="p-6 text-center text-xs text-muted-foreground">Memuat…</div>
        ) : logs.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            Belum ada audit entry untuk order ini.
          </div>
        ) : (
          <ul className="space-y-2">
            {logs.map(l => (
              <li key={l.id} className="border rounded p-2 text-xs space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="font-mono text-[9px]">{l.action}</Badge>
                  <span className="text-muted-foreground">{formatDateTime(l.created_at)}</span>
                  {l.user_name && <span>· <strong>{l.user_name}</strong></span>}
                </div>
                {l.action === 'UPDATE' && l.old_value && l.new_value && (
                  <ChangedFieldsSummary oldVal={l.old_value} newVal={l.new_value} />
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ChangedFieldsSummary({ oldVal, newVal }: {
  oldVal: Record<string, unknown>; newVal: Record<string, unknown>
}) {
  const changed = Object.keys(newVal).filter(
    k => JSON.stringify(oldVal[k]) !== JSON.stringify(newVal[k])
  )
  if (changed.length === 0) return null
  return (
    <p className="text-[10px] text-muted-foreground">
      {changed.length} field berubah: <span className="font-mono">{changed.slice(0, 5).join(', ')}</span>
      {changed.length > 5 && <> +{changed.length - 5}</>}
    </p>
  )
}
