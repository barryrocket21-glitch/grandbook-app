'use client'
import { useState } from 'react'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Truck, Loader2, Upload, CheckCircle2, AlertTriangle, FileSpreadsheet, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/ui/page-header'
import { canApproveOrders } from '@/lib/auth/permissions'

const supabase = createClient()

interface SyncRow {
  ref: string
  tracking_no: string | null
  tracking_status: string | null
  actual_fee: number | null
  return_fee: number | null
  delivered_at: string | null
  retur_reason: string | null
}
interface ParseResult { rows: SyncRow[]; total: number; withGb: number; noGb: number; fileName: string }
interface ApplyResult { matched: number; updated: number; skipped_no_ref: number; skipped_no_match: number }

function num(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v).trim()
  if (s === '' || s === '-') return null
  const n = Number(s.replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}
// "01-06-2026 18:56" (DD-MM-YYYY HH:MM) → ISO. "-"/"" → null.
function parseDate(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  if (s === '' || s === '-') return null
  const m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/)
  if (!m) return null
  const [, d, mo, y, hh, mm] = m
  const dt = new Date(Number(y), Number(mo) - 1, Number(d), Number(hh || 0), Number(mm || 0))
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString()
}

function parseSpxFile(data: ArrayBuffer, fileName: string): ParseResult {
  const wb = XLSX.read(data, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null })
  // cari baris header (yang ada "Customer Reference No.")
  let hi = -1
  for (let i = 0; i < Math.min(aoa.length, 6); i++) {
    if ((aoa[i] || []).some((c) => /customer reference no/i.test(String(c ?? '')))) { hi = i; break }
  }
  if (hi < 0) throw new Error('Header "Customer Reference No." gak ketemu — pastiin ini file status SPX.')
  const hdr = (aoa[hi] as unknown[]).map((h) => String(h ?? '').trim())
  const col = (re: RegExp) => hdr.findIndex((h) => re.test(h))
  const iRef = col(/^customer reference no\.?$/i)
  const iTrk = col(/^tracking no\.?$/i)
  const iStat = col(/^tracking status$/i)
  const iActual = col(/^actual shipping fee$/i)
  const iReturn = col(/^return shipping fee$/i)
  const iDeliv = col(/^delivered time$/i)
  const iFail = col(/^delivery failed reason$/i)
  const iHold = col(/^delivery onhold reason$/i)

  const rows: SyncRow[] = []
  let withGb = 0, noGb = 0
  for (let i = hi + 1; i < aoa.length; i++) {
    const r = aoa[i] as unknown[]
    if (!r || r.every((c) => c == null || String(c).trim() === '')) continue
    const ref = String(r[iRef] ?? '').trim()
    const isGb = ref.startsWith('GB-')
    if (isGb) withGb++; else noGb++
    rows.push({
      ref,
      tracking_no: iTrk >= 0 ? (String(r[iTrk] ?? '').trim() || null) : null,
      tracking_status: iStat >= 0 ? (String(r[iStat] ?? '').trim() || null) : null,
      actual_fee: iActual >= 0 ? num(r[iActual]) : null,
      return_fee: iReturn >= 0 ? num(r[iReturn]) : null,
      delivered_at: iDeliv >= 0 ? parseDate(r[iDeliv]) : null,
      retur_reason: ((iFail >= 0 ? String(r[iFail] ?? '').trim() : '') || (iHold >= 0 ? String(r[iHold] ?? '').trim() : '')) || null,
    })
  }
  return { rows, total: rows.length, withGb, noGb, fileName }
}

export default function SpxStatusSyncPage() {
  const { role } = useAuth()
  const canSync = canApproveOrders(role)
  const [parsed, setParsed] = useState<ParseResult | null>(null)
  const [parsing, setParsing] = useState(false)
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState<ApplyResult | null>(null)

  const onFile = async (file: File) => {
    setParsing(true); setResult(null); setParsed(null)
    try {
      const buf = await file.arrayBuffer()
      setParsed(parseSpxFile(buf, file.name))
    } catch (err) {
      toast.error('Gagal baca file', { description: err instanceof Error ? err.message : String(err) })
    } finally { setParsing(false) }
  }

  const apply = async () => {
    if (!parsed) return
    setApplying(true)
    try {
      const acc: ApplyResult = { matched: 0, updated: 0, skipped_no_ref: 0, skipped_no_match: 0 }
      // chunk biar payload gak kegedean
      for (let i = 0; i < parsed.rows.length; i += 400) {
        const chunk = parsed.rows.slice(i, i + 400)
        const { data, error } = await supabase.rpc('apply_spx_status_sync', { p_rows: chunk })
        if (error) throw error
        const d = (data || {}) as ApplyResult
        acc.matched += d.matched || 0; acc.updated += d.updated || 0
        acc.skipped_no_ref += d.skipped_no_ref || 0; acc.skipped_no_match += d.skipped_no_match || 0
      }
      setResult(acc)
      toast.success(`Sync selesai: ${acc.updated} order ke-update, ${acc.skipped_no_ref + acc.skipped_no_match} di-skip`)
    } catch (err) {
      toast.error('Gagal sync', { description: err instanceof Error ? err.message : String(err) })
    } finally { setApplying(false) }
  }

  const reset = () => { setParsed(null); setResult(null) }

  if (!canSync) {
    return <div className="space-y-6"><PageHeader icon={Truck} title="Sync Status SPX" /><Card><CardContent className="p-6 text-sm text-muted-foreground">Hanya owner/admin.</CardContent></Card></div>
  }

  return (
    <div className="space-y-5">
      <PageHeader icon={Truck} title="Sync Status SPX"
        description="Upload file status SPX → cocokin GB- → isi resi + status + ongkir ke order di Post-Export. Order TANPA GB- di-skip total." />

      {!parsed ? (
        <Card>
          <CardContent className="pt-6 pb-6 space-y-3">
            <div className="text-sm text-muted-foreground flex items-center gap-1.5"><Upload className="w-4 h-4" /> Pilih file status SPX (.xlsx)</div>
            <Input type="file" accept=".xlsx,.xls" disabled={parsing}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
            {parsing && <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Membaca file…</div>}
            <div className="text-xs text-muted-foreground rounded bg-amber-500/10 border border-amber-500/20 p-2.5">
              <AlertTriangle className="w-3.5 h-3.5 inline mr-1 text-amber-600" />
              Import ini <b>cuma update</b> order yang udah ada (match GB-). <b>Gak pernah bikin order baru</b>, gak nimpa data customer/alamat/produk. Baris tanpa GB- di-skip.
            </div>
          </CardContent>
        </Card>
      ) : !result ? (
        <Card>
          <CardContent className="pt-4 pb-4 space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <FileSpreadsheet className="w-4 h-4 text-violet-500" /> <span className="font-mono text-xs">{parsed.fileName}</span>
              <Badge variant="outline">{parsed.total} baris</Badge>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="p-3 rounded border bg-emerald-500/10 border-emerald-500/30">
                <div className="text-2xl font-bold text-emerald-600">{parsed.withGb}</div>
                <div className="text-xs text-muted-foreground">ber-GB- (bakal dicocokin)</div>
              </div>
              <div className="p-3 rounded border bg-zinc-500/10 border-zinc-500/30">
                <div className="text-2xl font-bold text-zinc-500">{parsed.noGb}</div>
                <div className="text-xs text-muted-foreground">tanpa GB- (di-SKIP total)</div>
              </div>
            </div>
            {parsed.withGb === 0 && (
              <div className="text-xs rounded bg-amber-500/10 border border-amber-500/20 p-2.5 text-amber-700 dark:text-amber-400">
                <AlertTriangle className="w-3.5 h-3.5 inline mr-1" /> Gak ada baris ber-GB- — semua bakal di-skip (gak ada yang ke-update). Ini normal buat file lama/legacy.
              </div>
            )}
            {/* sample */}
            <div className="border rounded-md overflow-x-auto max-h-64 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card"><tr className="text-left text-muted-foreground">
                  <th className="p-2">Customer Ref (GB-)</th><th className="p-2">Resi</th><th className="p-2">Status SPX</th><th className="p-2 text-right">Ongkir Actual</th><th className="p-2 text-right">Ongkir Retur</th>
                </tr></thead>
                <tbody>
                  {parsed.rows.slice(0, 12).map((r, i) => (
                    <tr key={i} className={r.ref.startsWith('GB-') ? '' : 'opacity-50'}>
                      <td className="p-2 font-mono">{r.ref || '—'}{!r.ref.startsWith('GB-') && <span className="ml-1 text-[10px] text-zinc-500">(skip)</span>}</td>
                      <td className="p-2 font-mono">{r.tracking_no || '—'}</td>
                      <td className="p-2">{r.tracking_status || '—'}</td>
                      <td className="p-2 text-right tabular-nums">{r.actual_fee != null ? r.actual_fee.toLocaleString('id-ID') : '—'}</td>
                      <td className="p-2 text-right tabular-nums">{r.return_fee != null ? r.return_fee.toLocaleString('id-ID') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-between">
              <Button variant="outline" onClick={reset}><RotateCcw className="w-3.5 h-3.5 mr-1" /> Ganti File</Button>
              <Button onClick={apply} disabled={applying} className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white">
                {applying ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
                Apply Sync ({parsed.withGb} ber-GB-)
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-4 pb-4 space-y-3">
            <div className="flex items-center gap-2"><CheckCircle2 className="w-6 h-6 text-emerald-500" /><h3 className="text-lg font-bold">Sync selesai</h3></div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <Stat label="ke-update" value={result.updated} color="emerald" />
              <Stat label="match GB-" value={result.matched} color="violet" />
              <Stat label="skip (no GB-)" value={result.skipped_no_ref} color="zinc" />
              <Stat label="skip (no match)" value={result.skipped_no_match} color="amber" />
            </div>
            <p className="text-xs text-muted-foreground">Order ke-update tetap di <b>Post-Export</b> — status & resi-nya berubah. Terkirim = filter selesai; Retur = alasan kesimpen.</p>
            <Button variant="outline" onClick={reset}>Import Lagi</Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  const c: Record<string, string> = {
    emerald: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600',
    violet: 'bg-violet-500/10 border-violet-500/30 text-violet-600',
    zinc: 'bg-zinc-500/10 border-zinc-500/30 text-zinc-500',
    amber: 'bg-amber-500/10 border-amber-500/30 text-amber-600',
  }
  return <div className={`p-3 rounded border ${c[color]}`}><div className="text-2xl font-bold">{value}</div><div className="text-xs text-muted-foreground">{label}</div></div>
}
