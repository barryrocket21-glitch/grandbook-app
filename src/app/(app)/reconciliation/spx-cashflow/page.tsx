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
  Wallet, Upload, Loader2, CheckCircle2, AlertTriangle,
  XCircle, RotateCcw, ArrowRight, Banknote,
} from 'lucide-react'
import { toast } from 'sonner'
import { parseAccountTransactionXlsx } from '@/lib/recon/spx-cashflow-parser'
import { formatRupiah } from '@/lib/format'
import { format, parseISO } from 'date-fns'
import { id as localeId } from 'date-fns/locale'
import { CashflowHistory } from './_components/cashflow-history'
import type {
  CashflowPreviewResult, CashflowApplyResult,
  CashflowCodMatchedRow, CashflowCodVarianceRow, CashflowCodUnmatchedRow,
  CashflowWithdrawalRow,
} from '@/lib/types'

const supabase = createClient()

type StepKey = 'upload' | 'preview' | 'applying' | 'done'

export default function ReconSpxCashflowPage() {
  const { role } = useAuth()
  const canManage = role === 'owner' || role === 'admin' || role === 'akunting'

  const [step, setStep] = useState<StepKey>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [previewResult, setPreviewResult] = useState<CashflowPreviewResult | null>(null)
  const [applyResult, setApplyResult] = useState<CashflowApplyResult | null>(null)
  const [applying, setApplying] = useState(false)

  const handleFile = useCallback(async (f: File | null) => {
    if (!f) return
    setFile(f)
    setUploading(true)
    try {
      const { rows, warnings } = await parseAccountTransactionXlsx(f)
      warnings.forEach((w) => toast.warning('Parser warning', { description: w }))
      if (rows.length === 0) {
        toast.error('File ga punya data row valid')
        setUploading(false)
        return
      }

      const { data, error } = await supabase.rpc('preview_spx_cashflow_recon', {
        p_rows: rows.map((r) => ({
          external_id: r.external_id,
          tx_type: r.tx_type,
          tracking: r.tracking,
          update_time: r.update_time,
          nominal: r.nominal,
          balance_before: r.balance_before,
          balance_after: r.balance_after,
          withdrawal_fee: r.withdrawal_fee,
          net_received: r.net_received,
          status: r.status,
          bank_account: r.bank_account,
          reference_no: r.reference_no,
          rejection_reason: r.rejection_reason,
          create_time: r.create_time,
          complete_time: r.complete_time,
        })),
        p_file_name: f.name,
        p_file_size_bytes: f.size,
      })
      if (error) throw error
      const result = Array.isArray(data) ? data[0] : data
      setPreviewResult(result as CashflowPreviewResult)
      setStep('preview')
      toast.success(
        `Preview siap: ${result?.total_rows ?? 0} baris ` +
        `(${result?.cod_matched_count ?? 0} match, ${result?.cod_variance_count ?? 0} variance, ` +
        `${result?.cod_unmatched_count ?? 0} unmatch, ${result?.withdrawal_count ?? 0} penarikan)`
      )
    } catch (err) {
      const msg = getErrorMessage(err)
      toast.error('Gagal preview', { description: msg })
    } finally {
      setUploading(false)
    }
  }, [])

  const handleApply = async () => {
    if (!previewResult) return
    const wTotal = previewResult.withdrawal_count
    const codTotal = previewResult.cod_matched_count + previewResult.cod_variance_count
    if (!confirm(
      `KONFIRMASI: apply batch #${previewResult.batch_id}?\n\n` +
      `${codTotal} order COD akan ke-update (payout_amount + cod_settled_at).\n` +
      `${wTotal} penarikan akan masuk ke bank_withdrawals.\n` +
      `${previewResult.cod_unmatched_count} unmatched akan masuk inbox_unmatched_resi.\n\n` +
      `Lanjutkan?`
    )) return

    setApplying(true)
    setStep('applying')
    try {
      const { data, error } = await supabase.rpc('apply_spx_cashflow_recon', { p_batch_id: previewResult.batch_id })
      if (error) throw error
      const result = Array.isArray(data) ? data[0] : data
      setApplyResult(result as CashflowApplyResult)
      setStep('done')
      toast.success(
        `Applied! ${result?.cod_updated ?? 0} COD updated, ` +
        `${result?.withdrawals_created ?? 0} penarikan inserted, ` +
        `${result?.unmatched_to_inbox ?? 0} unmatched logged`
      )
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
    const payload = data.preview_payload || {}
    setPreviewResult({
      batch_id: data.id,
      total_rows: data.total_rows,
      cod_matched_count: data.matched_count,
      cod_unmatched_count: data.unmatched_count,
      cod_variance_count: data.variance_count,
      withdrawal_count: Number(payload.withdrawal_count || 0),
      duplicate_count: Number((payload.duplicates || []).length || 0),
      total_cod_amount: Number(data.total_payout_applied || 0),
      total_withdrawal_amount: Number(payload.total_withdrawal_amount || 0),
      preview_data: payload,
    })
    setStep('preview')
    toast.success(`Resumed batch #${batchId}`)
  }

  if (!canManage) {
    return (
      <div className="space-y-6">
        <PageHeader icon={Wallet} title="SPX Cashflow Harian" />
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          Hanya owner/admin/akunting yang bisa mengelola cashflow reconciliation.
        </CardContent></Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Wallet}
        title="SPX Cashflow Harian"
        description="Upload file Account Transaction List dari Shopee Seller Center → preview COD + penarikan → klik Apply untuk update payout + record withdrawals."
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
              <div className="font-medium">Upload File Account Transaction List</div>
              <div className="text-xs text-muted-foreground">
                Format: .xlsx dari SPX Seller Center → Saldo → Riwayat Transaksi → Export. Header di row 1.
              </div>
            </div>
            <label className="block">
              <div className={`relative border-2 border-dashed rounded-lg p-8 text-center transition-colors
                ${uploading ? 'bg-violet-500/5 border-violet-500/40' : 'border-border hover:bg-muted/30 cursor-pointer'}`}>
                {uploading ? (
                  <>
                    <Loader2 className="w-8 h-8 animate-spin mx-auto text-violet-500" />
                    <div className="text-sm font-medium mt-2">Memproses {file?.name}...</div>
                    <div className="text-xs text-muted-foreground mt-1">Parsing XLSX + categorize COD/withdrawals/duplicates</div>
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
              <div className="font-medium text-foreground">2 tipe transaksi yang di-process:</div>
              <div>• <strong>COD</strong> → match ke <code>orders.resi</code> via Tracking Number, set <code>payout_amount</code> + <code>cod_settled_at</code></div>
              <div>• <strong>Penarikan</strong> → insert ke <code>bank_withdrawals</code> dengan dedupe via <code>external_id</code> unique index</div>
              <div className="text-muted-foreground/80 italic mt-1">
                Penarikan dengan status &ne; Berhasil (Ditolak/Pending) di-skip oleh parser.
              </div>
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
            <div className="text-sm font-medium">Applying cashflow batch ke database...</div>
            <p className="text-xs text-muted-foreground">UPDATE orders + INSERT bank_withdrawals + INSERT inbox. Jangan tutup tab.</p>
          </CardContent>
        </Card>
      )}

      {step === 'done' && applyResult && previewResult && (
        <DoneSection apply={applyResult} preview={previewResult} onReset={reset} />
      )}

      <CashflowHistory onResume={resumePreview} />
    </div>
  )
}

// =============================================================
// Preview section — 4 tabs (Matched / Variance / Unmatched / Withdrawals)
// =============================================================
function PreviewSection({
  result,
  onApply,
  onCancel,
}: {
  result: CashflowPreviewResult
  onApply: () => void
  onCancel: () => void
}) {
  const { preview_data } = result
  const totalApplyable = result.cod_matched_count + result.cod_variance_count + result.withdrawal_count
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Stat label="Total Rows" value={result.total_rows} color="violet" />
        <Stat label="COD Matched" value={result.cod_matched_count} color="emerald" />
        <Stat label="Variance" value={result.cod_variance_count} color="amber" />
        <Stat label="Unmatched" value={result.cod_unmatched_count} color="red" />
        <Stat label="Withdrawals" value={result.withdrawal_count} color="blue" />
      </div>

      <Card>
        <CardContent className="pt-4 pb-4 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Total COD Masuk</div>
              <div className="text-lg font-bold tabular-nums text-emerald-600">{formatRupiah(Number(result.total_cod_amount))}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Total Penarikan</div>
              <div className="text-lg font-bold tabular-nums text-blue-600">{formatRupiah(Number(result.total_withdrawal_amount))}</div>
            </div>
          </div>
          {result.duplicate_count > 0 && (
            <div className="text-xs flex items-start gap-1.5 text-amber-600 mt-2">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{result.duplicate_count} row di-skip sebagai duplicate (sudah pernah di-import atau cod_settled_at filled).</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4 pb-4">
          <Tabs defaultValue="matched">
            <TabsList className="grid grid-cols-4 w-full max-w-2xl">
              <TabsTrigger value="matched">
                Matched <Badge variant="outline" className="ml-2 text-[10px]">{result.cod_matched_count}</Badge>
              </TabsTrigger>
              <TabsTrigger value="variance">
                Variance <Badge variant="outline" className="ml-2 text-[10px]">{result.cod_variance_count}</Badge>
              </TabsTrigger>
              <TabsTrigger value="unmatched">
                Unmatched <Badge variant="outline" className="ml-2 text-[10px]">{result.cod_unmatched_count}</Badge>
              </TabsTrigger>
              <TabsTrigger value="withdrawals">
                Penarikan <Badge variant="outline" className="ml-2 text-[10px]">{result.withdrawal_count}</Badge>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="matched" className="pt-3">
              <MatchedTab rows={preview_data?.cod_matched || []} />
            </TabsContent>
            <TabsContent value="variance" className="pt-3">
              <VarianceTab rows={preview_data?.cod_variance || []} />
            </TabsContent>
            <TabsContent value="unmatched" className="pt-3">
              <UnmatchedTab rows={preview_data?.cod_unmatched || []} />
            </TabsContent>
            <TabsContent value="withdrawals" className="pt-3">
              <WithdrawalsTab rows={preview_data?.withdrawals || []} />
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
          disabled={totalApplyable === 0}
          className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white gap-1.5"
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          Apply ke Database ({result.cod_matched_count + result.cod_variance_count} COD + {result.withdrawal_count} penarikan)
          <ArrowRight className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  )
}

function DoneSection({
  apply,
  preview,
  onReset,
}: {
  apply: CashflowApplyResult
  preview: CashflowPreviewResult
  onReset: () => void
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4 space-y-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-6 h-6 text-emerald-500" />
          <h3 className="text-lg font-bold">Cashflow reconciliation berhasil diterapkan</h3>
        </div>
        <div className="text-xs text-muted-foreground">
          Batch #{apply.batch_id} APPLIED · {apply.cod_updated} COD updated, {apply.withdrawals_created} penarikan inserted, {apply.unmatched_to_inbox} unmatched ke inbox.
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
          <Stat label="COD updated" value={apply.cod_updated} color="emerald" />
          <Stat label="Penarikan" value={apply.withdrawals_created} color="blue" />
          <Stat label="Unmatched logged" value={apply.unmatched_to_inbox} color="red" />
          <Stat label="Total COD" value={Number(preview.total_cod_amount)} color="violet" rupiah />
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          <Button variant="outline" onClick={onReset}>Upload Lagi</Button>
          {apply.unmatched_to_inbox > 0 && (
            <a
              href="/inbox/unmatched-resi"
              className="inline-flex items-center justify-center rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground px-3 py-1.5 text-sm"
            >
              Buka Inbox Unmatched Resi ({apply.unmatched_to_inbox})
            </a>
          )}
          <a
            href="/dashboard"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground px-3 py-1.5 text-sm gap-1.5"
          >
            <Banknote className="w-3.5 h-3.5" /> Lihat Saldo di Dashboard
          </a>
        </div>
      </CardContent>
    </Card>
  )
}

function Stat({
  label, value, color, rupiah,
}: { label: string; value: number; color: 'emerald' | 'red' | 'amber' | 'violet' | 'blue'; rupiah?: boolean }) {
  const colorMap = {
    emerald: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600',
    red: 'bg-red-500/10 border-red-500/30 text-red-600',
    amber: 'bg-amber-500/10 border-amber-500/30 text-amber-600',
    violet: 'bg-violet-500/10 border-violet-500/30 text-violet-600',
    blue: 'bg-blue-500/10 border-blue-500/30 text-blue-600',
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
function MatchedTab({ rows }: { rows: CashflowCodMatchedRow[] }) {
  if (rows.length === 0) return <EmptyTab message="Tidak ada matched COD rows" />
  return (
    <div className="border rounded-md overflow-hidden max-h-[500px] overflow-y-auto">
      <Table>
        <TableHeader className="sticky top-0 bg-background">
          <TableRow>
            <TableHead className="text-xs">Tracking</TableHead>
            <TableHead className="text-xs">Order #</TableHead>
            <TableHead className="text-xs">Customer</TableHead>
            <TableHead className="text-xs text-right">Old Payout</TableHead>
            <TableHead className="text-xs text-right">New Payout</TableHead>
            <TableHead className="text-xs">Complete Time</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={`${r.tracking}-${i}`}>
              <TableCell className="text-xs font-mono">{r.tracking}</TableCell>
              <TableCell className="text-xs font-mono text-violet-500">{r.order_number}</TableCell>
              <TableCell className="text-xs">{r.customer_name}</TableCell>
              <TableCell className="text-xs text-right tabular-nums text-muted-foreground">
                {r.old_payout != null ? formatRupiah(Number(r.old_payout)) : <span className="italic">—</span>}
              </TableCell>
              <TableCell className="text-xs text-right tabular-nums font-medium">{formatRupiah(Number(r.new_payout))}</TableCell>
              <TableCell className="text-xs whitespace-nowrap">{formatDate(r.complete_time)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function VarianceTab({ rows }: { rows: CashflowCodVarianceRow[] }) {
  if (rows.length === 0) return <EmptyTab message="Tidak ada variance — semua COD konsisten dengan existing payout_amount" />
  return (
    <div className="space-y-2">
      <div className="text-xs text-amber-600 flex items-start gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>
          Order ini sudah punya <code>payout_amount</code> tapi BEDA dari nominal Account Transaction &gt; Rp 100.
          File SPX authoritative — apply akan overwrite + flag di internal_note.
        </span>
      </div>
      <div className="border rounded-md overflow-hidden max-h-[500px] overflow-y-auto">
        <Table>
          <TableHeader className="sticky top-0 bg-background">
            <TableRow>
              <TableHead className="text-xs">Tracking</TableHead>
              <TableHead className="text-xs">Order #</TableHead>
              <TableHead className="text-xs">Customer</TableHead>
              <TableHead className="text-xs text-right">Old Payout</TableHead>
              <TableHead className="text-xs text-right">New Payout</TableHead>
              <TableHead className="text-xs text-right">Diff</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={`${r.tracking}-${i}`}>
                <TableCell className="text-xs font-mono">{r.tracking}</TableCell>
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

function UnmatchedTab({ rows }: { rows: CashflowCodUnmatchedRow[] }) {
  if (rows.length === 0) return <EmptyTab message="Tidak ada unmatched — semua tracking ketemu di orders" />
  return (
    <div className="space-y-2">
      <div className="text-xs text-red-600 flex items-start gap-1.5">
        <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>
          Tracking di Account Transaction TIDAK ada di tabel orders. Apply akan log ke <code>inbox_unmatched_resi</code>.
        </span>
      </div>
      <div className="border rounded-md overflow-hidden max-h-[500px] overflow-y-auto">
        <Table>
          <TableHeader className="sticky top-0 bg-background">
            <TableRow>
              <TableHead className="text-xs">Tracking</TableHead>
              <TableHead className="text-xs">Reason</TableHead>
              <TableHead className="text-xs text-right">Nominal</TableHead>
              <TableHead className="text-xs">Complete Time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={`${r.tracking || 'empty'}-${i}`}>
                <TableCell className="text-xs font-mono">{r.tracking || <span className="italic text-muted-foreground">(empty)</span>}</TableCell>
                <TableCell className="text-xs">
                  <Badge variant="outline" className="text-[10px] bg-red-500/10 text-red-600">
                    {r.reason}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-right tabular-nums">{formatRupiah(Number(r.nominal))}</TableCell>
                <TableCell className="text-xs whitespace-nowrap">{formatDate(r.complete_time)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function WithdrawalsTab({ rows }: { rows: CashflowWithdrawalRow[] }) {
  if (rows.length === 0) return <EmptyTab message="Tidak ada penarikan di file ini" />
  return (
    <div className="space-y-2">
      <div className="text-xs text-blue-600 flex items-start gap-1.5">
        <Banknote className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>
          Penarikan akan di-insert ke <code>bank_withdrawals</code> dengan dedupe via <code>external_id</code>.
        </span>
      </div>
      <div className="border rounded-md overflow-hidden max-h-[500px] overflow-y-auto">
        <Table>
          <TableHeader className="sticky top-0 bg-background">
            <TableRow>
              <TableHead className="text-xs">External ID</TableHead>
              <TableHead className="text-xs">Bank</TableHead>
              <TableHead className="text-xs text-right">Amount</TableHead>
              <TableHead className="text-xs text-right">Fee</TableHead>
              <TableHead className="text-xs text-right">Net</TableHead>
              <TableHead className="text-xs text-right">Saldo Sesudah</TableHead>
              <TableHead className="text-xs">Complete Time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={`${r.external_id}-${i}`}>
                <TableCell className="text-xs font-mono">{r.external_id}</TableCell>
                <TableCell className="text-xs">{r.bank_account || <span className="italic text-muted-foreground">—</span>}</TableCell>
                <TableCell className="text-xs text-right tabular-nums font-medium">{formatRupiah(Number(r.amount))}</TableCell>
                <TableCell className="text-xs text-right tabular-nums text-muted-foreground">{formatRupiah(Number(r.fee))}</TableCell>
                <TableCell className="text-xs text-right tabular-nums">{formatRupiah(Number(r.net_received))}</TableCell>
                <TableCell className="text-xs text-right tabular-nums text-emerald-600">{formatRupiah(Number(r.balance_after))}</TableCell>
                <TableCell className="text-xs whitespace-nowrap">{formatDate(r.complete_time)}</TableCell>
              </TableRow>
            ))}
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

function formatDate(iso: string): string {
  if (!iso) return '—'
  try { return format(parseISO(iso), 'dd MMM HH:mm', { locale: localeId }) }
  catch { return iso }
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
