'use client'
import { useRef, useState } from 'react'
import { getErrorMessage } from '@/lib/errors'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent } from '@/components/ui/card'
import { StatCard } from '@/components/ui/stat-card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Truck, Loader2, Upload, CheckCircle2, AlertTriangle, FileSpreadsheet, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/ui/page-header'
import { canApproveOrders } from '@/lib/auth/permissions'
import { findMissingPersistCandidates, parseSpxStatusFile, type ExistingOrderKey, type ParseResult, type RescuePriority, type SyncRow } from '@/lib/recon/spx-status-sync'

import { prepareManualSpxSync, type ManualSyncPlan } from '@/lib/recon/spx-manual-sync'

const supabase = createClient()

interface ApplyResult { matched: number; updated: number; skipped_no_ref: number; skipped_no_match: number }

function rescuePriority(status: string | null, reason: string | null): RescuePriority {
  const s = String(status || '').trim().toLowerCase()
  const hasReason = !!String(reason || '').trim()
  if (hasReason || ['on hold', 'pending pickup', 'returning', 'damaged', 'lost'].includes(s)) return 'HIGH'
  if (['in transit', 'delivering'].includes(s)) return 'MEDIUM'
  if (['cancelled', 'returned'].includes(s)) return 'LOW'
  return 'NONE'
}

function rescueLabel(priority: RescuePriority) {
  if (priority === 'HIGH') return 'Prioritas Tinggi'
  if (priority === 'MEDIUM') return 'Monitor'
  if (priority === 'LOW') return 'Sudah final/low'
  return 'Normal'
}

function RescueQueuePreview({ rows }: { rows: SyncRow[] }) {
  const rescueRows = rows
    .filter((r) => r.ref.startsWith('GB-') && r.rescue_priority !== 'NONE')
    .sort((a, b) => {
      const score = (p: RescuePriority) => p === 'HIGH' ? 0 : p === 'MEDIUM' ? 1 : 2
      return score(a.rescue_priority) - score(b.rescue_priority)
    })
  const high = rescueRows.filter((r) => r.rescue_priority === 'HIGH')
  const medium = rescueRows.filter((r) => r.rescue_priority === 'MEDIUM')
  const potentialCod = rescueRows.reduce((sum, r) => sum + (r.cod_amount || 0), 0)

  return (
    <Card>
      <CardContent className="pt-4 pb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          <div className="text-sm font-semibold">Rescue Queue Preview</div>
          <Badge variant="outline" className="bg-red-500/10 text-red-600">Prioritas Tinggi: {high.length}</Badge>
          <Badge variant="outline" className="bg-amber-500/10 text-amber-600">Monitor: {medium.length}</Badge>
          <Badge variant="outline">potensi COD diselamatkan: {potentialCod.toLocaleString('id-ID')}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Follow-up admin/CS fokus ke On Hold, Pending Pickup, Returning, Delivery failed Reason, Damaged/Lost, lalu monitor In Transit/Delivering yang lama. Preview ini cuma baca file; Apply Sync tetap butuh klik manual.
        </p>
        {rescueRows.length === 0 ? (
          <div className="text-xs text-muted-foreground rounded border p-3">Tidak ada kandidat rescue dari baris ber-GB- di file ini.</div>
        ) : (
          <div className="border rounded-md overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card"><tr className="text-left text-muted-foreground">
                <th className="p-2">Prioritas</th><th className="p-2">GB Order</th><th className="p-2">Resi</th><th className="p-2">Status SPX</th><th className="p-2">Alasan</th><th className="p-2 text-right">COD</th>
              </tr></thead>
              <tbody>
                {rescueRows.slice(0, 20).map((r, i) => (
                  <tr key={`${r.ref}-${i}`}>
                    <td className="p-2"><Badge variant="outline" className={r.rescue_priority === 'HIGH' ? 'bg-red-500/10 text-red-600' : 'bg-amber-500/10 text-amber-600'}>{rescueLabel(r.rescue_priority)}</Badge></td>
                    <td className="p-2 font-mono">{r.ref}</td>
                    <td className="p-2 font-mono">{r.tracking_no || '—'}</td>
                    <td className="p-2">{r.tracking_status || '—'}</td>
                    <td className="p-2 max-w-[260px] truncate">{r.retur_reason || '—'}</td>
                    <td className="p-2 text-right tabular-nums">{r.cod_amount != null ? r.cod_amount.toLocaleString('id-ID') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default function SpxStatusSyncPage() {
  const { role } = useAuth()
  const canSync = canApproveOrders(role)
  const [parsed, setParsed] = useState<ParseResult | null>(null)
  const [parsing, setParsing] = useState(false)
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState<ApplyResult | null>(null)
  const [missingPersistCount, setMissingPersistCount] = useState(0)
  const [syncPlan, setSyncPlan] = useState<ManualSyncPlan | null>(null)
  const busy = useRef(false)

  const onFile = async (file: File) => {
    if (busy.current) return
    busy.current = true
    setParsing(true); setResult(null); setParsed(null); setSyncPlan(null); setMissingPersistCount(0)
    try {
      const buf = await file.arrayBuffer()
      const nextParsed = parseSpxStatusFile(buf, file.name, file.size)
      // Send every identity so a later row can link an earlier row to an existing
      // order. Collapse connected duplicates across all file chunks afterwards.
      const keys = nextParsed.rows.map(row => ({ ref: row.ref, tracking_no: row.tracking_no }))
      const existing: ExistingOrderKey[] = []
      for (let i = 0; i < keys.length; i += 200) {
        const { data, error } = await supabase.rpc('preview_missing_spx_orders', {
          p_rows: keys.slice(i, i + 200),
        })
        if (error) throw error
        if (!data || !Array.isArray(data.existing_keys)) throw new Error('Pemeriksaan order SPX belum tersedia.')
        existing.push(...data.existing_keys)
      }
      setMissingPersistCount(findMissingPersistCandidates(nextParsed.rows, existing).length)
      const reviewed = await prepareManualSpxSync(supabase, nextParsed.rows)
      setSyncPlan(reviewed)
      setParsed(nextParsed)
    } catch (err) {
      toast.error('Gagal baca file', { description: getErrorMessage(err) })
    } finally { setParsing(false); busy.current = false }
  }

  const apply = async () => {
    if (!parsed || !syncPlan || busy.current) return
    busy.current = true
    setApplying(true)
    const tid = toast.loading('Menyimpan hasil preview SPX...')
    try {
      const acc: ApplyResult = { matched: 0, updated: 0, skipped_no_ref: syncPlan.skipped_no_ref, skipped_no_match: syncPlan.skipped_no_match }
      const totalChunks = Math.ceil(syncPlan.rows.length / 150)
      for (let i = 0; i < syncPlan.rows.length; i += 150) {
        const chunk = syncPlan.rows.slice(i, i + 150)
        const { data, error } = await supabase.rpc('apply_spx_status_sync', { p_rows: chunk })
        if (error) throw error
        if (!data || data.dry_run !== false || data.matched !== chunk.length || !Number.isInteger(data.updated)
          || data.updated < 0 || data.updated > data.matched) throw new Error('Hasil simpan belum dapat dipastikan; ulangi preview sebelum melanjutkan.')
        acc.matched += data.matched
        acc.updated += data.updated
        toast.loading(`Sync ${Math.floor(i / 150) + 1}/${totalChunks} batch... (${acc.updated} berubah)`, { id: tid })
      }
      setResult(acc)
      toast.success(`Sync selesai: ${acc.updated} order berubah.`)
    } catch (err) {
      toast.error('Sync belum selesai', { description: `${getErrorMessage(err)} Batch yang sudah berhasil tetap tersimpan; retry yang sama tidak menggandakan order.` })
    } finally {
      toast.dismiss(tid)
      setApplying(false)
      busy.current = false
    }
  }

  const reset = () => { setParsed(null); setSyncPlan(null); setResult(null); setMissingPersistCount(0) }

  if (!canSync) {
    return <div className="space-y-6"><PageHeader icon={Truck} title="Sync Status SPX" /><Card><CardContent className="p-6 text-sm text-muted-foreground">Hanya owner/admin.</CardContent></Card></div>
  }

  return (
    <div className="space-y-5">
      <PageHeader icon={Truck} title="Sync Status SPX"
        description="Upload file status SPX → preview kecocokan draft dan arsip → simpan resi serta status kurir. Biaya aktual direkonsiliasi lewat file keuangan." />

      {!parsed ? (
        <Card>
          <CardContent className="pt-6 pb-6 space-y-3">
            <div className="text-sm text-muted-foreground flex items-center gap-1.5"><Upload className="w-4 h-4" /> Pilih file status SPX (.xlsx)</div>
            <Input type="file" accept=".xlsx,.xls" disabled={parsing}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
            {parsing && <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Membaca file…</div>}
            <div className="text-xs text-muted-foreground rounded bg-amber-500/10 border border-amber-500/20 p-2.5">
              <AlertTriangle className="w-3.5 h-3.5 inline mr-1 text-amber-600" />
              Import ini <b>cuma update</b> order yang udah ada. Prioritas match: <b>GB-</b>; kalau gak ada, fallback ke <b>tracking/resi exact</b> yang sudah tertanam di draft. <b>Gak pernah bikin order baru</b>, gak nimpa data customer/alamat/produk.
            </div>
          </CardContent>
        </Card>
      ) : !result ? (
        <Card>
          <CardContent className="pt-4 pb-4 space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <FileSpreadsheet className="w-4 h-4 text-zinc-500" /> <span className="font-mono text-xs">{parsed.fileName}</span>
              <Badge variant="outline">{parsed.total} baris</Badge>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="p-3 rounded border bg-emerald-500/10 border-emerald-500/30">
                <div className="text-2xl font-bold text-emerald-600">{parsed.withGb}</div>
                <div className="text-xs text-muted-foreground">ber-GB- (bakal dicocokin)</div>
              </div>
              <div className="p-3 rounded border bg-zinc-500/10 border-zinc-500/30">
                <div className="text-2xl font-bold text-zinc-500">{parsed.noGb}</div>
                <div className="text-xs text-muted-foreground">tanpa GB-</div>
              </div>
              <div className="p-3 rounded border bg-blue-500/10 border-blue-500/30">
                <div className="text-2xl font-bold text-blue-600">{parsed.withTracking}</div>
                <div className="text-xs text-muted-foreground">punya tracking (bisa fallback exact)</div>
              </div>
            </div>
            {missingPersistCount > 0 && (
              <div className="text-xs rounded bg-red-500/10 border border-red-500/20 p-2.5 text-red-700 dark:text-red-300">
                <AlertTriangle className="w-3.5 h-3.5 inline mr-1" /> Ada <b>{missingPersistCount}</b> identitas order SPX yang belum ditemukan di draft maupun arsip GrandBook. Periksa sumber ordernya; Apply Sync hanya memperbarui order yang sudah ada.
              </div>
            )}
            <RescueQueuePreview rows={parsed.rows} />
            {parsed.withGb === 0 && parsed.withTracking === 0 && (
              <div className="text-xs rounded bg-amber-500/10 border border-amber-500/20 p-2.5 text-amber-700 dark:text-amber-400">
                <AlertTriangle className="w-3.5 h-3.5 inline mr-1" /> Gak ada baris ber-GB- maupun tracking yang bisa dipakai — semua bakal di-skip (gak ada yang ke-update). Ini normal buat file lama/legacy yang minim kolom referensi.
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
                    <tr key={i} className={r.ref.startsWith('GB-') || !!r.tracking_no ? '' : 'opacity-50'}>
                      <td className="p-2 font-mono">{r.ref || '—'}{!r.ref.startsWith('GB-') && !r.tracking_no && <span className="ml-1 text-[10px] text-zinc-500">(skip)</span>}</td>
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
              <Button onClick={apply} disabled={applying || !syncPlan?.rows.length} className="">
                {applying ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
                Apply Sync ({syncPlan?.matched || 0} order cocok)
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-4 pb-4 space-y-3">
            <div className="flex items-center gap-2"><CheckCircle2 className="w-6 h-6 text-emerald-500" /><h3 className="text-lg font-bold">Sync selesai</h3></div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
              <StatCard label="ke-update" value={result.updated} tone="emerald" />
              <StatCard label="match ref/tracking" value={result.matched} tone="zinc" />
              <StatCard label="Sudah sesuai" value={result.matched - result.updated} tone="amber" />
              <StatCard label="skip (no ref & no tracking)" value={result.skipped_no_ref} tone="zinc" />
              <StatCard label="skip (no match)" value={result.skipped_no_match} tone="amber" />
            </div>
            <p className="text-xs text-muted-foreground">Order ke-update tetap di <b>Post-Export</b> — status & resi-nya berubah. Terkirim = filter selesai; Retur = alasan kesimpen.</p>
            <Button variant="outline" onClick={reset}>Import Lagi</Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
