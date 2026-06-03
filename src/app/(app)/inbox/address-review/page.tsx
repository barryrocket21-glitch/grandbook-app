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
import { Textarea } from '@/components/ui/textarea'
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
import { Inbox, MapPin, RefreshCw, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { WilayahAutocomplete } from '@/components/wilayah/wilayah-autocomplete'
import { formatDateTime } from '@/lib/format'
import type { InboxUnparsedAddress, WilayahCandidate } from '@/lib/types'

const supabase = createClient()

type ReasonLabel = Record<string, string>
const REASON_LABEL: ReasonLabel = {
  no_match: 'Tidak ada kandidat match',
  ambiguous: '2+ kecamatan sama-sama kuat — ambigu',
  too_short: 'Address terlalu pendek',
  empty_input: 'Address kosong',
}
const REASON_COLOR: ReasonLabel = {
  no_match: 'bg-red-500/15 text-red-600 border-red-500/30',
  ambiguous: 'bg-amber-500/15 text-amber-600 border-amber-500/30',
  too_short: 'bg-zinc-500/15 text-muted-foreground',
  empty_input: 'bg-zinc-500/15 text-muted-foreground',
}

interface InboxRow extends InboxUnparsedAddress {
  order?: {
    id: number
    order_number: string
    customer_name: string
    customer_phone: string | null
  }
}

export default function AddressReviewPage() {
  const { role } = useAuth()
  const [rows, setRows] = useState<InboxRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showResolved, setShowResolved] = useState(false)
  const [target, setTarget] = useState<InboxRow | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      let query = supabase
        .from('inbox_unparsed_address')
        .select('*, order:orders!inbox_unparsed_address_order_id_fkey(id, order_number, customer_name, customer_phone)')
        .order('created_at', { ascending: false })
        .limit(500)
      if (!showResolved) query = query.eq('resolved', false)
      const { data, error } = await query
      if (error) throw error
      setRows((data || []) as InboxRow[])
    } catch (err) {
      console.warn('Inbox load failed:', err)
    } finally {
      setLoading(false)
    }
  }, [showResolved])

  useEffect(() => { load() }, [load])

  if (role && !['owner', 'admin', 'cs'].includes(role)) {
    return (
      <div className="space-y-6">
        <PageHeader icon={Inbox} title="Address Review" />
        <Card className="border-red-500/20 bg-red-500/5">
          <CardContent className="pt-6 pb-6 text-sm text-red-500">
            Akses dibatasi: hanya owner, admin, atau CS yang bisa resolve alamat.
          </CardContent>
        </Card>
      </div>
    )
  }

  const unresolvedCount = rows.filter(r => !r.resolved).length

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Inbox}
        title="Inbox: Address Review"
        description="Alamat order yang gagal di-parse otomatis. Lengkapi sebelum order bisa di-export ke ekspedisi."
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
                <TableHead>Raw Address</TableHead>
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
                      description={showResolved ? 'Belum ada address yang masuk inbox.' : 'Tidak ada address yang menunggu review.'}
                    />
                  </TableCell>
                </TableRow>
              ) : rows.map(r => (
                <TableRow key={r.id} className={r.resolved ? 'opacity-50' : ''}>
                  <TableCell className="text-xs font-mono">
                    {r.order ? (
                      <Link href={`/orders/${r.order.id}`} className="text-violet-400 hover:underline">
                        {r.order.order_number}
                      </Link>
                    ) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-xs">
                    {r.order?.customer_name || '—'}
                    {r.order?.customer_phone && <span className="block text-[10px] text-muted-foreground font-mono">{r.order.customer_phone}</span>}
                  </TableCell>
                  <TableCell className="text-xs max-w-md">
                    <span className="line-clamp-2">{r.raw_address}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-[10px] ${REASON_COLOR[r.parsing_attempt?.reason_failed || ''] || ''}`}>
                      {REASON_LABEL[r.parsing_attempt?.reason_failed || ''] || r.parsing_attempt?.reason_failed || '?'}
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

// =======================================================================
// Resolve Dialog — load candidates + manual autocomplete + save
// =======================================================================
function ResolveDialog({
  row, onClose, onResolved,
}: { row: InboxRow; onClose: () => void; onResolved: () => void }) {
  const [province, setProvince] = useState('')
  const [city, setCity] = useState('')
  const [subdistrict, setSubdistrict] = useState('')
  const [village, setVillage] = useState('')
  const [zip, setZip] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [skipping, setSkipping] = useState(false)

  const candidates = row.parsing_attempt?.candidates || []
  const keywords = row.parsing_attempt?.extracted_keywords || []

  const applyCandidate = (c: WilayahCandidate) => {
    setProvince(c.province)
    setCity(c.city)
    setSubdistrict(c.subdistrict)
    setVillage(c.village)
    setZip(c.zip)
    toast.success(`Kandidat "${c.subdistrict}" di-apply`)
  }

  const applyFromAutocomplete = (w: WilayahCandidate) => {
    setProvince(w.province)
    setCity(w.city)
    setSubdistrict(w.subdistrict)
    setVillage(w.village)
    setZip(w.zip)
  }

  const save = async () => {
    if (!province || !city || !subdistrict) {
      toast.error('Provinsi, Kota, dan Kecamatan wajib diisi')
      return
    }
    setSaving(true)
    try {
      // Update orders
      const { error: orderErr } = await supabase
        .from('orders')
        .update({
          customer_province: province,
          customer_city: city,
          customer_subdistrict: subdistrict,
          customer_village: village || null,
          customer_zip: zip || null,
        })
        .eq('id', row.order_id)
      if (orderErr) throw orderErr

      // Mark inbox resolved
      const { error: inboxErr } = await supabase
        .from('inbox_unparsed_address')
        .update({
          resolved: true,
          resolved_at: new Date().toISOString(),
          resolution_note: note.trim() || `Manual resolve: ${subdistrict}, ${city}`,
        })
        .eq('id', row.id)
      if (inboxErr) throw inboxErr

      toast.success('Address ter-resolve & order ke-update')
      onResolved()
    } catch (err) {
      toast.error('Gagal save', { description: getErrorMessage(err) })
    } finally {
      setSaving(false)
    }
  }

  const skip = async () => {
    setSkipping(true)
    try {
      const { error } = await supabase
        .from('inbox_unparsed_address')
        .update({
          resolved: true,
          resolved_at: new Date().toISOString(),
          resolution_note: note.trim() || 'Skipped — manual fill nanti',
        })
        .eq('id', row.id)
      if (error) throw error
      toast.success('Entry di-skip')
      onResolved()
    } catch (err) {
      toast.error('Gagal skip', { description: getErrorMessage(err) })
    } finally {
      setSkipping(false)
    }
  }

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="w-4 h-4" />
            Resolve Address — {row.order?.order_number || `order #${row.order_id}`}
          </DialogTitle>
          <DialogDescription>
            Lengkapi alamat. Bisa pilih kandidat auto-suggest, atau search manual via autocomplete.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Raw address + keywords */}
          <Card>
            <CardContent className="pt-3 pb-3 space-y-2 text-xs">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Raw Address</p>
                <p className="whitespace-pre-wrap bg-muted/50 p-2 rounded">{row.raw_address || <span className="italic">—</span>}</p>
              </div>
              {keywords.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Extracted Keywords</p>
                  <div className="flex flex-wrap gap-1">
                    {keywords.map(k => (
                      <Badge key={k} variant="outline" className="text-[10px] font-mono">{k}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Candidate suggestions */}
          {candidates.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Kandidat Auto-Suggest (klik untuk apply)</p>
              <div className="space-y-1">
                {candidates.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => applyCandidate(c)}
                    className="w-full text-left p-2 border rounded text-xs hover:bg-muted/40 flex items-center justify-between gap-2"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">{c.subdistrict} <span className="text-muted-foreground">/ {c.village}</span></p>
                      <p className="text-[10px] text-muted-foreground truncate">{c.city} · {c.province} · <span className="font-mono">{c.zip}</span></p>
                    </div>
                    <Badge variant="outline" className={`text-[9px] shrink-0 ${
                      c.match_score >= 95 ? 'bg-emerald-500/15 text-emerald-600' :
                      c.match_score >= 75 ? 'bg-blue-500/15 text-blue-600' :
                      'bg-zinc-500/15 text-muted-foreground'
                    }`}>
                      score {c.match_score}
                    </Badge>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Manual autocomplete */}
          <div className="space-y-1.5">
            <Label className="text-xs">Atau search manual kecamatan / desa</Label>
            <WilayahAutocomplete onSelect={applyFromAutocomplete} />
          </div>

          {/* Manual form (editable) */}
          <Card>
            <CardContent className="pt-3 pb-3 grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[10px]">Provinsi *</Label>
                <Input value={province} onChange={e => setProvince(e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Kota *</Label>
                <Input value={city} onChange={e => setCity(e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Kecamatan *</Label>
                <Input value={subdistrict} onChange={e => setSubdistrict(e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Kelurahan / Desa</Label>
                <Input value={village} onChange={e => setVillage(e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Kode Pos</Label>
                <Input value={zip} onChange={e => setZip(e.target.value)} className="h-8 text-xs" />
              </div>
            </CardContent>
          </Card>

          <div className="space-y-1.5">
            <Label className="text-xs">Catatan resolusi (opsional)</Label>
            <Textarea value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={500} placeholder="Cth: alamat di-konfirmasi via WA customer" />
          </div>
        </div>

        <DialogFooter className="gap-2 flex-wrap">
          <Button variant="ghost" onClick={skip} disabled={saving || skipping}>
            {skipping && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Skip (resolve tanpa update)
          </Button>
          <Button variant="outline" onClick={onClose} disabled={saving || skipping}>Batal</Button>
          <Button onClick={save} disabled={saving || skipping || !province || !city || !subdistrict}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save & Resolve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
