'use client'
import { useCallback, useEffect, useState } from 'react'
import { getErrorMessage } from '@/lib/errors'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Inbox, Phone, RefreshCw, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/format'
import { normalize_phone_id_safe } from '@/lib/converter/transforms'
import type { InboxInvalidPhone, PhoneInvalidReason } from '@/lib/types'

const supabase = createClient()

const REASON_LABEL: Record<PhoneInvalidReason, string> = {
  scientific_notation: 'Scientific notation (Excel CSV corrupt)',
  too_short: 'Terlalu pendek (<10 digit)',
  too_long: 'Terlalu panjang (>15 digit)',
  non_numeric: 'Bukan angka',
  empty: 'Kosong',
}
const REASON_COLOR: Record<PhoneInvalidReason, string> = {
  scientific_notation: 'bg-red-500/15 text-red-600 border-red-500/30',
  too_short: 'bg-amber-500/15 text-amber-600 border-amber-500/30',
  too_long: 'bg-amber-500/15 text-amber-600 border-amber-500/30',
  non_numeric: 'bg-red-500/15 text-red-600 border-red-500/30',
  empty: 'bg-zinc-500/15 text-muted-foreground',
}

interface InboxRow extends InboxInvalidPhone {
  order?: { id: number; order_number: string; customer_name: string }
}

export default function PhoneReviewPage() {
  const { role } = useAuth()
  const [rows, setRows] = useState<InboxRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showResolved, setShowResolved] = useState(false)
  const [target, setTarget] = useState<InboxRow | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      let q = supabase
        .from('inbox_invalid_phone')
        .select('*, order:orders!inbox_invalid_phone_order_id_fkey(id, order_number, customer_name)')
        .order('created_at', { ascending: false })
        .limit(500)
      if (!showResolved) q = q.eq('resolved', false)
      const { data, error } = await q
      if (error) throw error
      setRows((data || []) as InboxRow[])
    } catch (err) {
      console.warn('Phone inbox load failed:', err)
    } finally {
      setLoading(false)
    }
  }, [showResolved])

  useEffect(() => { load() }, [load])

  if (role && !['owner', 'admin', 'cs'].includes(role)) {
    return (
      <div className="space-y-6">
        <PageHeader icon={Inbox} title="Phone Review" />
        <Card className="border-red-500/20 bg-red-500/5">
          <CardContent className="pt-6 pb-6 text-sm text-red-500">
            Akses dibatasi: hanya owner, admin, atau CS.
          </CardContent>
        </Card>
      </div>
    )
  }

  const unresolvedCount = rows.filter(r => !r.resolved).length

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Phone}
        title="Inbox: Phone Review"
        description="Phone customer yang corrupt dari CSV (scientific notation, terlalu pendek, dll). Re-input nomor yang benar di sini."
        actions={
          <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh
          </Button>
        }
      />

      <Card>
        <CardContent className="pt-4 pb-4 flex items-center gap-4 flex-wrap">
          <Badge variant="outline" className={unresolvedCount > 0 ? 'bg-amber-500/15 text-amber-600' : 'bg-emerald-500/15 text-emerald-600'}>
            {unresolvedCount > 0
              ? <><AlertTriangle className="w-3 h-3 mr-1" />{unresolvedCount} belum di-resolve</>
              : <><CheckCircle2 className="w-3 h-3 mr-1" />Semua sudah di-resolve</>}
          </Badge>
          <label className="flex items-center gap-2 text-sm cursor-pointer ml-auto">
            <Checkbox checked={showResolved} onCheckedChange={v => setShowResolved(v === true)} />
            <span>Tampilkan yang sudah di-resolve</span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Raw Phone</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={6}><div className="h-4 bg-muted animate-pulse rounded" /></TableCell></TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="p-0">
                    <EmptyState
                      icon={CheckCircle2}
                      title={showResolved ? 'Belum ada entry' : 'Semua sudah di-resolve'}
                      description={showResolved ? 'Belum ada phone yang masuk inbox.' : 'Tidak ada phone yang menunggu review.'}
                    />
                  </TableCell>
                </TableRow>
              ) : rows.map(r => (
                <TableRow key={r.id} className={r.resolved ? 'opacity-50' : ''}>
                  <TableCell className="text-xs font-mono">
                    {r.order ? (
                      <Link href={`/orders/${r.order.id}`} className="text-zinc-400 hover:underline">
                        {r.order.order_number}
                      </Link>
                    ) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-xs">{r.order?.customer_name || '—'}</TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground max-w-xs truncate">
                    {r.raw_phone || <span className="italic">—</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-[10px] ${REASON_COLOR[r.reason as PhoneInvalidReason] || ''}`}>
                      {REASON_LABEL[r.reason as PhoneInvalidReason] || r.reason}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatDateTime(r.created_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    {r.resolved
                      ? <Badge variant="outline" className="bg-emerald-500/15 text-emerald-600 text-[10px]">✓ Resolved</Badge>
                      : <Button size="sm" variant="outline" onClick={() => setTarget(r)}>Resolve</Button>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {target && (
        <ResolveDialog
          row={target}
          onClose={() => setTarget(null)}
          onResolved={() => { setTarget(null); load() }}
        />
      )}
    </div>
  )
}

function ResolveDialog({ row, onClose, onResolved }: {
  row: InboxRow; onClose: () => void; onResolved: () => void
}) {
  const [newPhone, setNewPhone] = useState('')
  const [saving, setSaving] = useState(false)

  const validation = newPhone ? normalize_phone_id_safe(newPhone) : null

  const save = async () => {
    if (!validation?.isValid) {
      toast.error('Phone baru tidak valid')
      return
    }
    setSaving(true)
    try {
      const canonical = '0' + validation.phone  // 0xxxxx format
      const { error: ordErr } = await supabase
        .from('orders').update({ customer_phone: canonical }).eq('id', row.order_id)
      if (ordErr) throw ordErr
      const { error: inErr } = await supabase
        .from('inbox_invalid_phone')
        .update({ resolved: true, resolved_at: new Date().toISOString(), resolved_phone: canonical })
        .eq('id', row.id)
      if (inErr) throw inErr
      toast.success('Phone ter-update & inbox resolved')
      onResolved()
    } catch (err) {
      toast.error('Gagal save', { description: getErrorMessage(err) })
    } finally { setSaving(false) }
  }

  const skip = async () => {
    setSaving(true)
    try {
      const { error } = await supabase
        .from('inbox_invalid_phone')
        .update({ resolved: true, resolved_at: new Date().toISOString(), resolved_phone: null })
        .eq('id', row.id)
      if (error) throw error
      toast.success('Entry di-skip')
      onResolved()
    } catch (err) {
      toast.error('Gagal skip', { description: getErrorMessage(err) })
    } finally { setSaving(false) }
  }

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="w-4 h-4" />Resolve Phone — {row.order?.order_number || `order #${row.order_id}`}
          </DialogTitle>
          <DialogDescription>
            Re-input nomor HP yang benar. Format: 08xxx, 628xxx, atau 8xxx (auto-normalize).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Card>
            <CardContent className="pt-3 pb-3 text-xs space-y-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Raw Phone (corrupt)</p>
              <p className="font-mono bg-muted/50 p-2 rounded">{row.raw_phone || <span className="italic">—</span>}</p>
              <Badge variant="outline" className={`text-[10px] ${REASON_COLOR[row.reason as PhoneInvalidReason]}`}>
                {REASON_LABEL[row.reason as PhoneInvalidReason]}
              </Badge>
            </CardContent>
          </Card>

          <div className="space-y-1.5">
            <Label className="text-xs">Phone Baru *</Label>
            <Input
              value={newPhone}
              onChange={e => setNewPhone(e.target.value)}
              placeholder="08123456789"
              autoFocus
            />
            {newPhone && validation && (
              <p className={`text-[10px] ${validation.isValid ? 'text-emerald-600' : 'text-red-500'}`}>
                {validation.isValid
                  ? `✓ Valid → akan disimpan sebagai 0${validation.phone}`
                  : `✗ Invalid: ${validation.reason}`}
              </p>
            )}
            <p className="text-[10px] text-muted-foreground">
              Tip: kalau upload CSV bikin phone corrupt lagi, pakai XLSX format. Excel preserve typing.
            </p>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={skip} disabled={saving}>
            Skip (tanpa update)
          </Button>
          <Button variant="outline" onClick={onClose} disabled={saving}>Batal</Button>
          <Button onClick={save} disabled={saving || !validation?.isValid}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save & Resolve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
