'use client'
import { useState } from 'react'
import { getErrorMessage } from '@/lib/errors'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Banknote, Loader2, Upload, CheckCircle2, AlertTriangle, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { formatRupiah } from '@/lib/format'

const supabase = createClient()

interface PayoutRow { ref: string; payout_amount: number | null; fee: number | null; net_received: number | null; withdrawal_date: string | null }
interface Parsed { rows: PayoutRow[]; fileName: string; fileSize: number }
interface Preview { batch_id: number; matched: number; variance: number; unmatched: number; total_payout: number }
interface ApplyRes { settled: number; commissions_paid: number; unmatched_inbox: number; payout_total: number; net_received: number }

function num(v: unknown): number | null {
  if (v == null) return null
  const s = String(v).trim(); if (s === '' || s === '-') return null
  const n = Number(s.replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : null
}
// Brief #17 — payout/pencairan SPX: cocokin GB-/resi → set CAIR + komisi PAID.
function parsePayout(buf: ArrayBuffer, fileName: string, fileSize: number): Parsed {
  const wb = XLSX.read(buf, { type: 'array' })
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null })
  let hi = -1
  for (let i = 0; i < Math.min(aoa.length, 8); i++) {
    if ((aoa[i] || []).some((c) => /reference|resi|tracking|order|pesanan/i.test(String(c ?? '')))) { hi = i; break }
  }
  if (hi < 0) throw new Error('Header gak ketemu — butuh kolom Reference/Resi/Order.')
  const hdr = (aoa[hi] as unknown[]).map((h) => String(h ?? '').trim().toLowerCase())
  const col = (re: RegExp) => hdr.findIndex((h) => re.test(h))
  const iRef = col(/reference|resi|tracking|order|pesanan/)
  const iPay = col(/payout|pencairan|escrow|amount|jumlah/)
  const iFee = col(/fee|biaya|admin/)
  const iNet = col(/net|diterima|bersih/)
  const iDate = col(/date|tanggal|waktu|time/)
  const rows: PayoutRow[] = []
  for (let i = hi + 1; i < aoa.length; i++) {
    const r = aoa[i] as unknown[]
    if (!r || r.every((c) => c == null || String(c).trim() === '')) continue
    const ref = iRef >= 0 ? String(r[iRef] ?? '').trim() : ''
    if (!ref) continue
    rows.push({
      ref,
      payout_amount: iPay >= 0 ? num(r[iPay]) : null,
      fee: iFee >= 0 ? num(r[iFee]) : null,
      net_received: iNet >= 0 ? num(r[iNet]) : null,
      withdrawal_date: iDate >= 0 && r[iDate] ? String(r[iDate]).trim() : null,
    })
  }
  return { rows, fileName, fileSize }
}

export function PayoutReconSection() {
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [result, setResult] = useState<ApplyRes | null>(null)
  const [busy, setBusy] = useState(false)

  const onFile = async (file: File) => {
    setBusy(true); setPreview(null); setResult(null); setParsed(null)
    try {
      const p = parsePayout(await file.arrayBuffer(), file.name, file.size)
      setParsed(p)
      const { data, error } = await supabase.rpc('preview_payout_recon', {
        p_rows: p.rows, p_file_name: p.fileName, p_file_size: p.fileSize,
      })
      if (error) throw error
      setPreview(data as Preview)
    } catch (err) { toast.error('Gagal baca/preview', { description: getErrorMessage(err) }) }
    finally { setBusy(false) }
  }

  const apply = async () => {
    if (!preview) return
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('apply_payout_recon', { p_batch_id: preview.batch_id })
      if (error) throw error
      setResult(data as ApplyRes)
      const d = data as ApplyRes
      toast.success(`Cair diterapkan: ${d.settled} order, ${d.commissions_paid} komisi PAID`)
    } catch (err) { toast.error('Gagal apply', { description: getErrorMessage(err) }) }
    finally { setBusy(false) }
  }

  const reset = () => { setParsed(null); setPreview(null); setResult(null) }

  return (
    <Card className="border-emerald-500/30 bg-emerald-500/5">
      <CardContent className="pt-5 pb-5 space-y-3">
        <div className="flex items-center gap-2">
          <Banknote className="w-4 h-4 text-emerald-600" />
          <h3 className="text-sm font-semibold">Payout / Pencairan SPX (set CAIR → komisi PAID)</h3>
        </div>
        <p className="text-[11px] text-muted-foreground">Upload file pencairan SPX (xlsx) → cocokin GB-/resi → preview → apply: set <b>cod_settled_at</b> + payout, flip komisi <b>EARNED→PAID</b>. No-match → inbox. Idempotent.</p>

        {!parsed ? (
          <div className="space-y-2">
            <Input type="file" accept=".xlsx,.xls" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
            {busy && <div className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Memproses…</div>}
          </div>
        ) : result ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-emerald-500" /><span className="font-semibold text-sm">Pencairan diterapkan</span></div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <Stat label="Order cair" v={String(result.settled)} />
              <Stat label="Komisi PAID" v={String(result.commissions_paid)} />
              <Stat label="Net diterima" v={formatRupiah(result.net_received)} />
              <Stat label="No-match → inbox" v={String(result.unmatched_inbox)} />
            </div>
            <Button variant="outline" size="sm" onClick={reset}>Upload lagi</Button>
          </div>
        ) : preview ? (
          <div className="space-y-2">
            <div className="text-xs flex items-center gap-2 flex-wrap">
              <Badge variant="outline">{parsed.fileName}</Badge>
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600">match {preview.matched}</Badge>
              <Badge variant="outline" className="bg-amber-500/10 text-amber-600">variance {preview.variance}</Badge>
              <Badge variant="outline" className="bg-zinc-500/10 text-zinc-500">no-match {preview.unmatched}</Badge>
              <span className="text-muted-foreground">total payout {formatRupiah(preview.total_payout)}</span>
            </div>
            {preview.variance > 0 && (
              <div className="text-[11px] rounded bg-amber-500/10 border border-amber-500/20 p-2 text-amber-700 dark:text-amber-400">
                <AlertTriangle className="w-3 h-3 inline mr-1" /> {preview.variance} order payout-nya beda dari ekspektasi (variance) — tetap di-apply tapi ditandai.
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={reset}><RotateCcw className="w-3.5 h-3.5 mr-1" /> Ganti</Button>
              <Button size="sm" onClick={apply} disabled={busy} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                {busy ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1" />} Apply Cair ({preview.matched + preview.variance})
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function Stat({ label, v }: { label: string; v: string }) {
  return <div className="rounded border bg-card p-2"><div className="text-[10px] text-muted-foreground">{label}</div><div className="font-bold tabular-nums">{v}</div></div>
}
