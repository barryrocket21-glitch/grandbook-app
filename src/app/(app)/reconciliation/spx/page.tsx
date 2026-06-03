'use client'

import { useCallback, useState } from 'react'
import { getErrorMessage } from '@/lib/errors'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PageHeader } from '@/components/ui/page-header'
import {
  Scale, Upload, Loader2, CheckCircle2, AlertTriangle,
  XCircle, RotateCcw, ArrowRight,
} from 'lucide-react'
import { toast } from 'sonner'
import { parseSpxFinancialXlsx } from '@/lib/recon/spx-parser'
import { formatRupiah } from '@/lib/format'
import { ReconHistory } from './_components/recon-history'
import type {
  ReconPreviewResult, ReconApplyResult, ReconMatchedRow, ReconVarianceRow, ReconUnmatchedRow,
} from '@/lib/types'

const supabase = createClient()

type StepKey = 'upload' | 'preview' | 'applying' | 'done'

export default function ReconSpxPage() {
  const { role } = useAuth()
  const canManage = role === 'owner' || role === 'admin' || role === 'akunting'

  const [step, setStep] = useState<StepKey>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [previewResult, setPreviewResult] = useState<ReconPreviewResult | null>(null)
  const [applyResult, setApplyResult] = useState<ReconApplyResult | null>(null)
  const [applying, setApplying] = useState(false)

  const handleFile = useCallback(async (f: File | null) => {
    if (!f) return
    setFile(f)
    setUploading(true)
    try {
      // 1. Parse XLSX client-side
      const { rows, warnings } = await parseSpxFinancialXlsx(f)
      if (warnings.length > 0) {
        warnings.forEach((w) => toast.warning('Parser warning', { description: w }))
      }
      if (rows.length === 0) {
        toast.error('File ga punya data row valid')
        setUploading(false)
        return
      }

      // 2. Call RPC preview_spx_recon (kirim raw row passthrough untuk audit)
      const { data, error } = await supabase.rpc('preview_spx_recon', {
        p_rows: rows.map((r) => ({
          resi: r.resi,
          cod_amount: r.cod_amount,
          payout_amount: r.payout_amount,
          shipping_cost_actual: r.shipping_cost_actual,
          ...(r.raw || {}),
        })),
        p_file_name: f.name,
        p_file_size_bytes: f.size,
      })
      if (error) throw error
      const result = Array.isArray(data) ? data[0] : data
      setPreviewResult(result as ReconPreviewResult)
      setStep('preview')
      toast.success(`Preview siap: ${result?.total_rows ?? 0} baris (${result?.matched_count ?? 0} match, ${result?.variance_count ?? 0} variance, ${result?.unmatched_count ?? 0} unmatch)`)
    } catch (err) {
      const msg = getErrorMessage(err)
      toast.error('Gagal preview', { description: msg })
    } finally {
      setUploading(false)
    }
  }, [])

  const handleApply = async () => {
    if (!previewResult) return
    if (!confirm(`KONFIRMASI: apply batch #${previewResult.batch_id}?\n\n${previewResult.matched_count} matched + ${previewResult.variance_count} variance order akan ke-update di DB (payout_amount + shipping_cost_actual). ${previewResult.unmatched_count} unmatched akan masuk inbox_unmatched_resi.\n\nLanjutkan?`)) return

    setApplying(true)
    setStep('applying')
    try {
      const { data, error } = await supabase.rpc('apply_spx_recon', { p_batch_id: previewResult.batch_id })
      if (error) throw error
      const result = Array.isArray(data) ? data[0] : data
      setApplyResult(result as ReconApplyResult)
      setStep('done')
      toast.success(`Applied! ${result?.matched_updated ?? 0} matched + ${result?.variance_updated ?? 0} variance updated, ${result?.unmatched_logged ?? 0} unmatched logged ke inbox`)
    } catch (err) {
      const msg = getErrorMessage(err)
      toast.error('Gagal apply', { description: msg })
      setStep('preview')
    } finally {
      setApplying(false)
    }
  }

  const handleCancel = async () => {
    if (!previewResult) return
    if (!confirm(`Cancel batch #${previewResult.batch_id}? Status akan jadi CANCELLED, tidak ada perubahan DB.`)) return
    await supabase
      .from('reconciliation_batches')
      .update({ status: 'CANCELLED' })
      .eq('id', previewResult.batch_id)
    toast.success(`Batch #${previewResult.batch_id} di-cancel`)
    reset()
  }

  const reset = () => {
    setStep('upload')
    setFile(null)
    setPreviewResult(null)
    setApplyResult(null)
  }

  const resumePreview = async (batchId: number) => {
    const { data, error } = await supabase
      .from('reconciliation_batches')
      .select('*')
      .eq('id', batchId)
      .single()
    if (error || !data) {
      toast.error('Gagal load batch', { description: error?.message })
      return
    }
    if (data.status !== 'PREVIEW') {
      toast.error(`Batch #${batchId} status ${data.status}, tidak bisa di-resume`)
      return
    }
    const payload = data.preview_payload || { matched: [], variance: [], unmatched: [] }
    setPreviewResult({
      batch_id: data.id,
      total_rows: data.total_rows,
      matched_count: data.matched_count,
      unmatched_count: data.unmatched_count,
      variance_count: data.variance_count,
      total_payout_estimated: Number(data.total_payout_applied || 0),
      total_shipping_estimated: Number(data.total_shipping_applied || 0),
      preview_data: payload,
    })
    setStep('preview')
    toast.success(`Resumed batch #${batchId}`)
  }

  if (!canManage) {
    return (
      <div className="space-y-6">
        <PageHeader icon={Scale} title="SPX Financial Reconciliation" />
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          Hanya owner/admin/akunting yang bisa mengelola reconciliation SPX.
        </CardContent></Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Scale}
        title="SPX Financial Reconciliation"
        description="Upload file Financial Report SPX (.xlsx) → preview match/variance/unmatched → klik Apply untuk update payout_amount + shipping_cost_actual."
        actions={
          step !== 'upload' ? (
            <Button variant="outline" size="sm" onClick={reset} className="gap-1.5">
              <RotateCcw className="w-3.5 h-3.5" /> Mulai Ulang
            </Button>
          ) : null
        }
      />

      <StepIndicator current={step} />

      {step === 'upload' && (
        <Card>
          <CardContent className="pt-4 pb-6 space-y-4">
            <div className="text-sm space-y-1">
              <div className="font-medium">Upload File Financial Report SPX</div>
              <div className="text-xs text-muted-foreground">
                Format: .xlsx dari SPX Seller Center → Financial Report. Header di row 2.
              </div>
            </div>
            <label className="block">
              <div className={`relative border-2 border-dashed rounded-lg p-8 text-center transition-colors
                ${uploading ? 'bg-violet-500/5 border-violet-500/40' : 'border-border hover:bg-muted/30 cursor-pointer'}`}>
                {uploading ? (
                  <>
                    <Loader2 className="w-8 h-8 animate-spin mx-auto text-violet-500" />
                    <div className="text-sm font-medium mt-2">Memproses {file?.name}...</div>
                    <div className="text-xs text-muted-foreground mt-1">Parsing XLSX + categorize matched/variance/unmatched</div>
                  </>
                ) : (
                  <>
                    <Upload className="w-8 h-8 text-muted-foreground mx-auto" />
                    <div className="text-sm font-medium mt-2">Klik untuk pilih file</div>
                    <div className="text-xs text-muted-foreground mt-1">atau drag &amp; drop .xlsx</div>
                  </>
                )}
                <Input
                  type="file"
                  accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
                  disabled={uploading}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
              </div>
            </label>
            <div className="text-xs text-muted-foreground space-y-0.5">
              <div className="font-medium text-foreground">Yang di-extract dari file:</div>
              <div>• Tracking Number → matched ke <code>orders.resi</code></div>
              <div>• Escrow amount (IDR) → <code>orders.payout_amount</code></div>
              <div>• Actual Shipping Fee (IDR) → <code>orders.shipping_cost_actual</code></div>
              <div>• COD Amount (IDR) → reference (tidak overwrite, hanya display)</div>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'preview' && previewResult && (
        <PreviewSection
          result={previewResult}
          onApply={handleApply}
          onCancel={handleCancel}
        />
      )}

      {step === 'applying' && (
        <Card>
          <CardContent className="pt-8 pb-8 text-center space-y-3">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-violet-500" />
            <div className="text-sm font-medium">Applying batch ke database...</div>
            <p className="text-xs text-muted-foreground">UPDATE orders + INSERT inbox_unmatched_resi. Jangan tutup tab.</p>
          </CardContent>
        </Card>
      )}

      {step === 'done' && applyResult && previewResult && (
        <DoneSection apply={applyResult} preview={previewResult} onReset={reset} />
      )}

      <ReconHistory onResume={resumePreview} />
    </div>
  )
}

// =============================================================
// Preview section
// =============================================================
function PreviewSection({
  result,
  onApply,
  onCancel,
}: {
  result: ReconPreviewResult
  onApply: () => void
  onCancel: () => void
}) {
  const { preview_data } = result
  return (
    <div className="space-y-4">
      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Total Rows" value={result.total_rows} color="violet" />
        <Stat label="Matched" value={result.matched_count} color="emerald" />
        <Stat label="Variance" value={result.variance_count} color="amber" />
        <Stat label="Unmatched" value={result.unmatched_count} color="red" />
      </div>

      <Card>
        <CardContent className="pt-4 pb-4 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Estimated Total Payout</div>
              <div className="text-lg font-bold tabular-nums">{formatRupiah(Number(result.total_payout_estimated))}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Estimated Total Shipping Cost</div>
              <div className="text-lg font-bold tabular-nums">{formatRupiah(Number(result.total_shipping_estimated))}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4 pb-4">
          <Tabs defaultValue="matched">
            <TabsList className="grid grid-cols-3 w-full max-w-md">
              <TabsTrigger value="matched">
                Matched <Badge variant="outline" className="ml-2 text-[10px]">{result.matched_count}</Badge>
              </TabsTrigger>
              <TabsTrigger value="variance">
                Variance <Badge variant="outline" className="ml-2 text-[10px]">{result.variance_count}</Badge>
              </TabsTrigger>
              <TabsTrigger value="unmatched">
                Unmatched <Badge variant="outline" className="ml-2 text-[10px]">{result.unmatched_count}</Badge>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="matched" className="pt-3">
              <MatchedTab rows={preview_data?.matched || []} />
            </TabsContent>
            <TabsContent value="variance" className="pt-3">
              <VarianceTab rows={preview_data?.variance || []} />
            </TabsContent>
            <TabsContent value="unmatched" className="pt-3">
              <UnmatchedTab rows={preview_data?.unmatched || []} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onCancel} className="gap-1.5">
          <XCircle className="w-3.5 h-3.5" /> Cancel Batch
        </Button>
        <Button
          onClick={onApply}
          disabled={result.matched_count + result.variance_count === 0}
          className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white gap-1.5"
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          Apply ke Database ({result.matched_count + result.variance_count} order)
          <ArrowRight className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  )
}

// =============================================================
// Done section
// =============================================================
function DoneSection({
  apply,
  preview,
  onReset,
}: {
  apply: ReconApplyResult
  preview: ReconPreviewResult
  onReset: () => void
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4 space-y-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-6 h-6 text-emerald-500" />
          <h3 className="text-lg font-bold">Reconciliation berhasil diterapkan</h3>
        </div>
        <div className="text-xs text-muted-foreground">
          Batch #{apply.batch_id} status APPLIED · {preview.matched_count + preview.variance_count} order updated · {apply.unmatched_logged} unmatched ke inbox.
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
          <Stat label="Matched updated" value={apply.matched_updated} color="emerald" />
          <Stat label="Variance updated" value={apply.variance_updated} color="amber" />
          <Stat label="Unmatched logged" value={apply.unmatched_logged} color="red" />
          <Stat label="Total payout" value={Number(preview.total_payout_estimated)} color="violet" rupiah />
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          <Button variant="outline" onClick={onReset}>Upload Lagi</Button>
          {apply.unmatched_logged > 0 && (
            <a
              href="/inbox/unmatched-resi"
              className="inline-flex items-center justify-center rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground px-3 py-1.5 text-sm"
            >
              Buka Inbox Unmatched Resi ({apply.unmatched_logged})
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function Stat({
  label, value, color, rupiah,
}: { label: string; value: number; color: 'emerald' | 'red' | 'amber' | 'violet'; rupiah?: boolean }) {
  const colorMap = {
    emerald: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600',
    red: 'bg-red-500/10 border-red-500/30 text-red-600',
    amber: 'bg-amber-500/10 border-amber-500/30 text-amber-600',
    violet: 'bg-violet-500/10 border-violet-500/30 text-violet-600',
  }
  return (
    <div className={`p-3 rounded border ${colorMap[color]}`}>
      <div className="text-2xl font-bold tabular-nums">
        {rupiah ? formatRupiah(value) : value.toLocaleString('id-ID')}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

// =============================================================
// Tab tables
// =============================================================
function MatchedTab({ rows }: { rows: ReconMatchedRow[] }) {
  if (rows.length === 0) return <EmptyTab message="Tidak ada matched rows" />
  return (
    <div className="border rounded-md overflow-hidden max-h-[500px] overflow-y-auto">
      <Table>
        <TableHeader className="sticky top-0 bg-background">
          <TableRow>
            <TableHead className="text-xs">Resi</TableHead>
            <TableHead className="text-xs">Order #</TableHead>
            <TableHead className="text-xs">Customer</TableHead>
            <TableHead className="text-xs text-right">Old Payout</TableHead>
            <TableHead className="text-xs text-right">New Payout</TableHead>
            <TableHead className="text-xs text-right">Shipping</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={`${r.resi}-${i}`}>
              <TableCell className="text-xs font-mono">{r.resi}</TableCell>
              <TableCell className="text-xs font-mono text-violet-500">{r.order_number}</TableCell>
              <TableCell className="text-xs">{r.customer_name}</TableCell>
              <TableCell className="text-xs text-right tabular-nums text-muted-foreground">
                {r.old_payout != null ? formatRupiah(Number(r.old_payout)) : <span className="italic">—</span>}
              </TableCell>
              <TableCell className="text-xs text-right tabular-nums font-medium">{formatRupiah(Number(r.new_payout))}</TableCell>
              <TableCell className="text-xs text-right tabular-nums">{formatRupiah(Number(r.new_shipping))}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function VarianceTab({ rows }: { rows: ReconVarianceRow[] }) {
  if (rows.length === 0) return <EmptyTab message="Tidak ada variance rows — semua data konsisten" />
  return (
    <div className="space-y-2">
      <div className="text-xs text-amber-600 flex items-start gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>
          Order ini sudah punya <code>payout_amount</code> di DB tapi BEDA dari file SPX &gt; Rp 100.
          File SPX authoritative — apply akan overwrite. Variance ditampilkan untuk visibility saja.
        </span>
      </div>
      <div className="border rounded-md overflow-hidden max-h-[500px] overflow-y-auto">
        <Table>
          <TableHeader className="sticky top-0 bg-background">
            <TableRow>
              <TableHead className="text-xs">Resi</TableHead>
              <TableHead className="text-xs">Order #</TableHead>
              <TableHead className="text-xs">Customer</TableHead>
              <TableHead className="text-xs text-right">Old Payout</TableHead>
              <TableHead className="text-xs text-right">New Payout</TableHead>
              <TableHead className="text-xs text-right">Diff</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={`${r.resi}-${i}`}>
                <TableCell className="text-xs font-mono">{r.resi}</TableCell>
                <TableCell className="text-xs font-mono text-violet-500">{r.order_number}</TableCell>
                <TableCell className="text-xs">{r.customer_name}</TableCell>
                <TableCell className="text-xs text-right tabular-nums text-muted-foreground">{formatRupiah(Number(r.old_payout))}</TableCell>
                <TableCell className="text-xs text-right tabular-nums font-medium">{formatRupiah(Number(r.new_payout))}</TableCell>
                <TableCell className={`text-xs text-right tabular-nums font-medium ${Number(r.diff) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                  {Number(r.diff) > 0 ? '+' : ''}{formatRupiah(Number(r.diff))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function UnmatchedTab({ rows }: { rows: ReconUnmatchedRow[] }) {
  if (rows.length === 0) return <EmptyTab message="Tidak ada unmatched rows — semua resi ketemu di DB" />
  return (
    <div className="space-y-2">
      <div className="text-xs text-red-600 flex items-start gap-1.5">
        <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>
          Resi di file ini TIDAK ditemukan di tabel orders. Apply akan log ke <code>inbox_unmatched_resi</code>
          untuk manual review (link ke existing order atau buat order baru).
        </span>
      </div>
      <div className="border rounded-md overflow-hidden max-h-[500px] overflow-y-auto">
        <Table>
          <TableHeader className="sticky top-0 bg-background">
            <TableRow>
              <TableHead className="text-xs">Resi</TableHead>
              <TableHead className="text-xs">Reason</TableHead>
              <TableHead className="text-xs text-right">COD Amount</TableHead>
              <TableHead className="text-xs text-right">Escrow</TableHead>
              <TableHead className="text-xs text-right">Shipping</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => {
              const codAmount = Number(r.cod_amount || 0)
              const payoutAmount = Number(r.payout_amount || 0)
              const shippingAmount = Number(r.shipping_cost_actual || 0)
              return (
                <TableRow key={`${String(r.resi || '')}-${i}`}>
                  <TableCell className="text-xs font-mono">{String(r.resi || '(empty)')}</TableCell>
                  <TableCell className="text-xs">
                    <Badge variant="outline" className="text-[10px] bg-red-500/10 text-red-600">
                      {r.reason === 'empty_resi' ? 'Resi kosong' : 'Resi tidak ada di orders'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-right tabular-nums">{formatRupiah(codAmount)}</TableCell>
                  <TableCell className="text-xs text-right tabular-nums">{formatRupiah(payoutAmount)}</TableCell>
                  <TableCell className="text-xs text-right tabular-nums">{formatRupiah(shippingAmount)}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function EmptyTab({ message }: { message: string }) {
  return (
    <div className="py-8 text-center text-sm text-muted-foreground">{message}</div>
  )
}

// =============================================================
// Step indicator
// =============================================================
function StepIndicator({ current }: { current: StepKey }) {
  const steps: Array<{ key: StepKey; label: string }> = [
    { key: 'upload', label: '1. Upload' },
    { key: 'preview', label: '2. Preview' },
    { key: 'applying', label: '3. Apply' },
    { key: 'done', label: '4. Done' },
  ]
  const idx = steps.findIndex((s) => s.key === current)
  return (
    <div className="flex items-center gap-1 text-xs flex-wrap">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-1">
          <span className={`px-2 py-1 rounded ${
            i === idx ? 'bg-violet-500/20 text-violet-500 font-medium' :
            i < idx ? 'text-muted-foreground' :
            'text-muted-foreground/50'
          }`}>{s.label}</span>
          {i < steps.length - 1 && <ArrowRight className="w-3 h-3 text-muted-foreground/40" />}
        </div>
      ))}
    </div>
  )
}

