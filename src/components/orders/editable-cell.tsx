'use client'
import { useState, useEffect, useRef } from 'react'
import { getErrorMessage } from '@/lib/errors'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Loader2, Lock, Pencil, X, Check, Plus } from 'lucide-react'
import { toast } from 'sonner'
import {
  canEditField,
  isFinancialField,
  validateFieldValue,
  type EditableField,
} from '@/lib/schemas/order-update'
import { INTERNAL_STATUSES, STATUS_BADGE_COLOR, STATUS_LABEL } from '@/lib/schemas/settings'
import { ORDER_PRIORITIES } from '@/lib/types'
import { formatRupiah, formatDateTime } from '@/lib/format'
import type { OrderStatus, OrderPriority, OrderEnriched } from '@/lib/types'

const supabase = createClient()

interface Props {
  row: OrderEnriched
  field: EditableField
  /** Custom render untuk display state (non-edit). Kalau gak di-pass, default formatter dipakai */
  renderDisplay?: (value: unknown) => React.ReactNode
  /** Notify parent agar row di-refresh / state lokal di-update */
  onUpdated: () => void
}

/**
 * Phase 8E — Cell inline-editable.
 *
 * Behavior:
 * - Read-only render kalau role tidak boleh edit field
 * - Hover → tampilkan pencil icon → klik switch ke edit mode
 * - Financial field (subtotal/shipping_cost/discount/total) → confirm modal sebelum save
 * - Save success → toast + notify parent
 * - DB error (RLS, trigger block) → tampilkan error toast yang readable
 */
export function EditableCell({ row, field, renderDisplay, onUpdated }: Props) {
  const { role } = useAuth()
  const canEdit = canEditField(role, field)
  const isFinancial = isFinancialField(field)
  const currentValue = (row as unknown as Record<string, unknown>)[field]

  // Read-only render
  if (!canEdit) {
    return (
      <ReadOnlyCell
        field={field}
        value={currentValue}
        renderDisplay={renderDisplay}
        showLock={isFinancial}
      />
    )
  }

  // Choose editor by field
  switch (field) {
    case 'status':
      return <StatusEditor row={row} onUpdated={onUpdated} renderDisplay={renderDisplay} />
    case 'priority':
      return <PriorityEditor row={row} onUpdated={onUpdated} renderDisplay={renderDisplay} />
    case 'tags':
      return <TagsEditor row={row} onUpdated={onUpdated} renderDisplay={renderDisplay} />
    case 'internal_note':
    case 'customer_note':
      return <TextareaPopoverEditor row={row} field={field} onUpdated={onUpdated} renderDisplay={renderDisplay} />
    case 'last_contact_at':
      return <DateTimeEditor row={row} field={field} onUpdated={onUpdated} renderDisplay={renderDisplay} />
    case 'cs_attempts':
      return <NumberEditor row={row} field={field} onUpdated={onUpdated} renderDisplay={renderDisplay} integer />
    case 'subtotal':
    case 'shipping_cost':
    case 'discount':
    case 'total':
      return <FinancialEditor row={row} field={field} onUpdated={onUpdated} renderDisplay={renderDisplay} />
    case 'resi':
    case 'customer_phone':
    case 'customer_city':
    case 'customer_province':
    case 'reject_reason':
    default:
      return <TextEditor row={row} field={field} onUpdated={onUpdated} renderDisplay={renderDisplay} />
  }
}

// =======================================================================
// Helpers
// =======================================================================

async function saveField(rowId: number, field: EditableField, value: unknown): Promise<void> {
  // Validate via Zod
  const parsed = validateFieldValue(field, value)
  const { error } = await supabase
    .from('orders')
    .update({ [field]: parsed })
    .eq('id', rowId)
  if (error) {
    // Trigger error (admin direct edit actual / payout) di-raise sebagai P0001/exception
    throw new Error(error.message || 'Save failed')
  }
}

function defaultRender(field: EditableField, value: unknown): React.ReactNode {
  if (value === null || value === undefined || value === '') {
    return <span className="text-muted-foreground italic">—</span>
  }
  if (field === 'status') {
    const s = value as OrderStatus
    return (
      <Badge variant="outline" className={STATUS_BADGE_COLOR[s] || ''}>
        {STATUS_LABEL[s] || s}
      </Badge>
    )
  }
  if (field === 'priority') {
    const p = ORDER_PRIORITIES.find(x => x.value === value)
    return p ? <Badge variant="outline" className={p.color}>{p.label}</Badge> : String(value)
  }
  if (field === 'tags') {
    const tags = (value as string[]) || []
    if (tags.length === 0) return <span className="text-muted-foreground italic">—</span>
    return (
      <div className="flex flex-wrap gap-1">
        {tags.slice(0, 3).map(t => (
          <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
        ))}
        {tags.length > 3 && <span className="text-[10px] text-muted-foreground">+{tags.length - 3}</span>}
      </div>
    )
  }
  if (field === 'subtotal' || field === 'shipping_cost' || field === 'discount' || field === 'total') {
    return <span className="tabular-nums">{formatRupiah(Number(value) || 0)}</span>
  }
  if (field === 'last_contact_at') {
    return <span className="text-xs">{formatDateTime(String(value))}</span>
  }
  if (field === 'cs_attempts') {
    return <span className="tabular-nums">{Number(value)}</span>
  }
  // Phase 8I-Followup hotfix: resi pakai font-mono (SPXID + 12 digit terbaca
  // lebih konsisten + uniform char width bantu truncate menempatkan ellipsis).
  if (field === 'resi') {
    return <span className="font-mono whitespace-nowrap">{String(value)}</span>
  }
  if (typeof value === 'string' && value.length > 60) {
    return <span className="line-clamp-1">{value}</span>
  }
  return <span>{String(value)}</span>
}

function ReadOnlyCell({ field, value, renderDisplay, showLock }: {
  field: EditableField
  value: unknown
  renderDisplay?: (v: unknown) => React.ReactNode
  showLock: boolean
}) {
  return (
    <div className="flex items-center gap-1 text-xs">
      {renderDisplay ? renderDisplay(value) : defaultRender(field, value)}
      {showLock && (
        <Lock className="w-3 h-3 text-muted-foreground/50 ml-auto shrink-0" />
      )}
    </div>
  )
}

interface EditorBaseProps {
  row: OrderEnriched
  field: EditableField
  onUpdated: () => void
  renderDisplay?: (v: unknown) => React.ReactNode
}

// =======================================================================
// Status editor
// =======================================================================
function StatusEditor({ row, onUpdated, renderDisplay }: Omit<EditorBaseProps, 'field'>) {
  const [saving, setSaving] = useState(false)
  const handleChange = async (v: string | null) => {
    if (!v || v === row.status) return
    setSaving(true)
    try {
      await saveField(row.id, 'status', v)
      toast.success(`Status → ${STATUS_LABEL[v as OrderStatus] || v}`)
      onUpdated()
    } catch (err) {
      toast.error('Gagal update status', { description: getErrorMessage(err) })
    } finally { setSaving(false) }
  }
  return (
    <Select value={row.status} onValueChange={handleChange} disabled={saving}>
      <SelectTrigger className="h-7 w-full text-xs border-transparent hover:border-border focus:border-zinc-500/50 px-2">
        <SelectValue>
          {() => renderDisplay ? renderDisplay(row.status) : defaultRender('status', row.status)}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {INTERNAL_STATUSES.map(s => (
          <SelectItem key={s} value={s}>
            <Badge variant="outline" className={STATUS_BADGE_COLOR[s]}>{STATUS_LABEL[s]}</Badge>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// =======================================================================
// Priority editor
// =======================================================================
function PriorityEditor({ row, onUpdated, renderDisplay }: Omit<EditorBaseProps, 'field'>) {
  const [saving, setSaving] = useState(false)
  const handleChange = async (v: string | null) => {
    if (!v || v === row.priority) return
    setSaving(true)
    try {
      await saveField(row.id, 'priority', v as OrderPriority)
      toast.success(`Prioritas → ${v}`)
      onUpdated()
    } catch (err) {
      toast.error('Gagal update prioritas', { description: getErrorMessage(err) })
    } finally { setSaving(false) }
  }
  return (
    <Select value={row.priority} onValueChange={handleChange} disabled={saving}>
      <SelectTrigger className="h-7 w-full text-xs border-transparent hover:border-border focus:border-zinc-500/50 px-2">
        <SelectValue>
          {() => renderDisplay ? renderDisplay(row.priority) : defaultRender('priority', row.priority)}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {ORDER_PRIORITIES.map(p => (
          <SelectItem key={p.value} value={p.value}>
            <Badge variant="outline" className={p.color}>{p.label}</Badge>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// =======================================================================
// Text editor (single-line)
// =======================================================================
function TextEditor({ row, field, onUpdated, renderDisplay }: EditorBaseProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const currentValue = (row as unknown as Record<string, unknown>)[field]

  useEffect(() => {
    if (editing) {
      setDraft((currentValue as string) ?? '')
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [editing, currentValue])

  const save = async () => {
    setSaving(true)
    try {
      await saveField(row.id, field, draft.trim() || null)
      toast.success('Tersimpan')
      setEditing(false)
      onUpdated()
    } catch (err) {
      toast.error('Gagal simpan', { description: getErrorMessage(err) })
    } finally { setSaving(false) }
  }

  if (!editing) {
    const tooltip = typeof currentValue === 'string' && currentValue.trim() !== '' ? currentValue : undefined
    return (
      <div
        className="group flex items-center gap-1 cursor-pointer hover:bg-muted/40 rounded px-1 py-0.5 -mx-1 -my-0.5 min-h-[24px] min-w-0"
        onClick={() => setEditing(true)}
        title={tooltip}
      >
        {/* Phase 8I-Followup hotfix: min-w-0 + truncate biar flex item bisa shrink
            di bawah content size + ellipsis kalau overflow (mis. resi SPX 17 char
            atau kota panjang seperti KAB. PENAJAM PASER UTARA). */}
        <div className="flex-1 min-w-0 truncate text-xs">
          {renderDisplay ? renderDisplay(currentValue) : defaultRender(field, currentValue)}
        </div>
        <Pencil className="w-3 h-3 text-muted-foreground/50 opacity-0 group-hover:opacity-100 shrink-0" />
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <Input
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') save()
          if (e.key === 'Escape') setEditing(false)
        }}
        className="h-7 text-xs"
        disabled={saving}
      />
      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={save} disabled={saving}>
        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3 text-emerald-500" />}
      </Button>
      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(false)} disabled={saving}>
        <X className="w-3 h-3" />
      </Button>
    </div>
  )
}

// =======================================================================
// Number editor
// =======================================================================
function NumberEditor({ row, field, onUpdated, renderDisplay, integer = false }: EditorBaseProps & { integer?: boolean }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const currentValue = (row as unknown as Record<string, unknown>)[field]

  useEffect(() => {
    if (editing) {
      setDraft(String(currentValue ?? ''))
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [editing, currentValue])

  const save = async () => {
    setSaving(true)
    try {
      const num = integer ? parseInt(draft, 10) : parseFloat(draft)
      if (Number.isNaN(num)) throw new Error('Bukan angka valid')
      await saveField(row.id, field, num)
      toast.success('Tersimpan')
      setEditing(false)
      onUpdated()
    } catch (err) {
      toast.error('Gagal simpan', { description: getErrorMessage(err) })
    } finally { setSaving(false) }
  }

  if (!editing) {
    return (
      <div
        className="group flex items-center gap-1 cursor-pointer hover:bg-muted/40 rounded px-1 py-0.5 -mx-1 -my-0.5 min-h-[24px] justify-end min-w-0"
        onClick={() => setEditing(true)}
      >
        {/* Phase 8I-Followup hotfix: whitespace-nowrap supaya rupiah ga wrap line. */}
        <div className="flex-1 min-w-0 text-xs text-right whitespace-nowrap">
          {renderDisplay ? renderDisplay(currentValue) : defaultRender(field, currentValue)}
        </div>
        <Pencil className="w-3 h-3 text-muted-foreground/50 opacity-0 group-hover:opacity-100 shrink-0" />
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <Input
        ref={inputRef}
        type="number"
        step={integer ? 1 : 'any'}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') save()
          if (e.key === 'Escape') setEditing(false)
        }}
        className="h-7 text-xs"
        disabled={saving}
      />
      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={save} disabled={saving}>
        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3 text-emerald-500" />}
      </Button>
      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(false)} disabled={saving}>
        <X className="w-3 h-3" />
      </Button>
    </div>
  )
}

// =======================================================================
// Financial editor (number + confirm modal)
// =======================================================================
function FinancialEditor({ row, field, onUpdated, renderDisplay }: EditorBaseProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const currentValue = (row as unknown as Record<string, number>)[field] ?? 0

  const openEdit = () => {
    setDraft(String(currentValue))
    setOpen(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      const num = parseFloat(draft)
      if (Number.isNaN(num) || num < 0) throw new Error('Nilai harus angka >= 0')
      await saveField(row.id, field, num)
      toast.success('Tersimpan. Owner akan dapat notifikasi.')
      setOpen(false)
      onUpdated()
    } catch (err) {
      toast.error('Gagal simpan', { description: getErrorMessage(err) })
    } finally { setSaving(false) }
  }

  return (
    <>
      <div
        className="group flex items-center gap-1 cursor-pointer hover:bg-amber-500/10 rounded px-1 py-0.5 -mx-1 -my-0.5 min-h-[24px] justify-end min-w-0 pl-3"
        onClick={openEdit}
      >
        {/* Phase 8I-Followup hotfix: pl-3 untuk gap dari kolom kiri (mis. KOTA),
            whitespace-nowrap supaya format rupiah (Rp 196.350) ga wrap line. */}
        <div className="flex-1 min-w-0 text-xs text-right whitespace-nowrap">
          {renderDisplay ? renderDisplay(currentValue) : defaultRender(field, currentValue)}
        </div>
        <Pencil className="w-3 h-3 text-amber-600/70 opacity-0 group-hover:opacity-100 shrink-0" />
      </div>

      <Dialog open={open} onOpenChange={v => !v && setOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <Pencil className="w-4 h-4" />
              Ubah {fieldLabel(field)}
            </DialogTitle>
            <DialogDescription>
              Anda akan mengubah <strong>{fieldLabel(field)}</strong> order <span className="font-mono">{row.order_number}</span>.
              Perubahan tercatat di audit log dan owner akan menerima notifikasi.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Sebelum</Label>
                <p className="text-sm font-mono mt-1 text-muted-foreground line-through">
                  {formatRupiah(currentValue)}
                </p>
              </div>
              <div>
                <Label className="text-xs">Sesudah</Label>
                <Input
                  type="number"
                  min={0}
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  className="mt-1"
                  autoFocus
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  {!Number.isNaN(parseFloat(draft)) && `= ${formatRupiah(parseFloat(draft))}`}
                </p>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Batal</Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Konfirmasi & Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// =======================================================================
// Textarea popover editor
// =======================================================================
function TextareaPopoverEditor({ row, field, onUpdated, renderDisplay }: EditorBaseProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const currentValue = (row as unknown as Record<string, unknown>)[field]

  useEffect(() => {
    if (open) setDraft((currentValue as string) ?? '')
  }, [open, currentValue])

  const save = async () => {
    setSaving(true)
    try {
      await saveField(row.id, field, draft.trim() || null)
      toast.success('Tersimpan')
      setOpen(false)
      onUpdated()
    } catch (err) {
      toast.error('Gagal simpan', { description: getErrorMessage(err) })
    } finally { setSaving(false) }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={
        <div className="group flex items-center gap-1 cursor-pointer hover:bg-muted/40 rounded px-1 py-0.5 -mx-1 -my-0.5 min-h-[24px]">
          <div className="flex-1 text-xs">
            {renderDisplay ? renderDisplay(currentValue) : defaultRender(field, currentValue)}
          </div>
          <Pencil className="w-3 h-3 text-muted-foreground/50 opacity-0 group-hover:opacity-100 shrink-0" />
        </div>
      } />
      <PopoverContent className="w-80 space-y-2">
        <Label className="text-xs">{fieldLabel(field)}</Label>
        <Textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          rows={4}
          maxLength={2000}
          placeholder="Tulis catatan..."
        />
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setOpen(false)} disabled={saving}>Batal</Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}Simpan
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// =======================================================================
// Tags editor (multi-select chip)
// =======================================================================
function TagsEditor({ row, onUpdated, renderDisplay }: Omit<EditorBaseProps, 'field'>) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<string[]>([])
  const [newTag, setNewTag] = useState('')
  const [saving, setSaving] = useState(false)
  const currentTags = row.tags || []

  useEffect(() => {
    if (open) setDraft(currentTags)
  }, [open, row.tags]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setSaving(true)
    try {
      await saveField(row.id, 'tags', draft)
      toast.success('Tags tersimpan')
      setOpen(false)
      onUpdated()
    } catch (err) {
      toast.error('Gagal simpan', { description: getErrorMessage(err) })
    } finally { setSaving(false) }
  }

  const addTag = () => {
    const t = newTag.trim()
    if (!t) return
    if (draft.includes(t)) return
    if (draft.length >= 20) return
    setDraft([...draft, t])
    setNewTag('')
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={
        <div className="group flex items-center gap-1 cursor-pointer hover:bg-muted/40 rounded px-1 py-0.5 -mx-1 -my-0.5 min-h-[24px]">
          <div className="flex-1 text-xs">
            {renderDisplay ? renderDisplay(currentTags) : defaultRender('tags', currentTags)}
          </div>
          <Pencil className="w-3 h-3 text-muted-foreground/50 opacity-0 group-hover:opacity-100 shrink-0" />
        </div>
      } />
      <PopoverContent className="w-72 space-y-2">
        <Label className="text-xs">Tags</Label>
        <div className="flex flex-wrap gap-1 min-h-[28px] p-1 border rounded">
          {draft.length === 0 && <span className="text-xs text-muted-foreground italic px-1">Belum ada tag</span>}
          {draft.map(t => (
            <Badge key={t} variant="outline" className="gap-1 cursor-pointer" onClick={() => setDraft(draft.filter(x => x !== t))}>
              {t}
              <X className="w-3 h-3" />
            </Badge>
          ))}
        </div>
        <div className="flex gap-1">
          <Input
            value={newTag}
            onChange={e => setNewTag(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
            placeholder="Tambah tag..."
            maxLength={40}
            className="h-8 text-xs"
          />
          <Button size="icon" variant="outline" className="h-8 w-8" onClick={addTag}>
            <Plus className="w-3 h-3" />
          </Button>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button size="sm" variant="outline" onClick={() => setOpen(false)} disabled={saving}>Batal</Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}Simpan
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// =======================================================================
// DateTime editor (datetime-local)
// =======================================================================
function DateTimeEditor({ row, field, onUpdated, renderDisplay }: EditorBaseProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const currentValue = (row as unknown as Record<string, unknown>)[field] as string | null

  useEffect(() => {
    if (editing) {
      setDraft(currentValue ? toDatetimeLocal(currentValue) : '')
    }
  }, [editing, currentValue])

  const save = async () => {
    setSaving(true)
    try {
      const iso = draft ? new Date(draft).toISOString() : null
      await saveField(row.id, field, iso)
      toast.success('Tersimpan')
      setEditing(false)
      onUpdated()
    } catch (err) {
      toast.error('Gagal simpan', { description: getErrorMessage(err) })
    } finally { setSaving(false) }
  }

  if (!editing) {
    const tooltip = typeof currentValue === 'string' && currentValue.trim() !== '' ? currentValue : undefined
    return (
      <div
        className="group flex items-center gap-1 cursor-pointer hover:bg-muted/40 rounded px-1 py-0.5 -mx-1 -my-0.5 min-h-[24px] min-w-0"
        onClick={() => setEditing(true)}
        title={tooltip}
      >
        {/* Phase 8I-Followup hotfix: min-w-0 + truncate biar flex item bisa shrink
            di bawah content size + ellipsis kalau overflow (mis. resi SPX 17 char
            atau kota panjang seperti KAB. PENAJAM PASER UTARA). */}
        <div className="flex-1 min-w-0 truncate text-xs">
          {renderDisplay ? renderDisplay(currentValue) : defaultRender(field, currentValue)}
        </div>
        <Pencil className="w-3 h-3 text-muted-foreground/50 opacity-0 group-hover:opacity-100 shrink-0" />
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <Input
        type="datetime-local"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        className="h-7 text-xs"
        disabled={saving}
      />
      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={save} disabled={saving}>
        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3 text-emerald-500" />}
      </Button>
      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(false)} disabled={saving}>
        <X className="w-3 h-3" />
      </Button>
    </div>
  )
}

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fieldLabel(field: EditableField): string {
  const map: Partial<Record<EditableField, string>> = {
    status: 'Status', priority: 'Prioritas', resi: 'Resi',
    internal_note: 'Catatan Internal', customer_note: 'Catatan Customer',
    reject_reason: 'Alasan Reject', tags: 'Tags', cs_attempts: 'CS Attempts',
    last_contact_at: 'Kontak Terakhir', customer_phone: 'No HP',
    customer_city: 'Kota', customer_province: 'Provinsi',
    subtotal: 'Subtotal', shipping_cost: 'Ongkir', discount: 'Diskon', total: 'Total',
  }
  return map[field] || field
}
