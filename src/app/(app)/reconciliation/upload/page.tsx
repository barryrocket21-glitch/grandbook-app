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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import {
  Scale, ArrowRight, ArrowLeft, Loader2, CheckCircle2,
  AlertTriangle, Eye, RotateCcw, ChevronRight, XCircle, Inbox,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { canApproveOrders } from '@/lib/auth/permissions'
import { previewRekonsil, type RekonsilPreviewResult } from '@/lib/converter/preview'
import { ingestRekonsil, type RekonsilResult } from '@/lib/converter/engine-rekonsil'
import { STATUS_BADGE_COLOR, STATUS_LABEL } from '@/lib/schemas/settings'
import type {
  ConverterProfile,
  ConverterFieldMapping,
  ConverterValueMapping,
  CourierChannelStatus,
} from '@/lib/types'

const supabase = createClient()

type StepKey = 'profile' | 'file' | 'preview' | 'execute' | 'done'

export default function ReconciliationUploadPage() {
  const router = useRouter()
  const { profile: userProfile, role, user } = useAuth()
  const canApprove = canApproveOrders(role)

  const [step, setStep] = useState<StepKey>('profile')
  const [profiles, setProfiles] = useState<ConverterProfile[]>([])
  const [loading, setLoading] = useState(true)

  const [selectedProfileId, setSelectedProfileId] = useState<string>('')
  const [profileBundle, setProfileBundle] = useState<{
    profile: ConverterProfile
    fieldMappings: ConverterFieldMapping[]
    valueMappings: ConverterValueMapping[]
    statusMappings: CourierChannelStatus[]
  } | null>(null)

  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<RekonsilPreviewResult | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [result, setResult] = useState<RekonsilResult | null>(null)

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('converter_profiles')
        .select('*')
        .eq('active', true)
        .eq('direction', 'INBOUND_REKONSIL')
        .order('code')
      setProfiles((data || []) as ConverterProfile[])
      setLoading(false)
    }
    load()
  }, [])

  const loadBundle = async (id: number) => {
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
    const channelId = (p as ConverterProfile).channel_id
    let statusMappings: CourierChannelStatus[] = []
    if (channelId) {
      const { data: sms } = await supabase
        .from('courier_channel_statuses')
        .select('*')
        .eq('channel_id', channelId)
      statusMappings = (sms || []) as CourierChannelStatus[]
    }
    return {
      profile: p as ConverterProfile,
      fieldMappings: (fms || []) as ConverterFieldMapping[],
      valueMappings: (vms || []) as ConverterValueMapping[],
      statusMappings,
    }
  }

  const goToFileStep = async () => {
    if (!selectedProfileId) return
    const b = await loadBundle(Number(selectedProfileId))
    if (!b) return
    setProfileBundle(b)
    setStep('file')
  }

  const goToPreview = async () => {
    if (!file || !profileBundle) return
    setPreviewLoading(true)
    try {
      const orgId = userProfile?.organization_id || 1
      const r = await previewRekonsil(
        supabase,
        orgId,
        profileBundle.profile,
        profileBundle.fieldMappings,
        profileBundle.valueMappings,
        profileBundle.statusMappings,
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
    if (!file || !profileBundle || !user) return
    setStep('execute')
    setProgress({ done: 0, total: preview?.totalRowsDetected || 0 })
    try {
      const orgId = userProfile?.organization_id || 1
      const r = await ingestRekonsil({
        profile: profileBundle.profile,
        fieldMappings: profileBundle.fieldMappings,
        valueMappings: profileBundle.valueMappings,
        statusMappings: profileBundle.statusMappings,
        fileOrText: file,
        organizationId: orgId,
        performedBy: user.id,
        supabase,
        onProgress: (done, total) => setProgress({ done, total }),
      })
      setResult(r)
      setStep('done')
      if (r.errors.length === 0) toast.success(`Selesai: ${r.matched} match, ${r.inbox_unmatched} unmatched`)
      else toast.error(`Selesai dengan ${r.errors.length} error`)
    } catch (err: any) {
      toast.error('Gagal rekonsil', { description: getErrorMessage(err) })
      setStep('preview')
    }
  }

  const reset = () => {
    setStep('profile')
    setSelectedProfileId('')
    setProfileBundle(null)
    setFile(null)
    setPreview(null)
    setResult(null)
  }

  if (!canApprove) {
    return (
      <div className="space-y-6">
        <PageHeader icon={Scale} title="Upload Rekonsil" />
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          Hanya owner/admin yang bisa upload file rekonsil.
        </CardContent></Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Scale}
        title="Upload File Rekonsil"
        description="Match orders by resi → update status & biaya aktual berdasarkan file dari ekspedisi/agregator."
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
              <Label className="text-sm">Pilih Profile Rekonsil *</Label>
              <Select value={selectedProfileId} onValueChange={(v) => v && setSelectedProfileId(v)}>
                <SelectTrigger className="w-full max-w-md">
                  <SelectValue placeholder={loading ? 'Loading...' : 'Pilih profile rekonsil'}>
                    {(value: string | null) => {
                      if (!value) return loading ? 'Loading...' : 'Pilih profile rekonsil'
                      const p = profiles.find((x) => String(x.id) === value)
                      return p ? `${p.name} (${p.code})` : value
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="w-[420px]">
                  {profiles.length === 0 ? (
                    <SelectItem value="none" disabled>Tidak ada profile rekonsil aktif</SelectItem>
                  ) : profiles.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name} ({p.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Profile rekonsil match order by resi/order#, lalu update status + biaya aktual.
                Bikin/edit profile di <Link href="/settings/converter-profiles" className="text-violet-400 hover:underline">Settings → Converter Profiles</Link>.
              </p>
            </div>
            <div className="flex justify-end">
              <Button
                onClick={goToFileStep}
                disabled={!selectedProfileId}
                className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white"
              >Lanjut <ArrowRight className="w-3.5 h-3.5 ml-1" /></Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'file' && profileBundle && (
        <Card>
          <CardContent className="pt-4 pb-4 space-y-4">
            <div className="text-xs text-muted-foreground space-y-1">
              <div>Profile: <span className="font-medium text-foreground">{profileBundle.profile.name}</span></div>
              <div>Format: {profileBundle.profile.file_format}{profileBundle.profile.file_format === 'CSV' && profileBundle.profile.file_delimiter && ` (delimiter "${profileBundle.profile.file_delimiter}")`}</div>
              <div>Header row: {profileBundle.profile.header_row_index}</div>
              <div>Match by: <code className="bg-muted px-1 rounded">{profileBundle.profile.primary_key_target}</code></div>
              <div>{profileBundle.fieldMappings.length} field mappings, {profileBundle.statusMappings.length} status mappings</div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm">Pilih File *</Label>
              <input
                type="file"
                accept={profileBundle.profile.file_format === 'CSV' ? '.csv,text/csv' : '.xlsx,.xls'}
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-violet-500/10 file:text-violet-500 hover:file:bg-violet-500/20"
              />
              {file && <p className="text-xs text-muted-foreground">{file.name} ({Math.round(file.size / 1024)} KB)</p>}
            </div>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep('profile')}><ArrowLeft className="w-3.5 h-3.5 mr-1" /> Kembali</Button>
              <Button
                onClick={goToPreview}
                disabled={!file || previewLoading}
                className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white"
              >
                {previewLoading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Eye className="w-3.5 h-3.5 mr-1" />}
                Preview
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'preview' && preview && profileBundle && (
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-4 pb-4 space-y-3">
              <div>
                <div className="text-sm font-medium">Preview {preview.rows.length} dari {preview.totalRowsDetected} rows</div>
                <div className="text-xs text-muted-foreground">Engine akan match dengan order existing & update status + biaya.</div>
              </div>
              {preview.errors.length > 0 && (
                <div className="text-xs space-y-1 p-3 rounded bg-red-500/10 border border-red-500/20 text-red-600">
                  <div className="font-semibold flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Errors</div>
                  {preview.errors.map((e, i) => <div key={i}>• {e}</div>)}
                </div>
              )}
              {preview.globalWarnings.length > 0 && (
                <div className="text-xs space-y-1 p-3 rounded bg-amber-500/10 border border-amber-500/20 text-amber-600">
                  {preview.globalWarnings.map((w, i) => <div key={i}>• {w}</div>)}
                </div>
              )}

              {preview.rows.map((row) => (
                <div key={row.rowIndex} className="border rounded p-3 space-y-1.5 text-xs">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-muted-foreground">Row {row.rowIndex}</span>
                    <span className="font-mono">{row.rawResi || '(no key)'}</span>
                  </div>
                  {row.match.found ? (
                    <div className="space-y-1 pl-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                        <span>Found: <span className="font-mono">{row.match.orderNumber}</span> ({row.match.customerName})</span>
                      </div>
                      {row.plannedStatus && row.plannedStatus !== row.match.currentStatus ? (
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-muted-foreground">Status:</span>
                          <Badge variant="outline" className={STATUS_BADGE_COLOR[row.match.currentStatus]}>{STATUS_LABEL[row.match.currentStatus]}</Badge>
                          <ChevronRight className="w-3 h-3 text-muted-foreground" />
                          <Badge variant="outline" className={STATUS_BADGE_COLOR[row.plannedStatus]}>{STATUS_LABEL[row.plannedStatus]}</Badge>
                          <span className="text-[10px] text-muted-foreground">({row.rawStatus})</span>
                        </div>
                      ) : row.plannedStatus ? (
                        <div className="text-muted-foreground">Status: tidak berubah ({STATUS_LABEL[row.plannedStatus]})</div>
                      ) : row.needsInboxUnmapped ? (
                        <div className="flex items-center gap-2 text-amber-600">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          Status raw &quot;{row.rawStatus}&quot; belum di-mapping → masuk inbox unmapped
                        </div>
                      ) : (
                        <div className="text-muted-foreground">Status: tidak ada perubahan (row tidak punya status info)</div>
                      )}
                      {(row.costUpdates.shipping_cost_actual !== undefined ||
                        row.costUpdates.payout_amount !== undefined ||
                        row.costUpdates.cod_amount !== undefined) && (
                        <div className="text-muted-foreground space-x-3">
                          {row.costUpdates.shipping_cost_actual !== undefined && (
                            <span>shipping_cost_actual=<span className="text-foreground">Rp {row.costUpdates.shipping_cost_actual.toLocaleString('id-ID')}</span></span>
                          )}
                          {row.costUpdates.payout_amount !== undefined && (
                            <span>payout=<span className="text-foreground">Rp {row.costUpdates.payout_amount.toLocaleString('id-ID')}</span></span>
                          )}
                          {row.costUpdates.cod_amount !== undefined && (
                            <span>cod=<span className="text-foreground">Rp {row.costUpdates.cod_amount.toLocaleString('id-ID')}</span></span>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 pl-3 text-amber-600">
                      <XCircle className="w-3.5 h-3.5" />
                      Order tidak ditemukan → akan masuk Inbox Unmatched Resi
                    </div>
                  )}
                  {row.warnings.map((w, i) => (
                    <div key={i} className="text-[10px] text-amber-600 pl-3">⚠ {w}</div>
                  ))}
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep('file')}><ArrowLeft className="w-3.5 h-3.5 mr-1" /> Kembali</Button>
            <Button
              onClick={startIngest}
              disabled={preview.totalRowsDetected === 0 || preview.errors.length > 0}
              className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white"
            >
              <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
              Proses {preview.totalRowsDetected} row rekonsil
            </Button>
          </div>
        </div>
      )}

      {step === 'execute' && (
        <Card>
          <CardContent className="pt-8 pb-8 text-center space-y-4">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-violet-500" />
            <div className="text-sm font-medium">Rekonsil {progress.done} / {progress.total} rows...</div>
            <div className="w-full max-w-md mx-auto bg-muted rounded-full h-2 overflow-hidden">
              <div
                className="bg-gradient-to-r from-violet-500 to-indigo-500 h-2 transition-all"
                style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">Per-row update via RPC. Jangan tutup tab.</p>
          </CardContent>
        </Card>
      )}

      {step === 'done' && result && (
        <Card>
          <CardContent className="pt-4 pb-4 space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-6 h-6 text-emerald-500" />
              <h3 className="text-lg font-bold">Rekonsil Selesai</h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-center">
              <Stat label="matched" value={result.matched} color="emerald" />
              <Stat label="status updated" value={result.status_updated} color="blue" />
              <Stat label="cost updated" value={result.cost_updated} color="violet" />
              <Stat label="unmatched" value={result.inbox_unmatched} color="amber" />
              <Stat label="status unmapped" value={result.inbox_unmapped_status} color="amber" />
              <Stat label="error" value={result.errors.length} color="red" />
            </div>

            {result.errors.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-red-600 font-medium">Detail {result.errors.length} error</summary>
                <div className="mt-2 space-y-1 max-h-60 overflow-y-auto border rounded p-2">
                  {result.errors.map((e, i) => (
                    <div key={i} className="text-muted-foreground"><span className="text-red-600">Row {e.rowIndex}</span>: {e.reason}</div>
                  ))}
                </div>
              </details>
            )}
            {result.warnings.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-amber-600 font-medium">{result.warnings.length} warnings</summary>
                <div className="mt-2 space-y-0.5 pl-4 max-h-40 overflow-y-auto">
                  {result.warnings.map((w, i) => (
                    <div key={i} className="text-muted-foreground">Row {w.rowIndex}: {w.message}</div>
                  ))}
                </div>
              </details>
            )}

            <div className="flex flex-wrap gap-2 pt-2">
              {result.inbox_unmatched > 0 && (
                <Button onClick={() => router.push('/inbox/unmatched-resi')} variant="outline">
                  <Inbox className="w-3.5 h-3.5 mr-1" />Lihat Unmatched ({result.inbox_unmatched})
                </Button>
              )}
              {result.inbox_unmapped_status > 0 && (
                <Button onClick={() => router.push('/inbox/unmapped-statuses')} variant="outline">
                  <Inbox className="w-3.5 h-3.5 mr-1" />Lihat Unmapped Status ({result.inbox_unmapped_status})
                </Button>
              )}
              <Button
                onClick={() => router.push('/orders/list')}
                className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white"
              >Lihat Daftar Order</Button>
              <Button variant="outline" onClick={reset}>Upload Lagi</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color: 'emerald' | 'blue' | 'red' | 'amber' | 'violet' }) {
  const colorMap: Record<string, string> = {
    emerald: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600',
    blue: 'bg-blue-500/10 border-blue-500/30 text-blue-600',
    red: 'bg-red-500/10 border-red-500/30 text-red-600',
    amber: 'bg-amber-500/10 border-amber-500/30 text-amber-600',
    violet: 'bg-violet-500/10 border-violet-500/30 text-violet-600',
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
    { key: 'execute', label: '4. Process' },
    { key: 'done', label: '5. Selesai' },
  ]
  const currentIdx = steps.findIndex((s) => s.key === current)
  return (
    <div className="flex items-center gap-1 text-xs flex-wrap">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-1">
          <span className={`px-2 py-1 rounded ${
            i === currentIdx ? 'bg-violet-500/20 text-violet-500 font-medium' :
            i < currentIdx ? 'text-muted-foreground' :
            'text-muted-foreground/50'
          }`}>{s.label}</span>
          {i < steps.length - 1 && <ArrowRight className="w-3 h-3 text-muted-foreground/40" />}
        </div>
      ))}
    </div>
  )
}
