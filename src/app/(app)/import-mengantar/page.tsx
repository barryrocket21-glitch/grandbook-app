'use client'
// =============================================================
// Import Order Mengantar/JNE — order channel ini absen dari GrandBook → import
// jadi order baru (rekap). Upload .xlsx → preview (dedup, match produk, tebak
// atribusi) → apply (bikin order). Pola preview/apply, RPC mig 137.
// =============================================================
import { useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { Truck, Loader2, Upload, AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { formatRupiah } from '@/lib/format'
import { parseMengantarXlsx, type ParsedMengantarOrder } from '@/lib/recon/mengantar-parser'
import {
  previewMengantarImport,
  applyMengantarImport,
  type MengantarPreview,
  type MengantarApplyResult,
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

export default function ImportMengantarPage() {
  const { role, loading: authLoading } = useAuth()
  const canView = role === 'owner' || role === 'admin'

  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [preview, setPreview] = useState<MengantarPreview | null>(null)
  const [applied, setApplied] = useState<MengantarApplyResult | null>(null)
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
      toast.error('Gagal baca file. Pastikan .xlsx export Mengantar.')
    } finally {
      setBusy(false)
    }
  }, [])

  const doPreview = useCallback(async () => {
    if (!parsed || !file) return
    setBusy(true)
    try {
      const p = await previewMengantarImport(supabase, parsed.rows, file.name, file.size)
      setPreview(p)
    } catch (err) {
      console.warn('preview_mengantar_import:', err)
      toast.error('Preview gagal.')
    } finally {
      setBusy(false)
    }
  }, [parsed, file])

  const doApply = useCallback(async () => {
    if (!preview) return
    if (!confirm(`Import ${preview.to_create} order baru ke pembukuan? (${preview.already_exists} udah ada, di-skip)`)) return
    setBusy(true)
    try {
      const r = await applyMengantarImport(supabase, preview.batch_id)
      setApplied(r)
      toast.success(`${r.created} order ke-import.`)
    } catch (err) {
      console.warn('apply_mengantar_import:', err)
      toast.error('Import gagal.')
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

  const sample = preview?.preview_data?.to_create?.slice(0, 10) ?? []

  return (
    <div className="space-y-4">
      <PageHeader
        title="Import Order Mengantar"
        description="Order channel JNE/Mengantar belum ada di GrandBook — import dari file export jadi order baru (rekap)."
        icon={Truck}
        badge="BARU"
      />

      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="space-y-1.5">
            <p className="text-sm font-medium">File export Mengantar (.xlsx)</p>
            <input
              type="file"
              accept=".xlsx"
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
              <p>Status belum dikenal (bakal jadi PROBLEM): {parsed.unknownStatuses.join(', ')}</p>
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
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              <Stat label="Order baru (akan dibuat)" value={preview.to_create} tone="text-emerald-600 dark:text-emerald-400" />
              <Stat label="Udah ada (skip)" value={preview.already_exists} />
              <Stat label="Produk ke-match" value={preview.product_matched} />
              <Stat label="Produk gak ke-match" value={preview.product_unmatched} tone={preview.product_unmatched ? 'text-amber-600' : ''} />
              <Stat label="Atribusi ketebak" value={preview.attribution_guessed} />
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr className="text-left">
                    <th className="px-3 py-2">Resi</th><th className="px-3 py-2">Customer</th>
                    <th className="px-3 py-2">Produk</th><th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">COD</th><th className="px-3 py-2 text-right">Payout</th>
                  </tr>
                </thead>
                <tbody>
                  {sample.map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-1.5 font-mono text-xs">{r.resi}</td>
                      <td className="px-3 py-1.5">{r.customer_name}</td>
                      <td className="px-3 py-1.5">
                        {r.product_id ? '✓ ' : <span className="text-amber-600">? </span>}{r.product_raw}
                      </td>
                      <td className="px-3 py-1.5">{r.status}</td>
                      <td className="px-3 py-1.5 text-right">{formatRupiah(r.cod)}</td>
                      <td className="px-3 py-1.5 text-right">{r.payout != null ? formatRupiah(r.payout) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.to_create > sample.length && (
              <p className="text-xs text-muted-foreground">Nampilin {sample.length} dari {preview.to_create} order.</p>
            )}

            <div className="flex gap-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
              <Info className="size-4 shrink-0 mt-0.5" />
              <p>Model: total=COD, biaya kurir aktual dari file → laba bener. Status & produk bisa di-cek dulu di atas sebelum import. ✓=produk ke-match, ?=belum (tetap ke-import, bisa dibenerin nanti).</p>
            </div>

            {!applied && (
              <Button onClick={doApply} disabled={busy || preview.to_create === 0}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                Import {preview.to_create} Order
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
              <p className="font-medium">{applied.created} order ke-import.</p>
              <p className="text-sm text-muted-foreground">{applied.skipped_exists} di-skip (udah ada).</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
