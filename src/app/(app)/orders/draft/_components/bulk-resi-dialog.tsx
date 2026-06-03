'use client'
import { useState } from 'react'
import { getErrorMessage } from '@/lib/errors'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Truck, Loader2, CheckCircle2, AlertTriangle, FileText, ArrowRight,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

const supabase = createClient()

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  onApplied: () => void
}

type RowState = 'matched' | 'unmatched' | 'duplicate_resi' | 'invalid' | 'cancelled'

interface ParsedRow {
  lineNo: number
  order_number: string
  resi: string
  state: RowState
  draft_id?: number
  customer_name?: string
  current_resi?: string
  message?: string
}

interface ApplyResult {
  applied: number
  errors: { lineNo: number; reason: string }[]
}

/**
 * Bulk Set Resi dialog. CS/admin/owner paste list "order_number,resi"
 * (CSV/TSV) dari export ekspedisi → engine match drafts → batch UPDATE resi
 * → trigger promote_draft_to_orders auto-graduate ke arsip.
 */
export function BulkResiDialog({ open, onOpenChange, onApplied }: Props) {
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<ParsedRow[] | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState<ApplyResult | null>(null)

  const reset = () => {
    setText('')
    setParsed(null)
    setResult(null)
  }

  const handlePreview = async () => {
    setPreviewLoading(true)
    try {
      // Parse text — comma OR tab separated, ignore empty/whitespace lines
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0)
      if (lines.length === 0) {
        toast.error('Paste minimal 1 baris "order_number,resi"')
        return
      }
      const rawPairs: { lineNo: number; order_number: string; resi: string }[] = []
      const seenResi = new Set<string>()
      const dupResiLines = new Set<number>()
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const lineNo = i + 1
        // Split by tab OR comma (first occurrence)
        const sepMatch = line.match(/[\t,]/)
        if (!sepMatch) {
          rawPairs.push({ lineNo, order_number: '', resi: line })
          continue
        }
        const sepIdx = line.indexOf(sepMatch[0])
        const order_number = line.substring(0, sepIdx).trim()
        const resi = line.substring(sepIdx + 1).trim()
        // Detect dup resi within paste itself
        if (resi && seenResi.has(resi)) dupResiLines.add(lineNo)
        if (resi) seenResi.add(resi)
        rawPairs.push({ lineNo, order_number, resi })
      }

      // Fetch all matching drafts in one query
      const orderNumbers = rawPairs.map(p => p.order_number).filter(Boolean)
      const { data: drafts, error } = await supabase
        .from('orders_draft')
        .select('id, order_number, customer_name, resi, status')
        .in('order_number', orderNumbers)
      if (error) throw error
      const draftMap = new Map<string, { id: number; customer_name: string; resi: string | null; status: string }>(
        (drafts || []).map((d: { id: number; order_number: string; customer_name: string; resi: string | null; status: string }) =>
          [d.order_number, { id: d.id, customer_name: d.customer_name, resi: d.resi, status: d.status }]
        )
      )

      // Also check orders archive — resi sudah terpakai di sana?
      const resiList = rawPairs.map(p => p.resi).filter(Boolean)
      const { data: existingResis } = await supabase
        .from('orders')
        .select('resi')
        .in('resi', resiList)
      const existingResiSet = new Set<string>((existingResis || []).map((r: { resi: string }) => r.resi))

      // Categorize
      const out: ParsedRow[] = rawPairs.map(p => {
        if (!p.order_number || !p.resi) {
          return {
            ...p,
            state: 'invalid',
            message: !p.order_number ? 'order_number kosong' : 'resi kosong',
          }
        }
        if (dupResiLines.has(p.lineNo)) {
          return { ...p, state: 'duplicate_resi', message: 'Resi double di paste ini' }
        }
        if (existingResiSet.has(p.resi)) {
          return { ...p, state: 'duplicate_resi', message: 'Resi sudah terpakai di Arsip' }
        }
        const draft = draftMap.get(p.order_number)
        if (!draft) {
          return { ...p, state: 'unmatched', message: 'Order tidak ditemukan di Antrian Kerja' }
        }
        if (draft.status === 'CANCEL') {
          return { ...p, state: 'cancelled', message: 'Order status CANCEL — tidak bisa diberi resi', draft_id: draft.id, customer_name: draft.customer_name }
        }
        return {
          ...p,
          state: 'matched',
          draft_id: draft.id,
          customer_name: draft.customer_name,
          current_resi: draft.resi || undefined,
        }
      })
      setParsed(out)
    } catch (err) {
      const msg = getErrorMessage(err)
      toast.error('Gagal preview', { description: msg })
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleApply = async () => {
    if (!parsed) return
    const matchedRows = parsed.filter(p => p.state === 'matched')
    if (matchedRows.length === 0) {
      toast.error('Tidak ada row yang siap di-apply')
      return
    }
    setApplying(true)
    try {
      // Apply per row — trigger DB akan handle promote per UPDATE
      // (bulk UPDATE WHERE id IN (...) tidak bisa karena resi value per row beda)
      const errors: { lineNo: number; reason: string }[] = []
      let applied = 0
      for (const r of matchedRows) {
        try {
          const { error } = await supabase
            .from('orders_draft')
            .update({ resi: r.resi })
            .eq('id', r.draft_id!)
          if (error) {
            errors.push({ lineNo: r.lineNo, reason: error.message })
          } else {
            applied++
          }
        } catch (err) {
          errors.push({ lineNo: r.lineNo, reason: getErrorMessage(err) })
        }
      }
      setResult({ applied, errors })
      if (applied > 0) {
        toast.success(`${applied} order pindah ke Arsip`, {
          description: `Trigger auto-promote fired untuk ${applied} draft.`,
        })
      }
      if (errors.length > 0) {
        toast.error(`${errors.length} row gagal di-apply`)
      }
      onApplied()
    } catch (err) {
      const msg = getErrorMessage(err)
      toast.error('Gagal apply bulk', { description: msg })
    } finally {
      setApplying(false)
    }
  }

  const stateCounts = parsed ? {
    matched: parsed.filter(p => p.state === 'matched').length,
    unmatched: parsed.filter(p => p.state === 'unmatched').length,
    duplicate: parsed.filter(p => p.state === 'duplicate_resi').length,
    invalid: parsed.filter(p => p.state === 'invalid').length,
    cancelled: parsed.filter(p => p.state === 'cancelled').length,
  } : null

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v) }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="w-4 h-4 text-emerald-500" />
            Set Resi Massal
          </DialogTitle>
          <DialogDescription>
            Paste list <code>order_number,resi</code> dari export ekspedisi. Format: 1 baris per order, dipisah koma atau tab. Order yang matched akan otomatis pindah ke Arsip (trigger promote).
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3">
            <Card className="border-emerald-500/30">
              <CardContent className="pt-4 pb-4 space-y-2 text-center">
                <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
                <div className="text-2xl font-bold">{result.applied}</div>
                <div className="text-sm text-muted-foreground">order pindah ke Arsip</div>
              </CardContent>
            </Card>
            {result.errors.length > 0 && (
              <div className="rounded-md bg-red-500/5 border border-red-500/20 p-3 text-xs space-y-1">
                <div className="font-semibold text-red-600">{result.errors.length} error:</div>
                {result.errors.slice(0, 10).map((e, i) => (
                  <div key={i}>Line {e.lineNo}: {e.reason}</div>
                ))}
              </div>
            )}
          </div>
        ) : !parsed ? (
          <div className="space-y-2">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              placeholder={`Paste dari Excel/CSV ekspedisi:

GB-20260520-000141,SPXID123456789012
GB-20260520-000142,SPXID234567890123
GB-20260520-000143,SPXID345678901234

Boleh juga tab-separated (langsung paste 2 kolom dari Excel).`}
              className="font-mono text-xs"
            />
            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
              <FileText className="w-3 h-3" />
              {text.split(/\r?\n/).filter(l => l.trim().length > 0).length} baris akan di-parse
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-5 gap-2 text-xs">
              <div className="rounded p-2 bg-emerald-500/10 border border-emerald-500/30 text-center">
                <div className="text-lg font-bold text-emerald-700 dark:text-emerald-400">{stateCounts!.matched}</div>
                <div className="text-[10px] text-muted-foreground">Matched</div>
              </div>
              <div className="rounded p-2 bg-amber-500/10 border border-amber-500/30 text-center">
                <div className="text-lg font-bold text-amber-700 dark:text-amber-400">{stateCounts!.unmatched}</div>
                <div className="text-[10px] text-muted-foreground">Unmatched</div>
              </div>
              <div className="rounded p-2 bg-red-500/10 border border-red-500/30 text-center">
                <div className="text-lg font-bold text-red-700 dark:text-red-400">{stateCounts!.duplicate}</div>
                <div className="text-[10px] text-muted-foreground">Dup Resi</div>
              </div>
              <div className="rounded p-2 bg-zinc-500/10 border border-zinc-500/30 text-center">
                <div className="text-lg font-bold">{stateCounts!.cancelled}</div>
                <div className="text-[10px] text-muted-foreground">Cancel</div>
              </div>
              <div className="rounded p-2 bg-zinc-500/10 border border-zinc-500/30 text-center">
                <div className="text-lg font-bold">{stateCounts!.invalid}</div>
                <div className="text-[10px] text-muted-foreground">Invalid</div>
              </div>
            </div>

            <div className="rounded-md border max-h-72 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/40">
                  <tr>
                    <th className="text-left p-2 w-12">#</th>
                    <th className="text-left p-2">Order#</th>
                    <th className="text-left p-2">Resi</th>
                    <th className="text-left p-2">Customer</th>
                    <th className="text-center p-2 w-24">State</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.map((p) => (
                    <tr key={p.lineNo} className={`border-t ${p.state === 'matched' ? '' : 'bg-muted/20'}`}>
                      <td className="p-2 text-muted-foreground">{p.lineNo}</td>
                      <td className="p-2 font-mono">{p.order_number || <span className="italic text-muted-foreground">—</span>}</td>
                      <td className="p-2 font-mono truncate max-w-[120px]" title={p.resi}>{p.resi || <span className="italic text-muted-foreground">—</span>}</td>
                      <td className="p-2 truncate max-w-[140px]" title={p.customer_name}>{p.customer_name || <span className="text-muted-foreground italic">—</span>}</td>
                      <td className="p-2 text-center">
                        {p.state === 'matched' && <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-[10px]">OK</Badge>}
                        {p.state === 'unmatched' && <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30 text-[10px]" title={p.message}>Unmatched</Badge>}
                        {p.state === 'duplicate_resi' && <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/30 text-[10px]" title={p.message}>Dup</Badge>}
                        {p.state === 'invalid' && <Badge variant="outline" className="text-[10px]" title={p.message}>Invalid</Badge>}
                        {p.state === 'cancelled' && <Badge variant="outline" className="text-[10px]" title={p.message}>Cancel</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button onClick={() => { reset(); onOpenChange(false) }} className="w-full">Selesai</Button>
          ) : !parsed ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
              <Button onClick={handlePreview} disabled={previewLoading || !text.trim()} className="gap-2">
                {previewLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Preview Match
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setParsed(null)} disabled={applying}>Edit Paste</Button>
              <Button
                onClick={handleApply}
                disabled={applying || stateCounts!.matched === 0}
                className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
              >
                {applying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Apply {stateCounts!.matched} order ke Arsip
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
