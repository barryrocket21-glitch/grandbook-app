'use client'
// =============================================================
// Sync Status Mengantar/JNE — order udah ada di GrandBook (draft, resi NULL).
// Upload file status Mengantar → match by HP+produk → set tracking_no + status
// (DELIVERED→DITERIMA dst) + channel JNE. Pola preview/apply, RPC mig 138.
// (Nomor GB gak balik dari Mengantar → match HP, bukan import order baru.)
// =============================================================
import { useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { Truck, Loader2, Upload, AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { parseMengantarXlsx, type ParsedMengantarOrder } from '@/lib/recon/mengantar-parser'
import {
  previewMengantarStatusSync,
  applyMengantarStatusSync,
  type MengantarSyncPreview,
  type MengantarSyncResult,
} from '@/lib/supabase/queries/mengantar-import'
import { toast } from 'sonner'

const supabase = createClient()

interface Parsed {
  rows: ParsedMengantarOrder[]
  warnings: string[]
  unknownStatuses: string[]
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={'text-xl font-semibold ' + (tone ?? '')}>{value}</p>
    </div>
  )
}

export default function SyncMengantarPage() {
  const { role, loading: authLoading } = useAuth()
  const canView = role === 'owner' || role === 'admin'

  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [preview, setPreview] = useState<MengantarSyncPreview | null>(null)
  const [applied, setApplied] = useState<MengantarSyncResult | null>(null)
  const [busy, setBusy] = useState(false)

  const onFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f); setPreview(null); setApplied(null); setBusy(true)
    try {
      const res = await parseMengantarXlsx(f)
      setParsed(res)
      if (!res.rows.length) toast.error('Gak ada baris kebaca dari file.')
      else toast.success(`${res.rows.length} baris kebaca.`)
    } catch {
      toast.error('Gagal baca file. Pastikan .xlsx status export Mengantar.')
    } finally {
      setBusy(false)
    }
  }, [])

  const doPreview = useCallback(async () => {
    if (!parsed || !file) return
    setBusy(true)
    try {
      setPreview(await previewMengantarStatusSync(supabase, parsed.rows, file.name, file.size))
    } catch (err) {
      console.warn('preview_mengantar_status_sync:', err)
      toast.error('Preview gagal.')
    } finally {
      setBusy(false)
    }
  }, [parsed, file])

  const doApply = useCallback(async () => {
    if (!preview) return
    if (!confirm(`Update status ${preview.matched} order Mengantar? (set resi + status + channel JNE)`)) return
    setBusy(true)
    try {
      const r = await applyMengantarStatusSync(supabase, preview.batch_id)
      setApplied(r)
      toast.success(`${r.updated} order ke-update.`)
    } catch (err) {
      console.warn('apply_mengantar_status_sync:', err)
      toast.error('Update gagal.')
    } finally {
      setBusy(false)
    }
  }, [preview])

  if (authLoading) return <div className="p-6 text-sm text-muted-foreground">Memeriksa akses…</div>
  if (!canView)
    return (
      <Card className="max-w-md mx-auto mt-8">
        <CardContent className="p-6 text-sm text-muted-foreground">
          Akses dibatasi. Halaman ini untuk owner atau admin.
        </CardContent>
      </Card>
    )

  const sample = preview?.preview_data?.matched?.slice(0, 12) ?? []

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sync Status Mengantar"
        description="Tarik file status dari Mengantar → cocokin ke order yang udah ada (by HP+produk) → update resi + status + channel JNE."
        icon={Truck}
        badge="BARU"
      />

      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="space-y-1.5">
            <p className="text-sm font-medium">File status Mengantar (.xlsx)</p>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={onFile}
              className="block text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-muted/70"
            />
          </div>

          {parsed && (
            <p className="text-sm text-muted-foreground">
              {parsed.rows.length} baris kebaca dari <b>{file?.name}</b>.
            </p>
          )}

          {parsed && parsed.unknownStatuses.length > 0 && (
            <div className="flex gap-2 rounded-md bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              <p>Status belum dikenal (gak ngubah status): {parsed.unknownStatuses.join(', ')}</p>
            </div>
          )}

          {parsed && !preview && (
            <Button onClick={doPreview} disabled={busy || !parsed.rows.length}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              Preview
            </Button>
          )}
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <CardContent className="p-5 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Stat label="Ketemu (akan di-update)" value={preview.matched} tone="text-emerald-600 dark:text-emerald-400" />
              <Stat label="Status berubah" value={preview.status_changes} />
              <Stat label="Ambigu (skip)" value={preview.ambiguous} tone={preview.ambiguous ? 'text-amber-600' : ''} />
              <Stat label="Gak ketemu (skip)" value={preview.unmatched} tone={preview.unmatched ? 'text-amber-600' : ''} />
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr className="text-left">
                    <th className="px-3 py-2">No GB</th><th className="px-3 py-2">Customer</th>
                    <th className="px-3 py-2">Status</th><th className="px-3 py-2">Resi (baru)</th>
                  </tr>
                </thead>
                <tbody>
                  {sample.map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-1.5 font-mono text-xs">{r.order_number}</td>
                      <td className="px-3 py-1.5">{r.customer_name}</td>
                      <td className="px-3 py-1.5">
                        {r.old_status}{r.old_status !== r.new_status && <span className="text-emerald-600"> → {r.new_status}</span>}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-xs">{r.resi}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.matched > sample.length && (
              <p className="text-xs text-muted-foreground">Nampilin {sample.length} dari {preview.matched} order.</p>
            )}

            <div className="flex gap-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
              <Info className="size-4 shrink-0 mt-0.5" />
              <p>
                Match: HP (9 digit) + produk, cuma ke draft yang belum ada resi. Yang ke-update: resi
                (tracking_no, biar gak ke-promote dini), status, channel JNE, ongkir aktual. Ambigu &
                gak-ketemu di-skip (aman). Order/customer/produk gak disentuh.
              </p>
            </div>

            {!applied && (
              <Button onClick={doApply} disabled={busy || preview.matched === 0}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                Update {preview.matched} Order
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {applied && (
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <CheckCircle2 className="size-6 text-emerald-600" />
            <div>
              <p className="font-medium">{applied.updated} order Mengantar ke-update.</p>
              <p className="text-sm text-muted-foreground">Resi + status + channel JNE keisi.</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
