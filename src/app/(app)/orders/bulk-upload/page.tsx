'use client'
import { useState, useEffect } from 'react'
import { getErrorMessage } from '@/lib/errors'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import {
  Upload, ArrowRight, ArrowLeft, Loader2,
  CheckCircle2, AlertTriangle, Eye, RotateCcw,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { PageTabs } from '@/components/ui/page-tabs'
import { canCreateOrders, canApproveOrders } from '@/lib/auth/permissions'

const INPUT_TABS = [
  { label: 'Ketik Manual', href: '/orders/new' },
  { label: 'Upload CSV', href: '/orders/bulk-upload' },
  { label: 'Tempel WA', href: '/orders/wa-paste' },
]
import { previewParse, type PreviewResult } from '@/lib/converter/preview'
import { ingestInbound, type IngestResult } from '@/lib/converter/engine'
import { TARGET_TABLE_BADGE_COLOR } from '@/lib/schemas/settings'
import type {
  ConverterProfile,
  ConverterFieldMapping,
  ConverterValueMapping,
} from '@/lib/types'

const supabase = createClient()

type StepKey = 'profile' | 'file' | 'preview' | 'execute' | 'done'

export default function BulkUploadPage() {
  const router = useRouter()
  const { profile: userProfile, role, user } = useAuth()
  const canCreate = canCreateOrders(role)
  const canApprove = canApproveOrders(role)

  const [step, setStep] = useState<StepKey>('profile')
  const [profiles, setProfiles] = useState<ConverterProfile[]>([])
  const [loading, setLoading] = useState(true)

  const [selectedProfileId, setSelectedProfileId] = useState<string>('')
  const [profileDetail, setProfileDetail] = useState<{
    profile: ConverterProfile
    fieldMappings: ConverterFieldMapping[]
    valueMappings: ConverterValueMapping[]
  } | null>(null)

  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [skipReview, setSkipReview] = useState(true)

  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [result, setResult] = useState<IngestResult | null>(null)
  const [showErrorDetail, setShowErrorDetail] = useState(false)
  // Phase 8H-1: CSV phone scientific notation pre-check
  const [csvPhoneIssue, setCsvPhoneIssue] = useState<{ count: number } | null>(null)

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('converter_profiles')
        .select('*')
        .eq('active', true)
        .eq('direction', 'INBOUND_ORDER')
        .order('code')
      setProfiles((data || []) as ConverterProfile[])
      setLoading(false)
    }
    load()
  }, [])

  const loadProfileDetail = async (id: number) => {
    const [{ data: p }, { data: fms }, { data: vms }] = await Promise.all([
      supabase.from('converter_profiles').select('*').eq('id', id).single(),
      supabase
        .from('converter_field_mappings')
        .select('*')
        .eq('profile_id', id)
        .order('display_order'),
      supabase.from('converter_value_mappings').select('*').eq('profile_id', id),
    ])
    if (!p) {
      toast.error('Profile tidak ditemukan')
      return null
    }
    return {
      profile: p as ConverterProfile,
      fieldMappings: (fms || []) as ConverterFieldMapping[],
      valueMappings: (vms || []) as ConverterValueMapping[],
    }
  }

  const goToFileStep = async () => {
    if (!selectedProfileId) return
    const detail = await loadProfileDetail(Number(selectedProfileId))
    if (!detail) return
    setProfileDetail(detail)
    setStep('file')
  }

  const goToPreview = async () => {
    if (!file || !profileDetail) return
    setPreviewLoading(true)
    setCsvPhoneIssue(null)
    try {
      // Phase 8H-1: CSV phone scientific notation pre-check.
      // Excel auto-convert phone integer panjang jadi "6.28781E+12" saat
      // open CSV → data corrupt irreversibly. Refuse preview kalau detected;
      // suggest user re-export sebagai XLSX (preserves integer precision).
      if (profileDetail.profile.file_format === 'CSV') {
        const text = await file.text()
        const sciMatches = text.match(/\b\d+(?:\.\d+)?[eE][+-]?\d+\b/g)
        if (sciMatches && sciMatches.length > 0) {
          setCsvPhoneIssue({ count: sciMatches.length })
          toast.error('CSV phone corrupt', {
            description: `${sciMatches.length} nomor scientific notation terdeteksi. Re-export Orderonline sebagai XLSX.`,
          })
          setPreviewLoading(false)
          return
        }
      }

      const r = await previewParse(
        profileDetail.profile,
        profileDetail.fieldMappings,
        profileDetail.valueMappings,
        file,
        5
      )
      setPreview(r)
      setStep('preview')
    } catch (err: any) {
      toast.error('Gagal preview', { description: getErrorMessage(err) })
    } finally {
      setPreviewLoading(false)
    }
  }

  const startIngest = async () => {
    if (!file || !profileDetail || !user) return
    setStep('execute')
    setProgress({ done: 0, total: preview?.totalRowsDetected || 0 })
    try {
      const initialStatus = canApprove && skipReview ? 'SIAP_KIRIM' : 'BARU'
      const orgId = userProfile?.organization_id || 1
      const r = await ingestInbound({
        profile: profileDetail.profile,
        fieldMappings: profileDetail.fieldMappings,
        valueMappings: profileDetail.valueMappings,
        fileOrText: file,
        initialStatus,
        organizationId: orgId,
        createdBy: user.id,
        supabase,
        onProgress: (done, total) => setProgress({ done, total }),
        // Phase 8H — bulk upload manual = workspace pre-resi
        targetDraft: true,
      })
      setResult(r)
      setStep('done')
      if (r.errors.length === 0 && r.inserted > 0) {
        toast.success(`Berhasil import ${r.inserted} order`)
      } else if (r.errors.length > 0) {
        toast.error(`Selesai dengan ${r.errors.length} error`)
      }
    } catch (err: any) {
      toast.error('Gagal import', { description: getErrorMessage(err) })
      setStep('preview')
    }
  }

  const reset = () => {
    setStep('profile')
    setSelectedProfileId('')
    setProfileDetail(null)
    setFile(null)
    setPreview(null)
    setResult(null)
    setShowErrorDetail(false)
    setCsvPhoneIssue(null)
  }

  if (!canCreate) {
    return (
      <div className="space-y-6">
        <PageHeader icon={Upload} title="Upload Massal" />
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          Role kamu tidak diizinkan upload order.
        </CardContent></Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageTabs items={INPUT_TABS} />
      <PageHeader
        icon={Upload}
        title="Upload Massal"
        description="Import order dari file CSV/XLSX. File akan diparse pakai converter profile yang dipilih."
        actions={
          step !== 'profile' ? (
            <Button variant="outline" size="sm" onClick={reset}>
              <RotateCcw className="w-3.5 h-3.5 mr-1" />Mulai Ulang
            </Button>
          ) : null
        }
      />
      <StepIndicator current={step} />

      {step === 'profile' && (
        <Card>
          <CardContent className="pt-4 pb-4 space-y-4">
            <div className="space-y-2">
              <Label className="text-sm">Pilih Profile *</Label>
              <Select value={selectedProfileId} onValueChange={(v) => v && setSelectedProfileId(v)}>
                <SelectTrigger className="w-full max-w-md">
                  <SelectValue placeholder={loading ? 'Loading...' : 'Pilih converter profile'}>
                    {(value: string | null) => {
                      if (!value) return loading ? 'Loading...' : 'Pilih converter profile'
                      const p = profiles.find((x) => String(x.id) === value)
                      return p ? `${p.name} (${p.code})` : value
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="w-[420px]">
                  {profiles.length === 0 ? (
                    <SelectItem value="none" disabled>Tidak ada profile aktif</SelectItem>
                  ) : profiles.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name} ({p.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Profile menentukan format file + cara terjemahkan kolom ke struktur Grandbook.
                Bikin profile baru di <Link href="/settings/converter-profiles" className="text-zinc-400 hover:underline">Settings → Converter Profiles</Link>.
              </p>
            </div>
            <div className="flex justify-end">
              <Button
                onClick={goToFileStep}
                disabled={!selectedProfileId}
                className="bg-gradient-to-r from-zinc-600 to-zinc-600 hover:from-zinc-700 hover:to-zinc-700 text-white"
              >
                Lanjut <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'file' && profileDetail && (
        <Card>
          <CardContent className="pt-4 pb-4 space-y-4">
            <div className="text-xs text-muted-foreground space-y-1">
              <div>Profile: <span className="font-medium text-foreground">{profileDetail.profile.name}</span></div>
              <div>
                Format: {profileDetail.profile.file_format}
                {profileDetail.profile.file_format === 'CSV' && profileDetail.profile.file_delimiter && ` (delimiter "${profileDetail.profile.file_delimiter}")`}
              </div>
              <div>{profileDetail.fieldMappings.length} field mappings, {profileDetail.valueMappings.length} value mappings</div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm">Pilih File *</Label>
              <input
                type="file"
                accept={profileDetail.profile.file_format === 'CSV' ? '.csv,text/csv' : '.xlsx,.xls'}
                onChange={(e) => { setFile(e.target.files?.[0] || null); setCsvPhoneIssue(null) }}
                className="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-zinc-500/10 file:text-zinc-500 hover:file:bg-zinc-500/20"
              />
              {file && (
                <p className="text-xs text-muted-foreground">
                  {file.name} ({Math.round(file.size / 1024)} KB)
                </p>
              )}
            </div>
            {csvPhoneIssue && (
              <div className="text-xs space-y-2 p-3 rounded bg-red-500/10 border border-red-500/20 text-red-600">
                <div className="font-semibold flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" /> Phone Corrupt — Re-upload XLSX
                </div>
                <div>
                  {csvPhoneIssue.count} nomor telepon terdeteksi dalam format scientific notation
                  (mis. <code className="px-1 py-0.5 bg-red-500/10 rounded">6.28781E+12</code>).
                  Ini terjadi karena Excel auto-convert integer panjang saat buka CSV →
                  presisi hilang permanen, data tidak bisa di-recover.
                </div>
                <div>
                  <span className="font-semibold">Fix:</span> Re-export dari Orderonline dashboard
                  pakai format <span className="font-semibold">XLSX</span>, bukan CSV. XLSX preserve
                  integer precision untuk nomor telepon panjang.
                </div>
              </div>
            )}
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep('profile')}>
                <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Kembali
              </Button>
              <Button
                onClick={goToPreview}
                disabled={!file || previewLoading}
                className="bg-gradient-to-r from-zinc-600 to-zinc-600 hover:from-zinc-700 hover:to-zinc-700 text-white"
              >
                {previewLoading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Eye className="w-3.5 h-3.5 mr-1" />}
                Preview
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'preview' && preview && profileDetail && (
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-4 pb-4 space-y-3">
              <div>
                <div className="text-sm font-medium">Preview {preview.rows.length} dari {preview.totalRowsDetected} rows</div>
                <div className="text-xs text-muted-foreground">
                  {preview.warnings.length > 0 && `${preview.warnings.length} warning`}
                  {preview.errors.length > 0 && `, ${preview.errors.length} error`}
                </div>
              </div>

              {preview.errors.length > 0 && (
                <div className="text-xs space-y-1 p-3 rounded bg-red-500/10 border border-red-500/20 text-red-600">
                  <div className="font-semibold flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> Errors
                  </div>
                  {preview.errors.map((e, i) => <div key={i}>• {e}</div>)}
                </div>
              )}
              {preview.warnings.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-amber-600 font-medium">{preview.warnings.length} warnings (klik untuk expand)</summary>
                  <div className="mt-2 space-y-0.5 pl-4 max-h-40 overflow-y-auto">
                    {preview.warnings.map((w, i) => <div key={i} className="text-muted-foreground">• {w}</div>)}
                  </div>
                </details>
              )}

              {preview.rows.map((row, i) => (
                <div key={i} className="border rounded p-3 space-y-2 text-xs">
                  <div className="font-semibold text-muted-foreground">Row {i + 1}</div>
                  {(['orders', 'order_items', 'meta'] as const).map((bucket) => {
                    const data = row[bucket]
                    const keys = Object.keys(data || {})
                    if (keys.length === 0) return null
                    return (
                      <div key={bucket} className="space-y-1">
                        <Badge variant="outline" className={TARGET_TABLE_BADGE_COLOR[bucket]}>
                          {bucket}
                        </Badge>
                        <div className="pl-3 space-y-0.5 font-mono">
                          {keys.map((k) => (
                            <div key={k} className="flex gap-2">
                              <span className="text-muted-foreground">{k}:</span>
                              <span className="break-all">{formatVal(data[k])}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4 pb-4 space-y-3">
              {canApprove ? (
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox checked={skipReview} onCheckedChange={(v) => setSkipReview(v === true)} />
                  <span className="text-sm">
                    Tandai semua sebagai{' '}
                    <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30">SIAP_KIRIM</Badge>
                    {' '}(skip review)
                  </span>
                </label>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Order akan masuk dengan status{' '}
                  <Badge variant="outline" className="bg-zinc-500/10 text-zinc-600 border-zinc-500/30">BARU</Badge>
                  {' '}dan menunggu approval admin.
                </p>
              )}
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep('file')}>
              <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Kembali
            </Button>
            <Button
              onClick={startIngest}
              disabled={preview.totalRowsDetected === 0 || preview.errors.length > 0}
              className="bg-gradient-to-r from-zinc-600 to-zinc-600 hover:from-zinc-700 hover:to-zinc-700 text-white"
            >
              <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
              Lanjutkan Import {preview.totalRowsDetected} order
            </Button>
          </div>
        </div>
      )}

      {step === 'execute' && (
        <Card>
          <CardContent className="pt-8 pb-8 text-center space-y-4">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-zinc-500" />
            <div className="text-sm font-medium">
              Importing {progress.done} / {progress.total} rows...
            </div>
            <div className="w-full max-w-md mx-auto bg-muted rounded-full h-2 overflow-hidden">
              <div
                className="bg-gradient-to-r from-zinc-500 to-zinc-500 h-2 transition-all"
                style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Jangan tutup tab. Engine insert satu per satu untuk safety.
            </p>
          </CardContent>
        </Card>
      )}

      {step === 'done' && result && (
        <Card>
          <CardContent className="pt-4 pb-4 space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-6 h-6 text-emerald-500" />
              <h3 className="text-lg font-bold">Import Selesai</h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <Stat label="berhasil" value={result.inserted} color="emerald" />
              <Stat label="duplicate (skip)" value={result.skipped_duplicates} color="blue" />
              <Stat label="error" value={result.errors.length} color="red" />
              <Stat label="warning" value={result.warnings.length} color="amber" />
            </div>

            {result.errors.length > 0 && (
              <details open={showErrorDetail} onToggle={(e) => setShowErrorDetail((e.currentTarget as HTMLDetailsElement).open)} className="text-xs">
                <summary className="cursor-pointer text-red-600 font-medium">
                  Lihat detail {result.errors.length} error
                </summary>
                <div className="mt-2 space-y-1 max-h-60 overflow-y-auto border rounded p-2">
                  {result.errors.map((e, i) => (
                    <div key={i} className="text-muted-foreground">
                      <span className="text-red-600">Row {e.rowIndex}</span>: {e.reason}
                    </div>
                  ))}
                </div>
              </details>
            )}

            <div className="flex flex-wrap gap-2 pt-2">
              <Button
                onClick={() => router.push('/orders/draft')}
                className="bg-gradient-to-r from-zinc-600 to-zinc-600 hover:from-zinc-700 hover:to-zinc-700 text-white"
              >
                Lihat Antrian Kerja
              </Button>
              <Button variant="outline" onClick={reset}>
                Upload Lagi
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color: 'emerald' | 'blue' | 'red' | 'amber' }) {
  const colorMap: Record<string, string> = {
    emerald: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600',
    blue: 'bg-zinc-500/10 border-zinc-500/30 text-zinc-600',
    red: 'bg-red-500/10 border-red-500/30 text-red-600',
    amber: 'bg-amber-500/10 border-amber-500/30 text-amber-600',
  }
  return (
    <div className={`p-3 rounded border ${colorMap[color]}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

function StepIndicator({ current }: { current: StepKey }) {
  const steps: Array<{ key: StepKey; label: string }> = [
    { key: 'profile', label: '1. Profile' },
    { key: 'file', label: '2. File' },
    { key: 'preview', label: '3. Preview' },
    { key: 'execute', label: '4. Import' },
    { key: 'done', label: '5. Selesai' },
  ]
  const currentIdx = steps.findIndex((s) => s.key === current)
  return (
    <div className="flex items-center gap-1 text-xs flex-wrap">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-1">
          <span className={`px-2 py-1 rounded ${
            i === currentIdx ? 'bg-zinc-500/20 text-zinc-500 font-medium' :
            i < currentIdx ? 'text-muted-foreground' :
            'text-muted-foreground/50'
          }`}>{s.label}</span>
          {i < steps.length - 1 && <ArrowRight className="w-3 h-3 text-muted-foreground/40" />}
        </div>
      ))}
    </div>
  )
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'string') return `"${v}"`
  if (typeof v === 'object') {
    try { return JSON.stringify(v) } catch { return String(v) }
  }
  return String(v)
}
