'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { MessageSquare, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { canCreateOrders, canApproveOrders } from '@/lib/auth/permissions'
import { previewParse, type PreviewResult } from '@/lib/converter/preview'
import { ingestInbound, type IngestResult } from '@/lib/converter/engine'
import { TARGET_TABLE_BADGE_COLOR } from '@/lib/schemas/settings'
import type {
  ConverterProfile,
  ConverterFieldMapping,
  ConverterValueMapping,
} from '@/lib/types'

const supabase = createClient()

export default function WaPastePage() {
  const router = useRouter()
  const { profile: userProfile, role, user } = useAuth()
  const canCreate = canCreateOrders(role)
  const canApprove = canApproveOrders(role)

  const [profiles, setProfiles] = useState<ConverterProfile[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [profileDetail, setProfileDetail] = useState<{
    profile: ConverterProfile
    fieldMappings: ConverterFieldMapping[]
    valueMappings: ConverterValueMapping[]
  } | null>(null)
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [skipReview, setSkipReview] = useState(true)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<IngestResult | null>(null)

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('converter_profiles')
        .select('*')
        .eq('active', true)
        .eq('direction', 'WA_PASTE')
        .order('code')
      setProfiles((data || []) as ConverterProfile[])
    }
    load()
  }, [])

  useEffect(() => {
    if (!selectedProfileId) { setProfileDetail(null); return }
    const id = Number(selectedProfileId)
    const load = async () => {
      const [{ data: p }, { data: fms }, { data: vms }] = await Promise.all([
        supabase.from('converter_profiles').select('*').eq('id', id).single(),
        supabase.from('converter_field_mappings').select('*').eq('profile_id', id).order('display_order'),
        supabase.from('converter_value_mappings').select('*').eq('profile_id', id),
      ])
      if (p) {
        setProfileDetail({
          profile: p as ConverterProfile,
          fieldMappings: (fms || []) as ConverterFieldMapping[],
          valueMappings: (vms || []) as ConverterValueMapping[],
        })
      }
    }
    load()
  }, [selectedProfileId])

  const runPreview = async () => {
    if (!profileDetail || !text.trim()) {
      toast.error('Pilih profile dan paste text dulu')
      return
    }
    setPreviewLoading(true)
    try {
      const r = await previewParse(
        profileDetail.profile,
        profileDetail.fieldMappings,
        profileDetail.valueMappings,
        text,
        20
      )
      setPreview(r)
    } catch (err: any) {
      toast.error('Gagal preview', { description: err.message })
    } finally {
      setPreviewLoading(false)
    }
  }

  const submit = async () => {
    if (!profileDetail || !user || !text.trim()) return
    setRunning(true)
    try {
      const initialStatus = canApprove && skipReview ? 'SIAP_KIRIM' : 'BARU'
      const orgId = userProfile?.organization_id || 1
      const r = await ingestInbound({
        profile: profileDetail.profile,
        fieldMappings: profileDetail.fieldMappings,
        valueMappings: profileDetail.valueMappings,
        fileOrText: text,
        initialStatus,
        organizationId: orgId,
        createdBy: user.id,
        supabase,
        // Phase 8H — WA paste never has resi → workspace pre-resi
        targetDraft: true,
      })
      setResult(r)
      if (r.errors.length === 0 && r.inserted > 0) {
        toast.success(`Berhasil import ${r.inserted} order`)
      } else if (r.errors.length > 0) {
        toast.error(`Selesai dengan ${r.errors.length} error`)
      }
    } catch (err: any) {
      toast.error('Gagal import', { description: err.message })
    } finally {
      setRunning(false)
    }
  }

  if (!canCreate) {
    return (
      <div className="space-y-6">
        <PageHeader icon={MessageSquare} title="WA Paste Order" />
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          Role kamu tidak diizinkan input order.
        </CardContent></Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={MessageSquare}
        title="WA Paste Order"
        description="Paste teks WA chat → engine ekstrak data customer pakai regex profile → batch insert."
      />

      {result ? (
        <Card>
          <CardContent className="pt-4 pb-4 space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-6 h-6 text-emerald-500" />
              <h3 className="text-lg font-bold">Selesai</h3>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="p-3 rounded bg-emerald-500/10 border border-emerald-500/30">
                <div className="text-2xl font-bold text-emerald-600">{result.inserted}</div>
                <div className="text-xs text-muted-foreground">berhasil</div>
              </div>
              <div className="p-3 rounded bg-blue-500/10 border border-blue-500/30">
                <div className="text-2xl font-bold text-blue-600">{result.skipped_duplicates}</div>
                <div className="text-xs text-muted-foreground">duplicate</div>
              </div>
              <div className="p-3 rounded bg-red-500/10 border border-red-500/30">
                <div className="text-2xl font-bold text-red-600">{result.errors.length}</div>
                <div className="text-xs text-muted-foreground">error</div>
              </div>
            </div>
            {result.errors.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-red-600 font-medium">Detail error</summary>
                <div className="mt-2 space-y-1">
                  {result.errors.map((e, i) => <div key={i}>Row {e.rowIndex}: {e.reason}</div>)}
                </div>
              </details>
            )}
            <div className="flex gap-2">
              <Button
                onClick={() => router.push(canApprove && skipReview ? '/orders/list' : '/inbox/pending-review')}
                className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white"
              >
                Lihat Order
              </Button>
              <Button variant="outline" onClick={() => { setResult(null); setPreview(null); setText('') }}>
                Paste Lagi
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="pt-4 pb-4 space-y-3">
              <div className="space-y-2">
                <Label className="text-sm">Profile WA Paste *</Label>
                <Select value={selectedProfileId} onValueChange={(v) => v && setSelectedProfileId(v)}>
                  <SelectTrigger className="w-full max-w-md">
                    <SelectValue placeholder="Pilih profile WA Paste">
                      {(value: string | null) => {
                        if (!value) return 'Pilih profile WA Paste'
                        const p = profiles.find((x) => String(x.id) === value)
                        return p ? `${p.name} (${p.code})` : value
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="w-[420px]">
                    {profiles.length === 0 ? (
                      <SelectItem value="none" disabled>Belum ada profile WA Paste</SelectItem>
                    ) : profiles.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>{p.name} ({p.code})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {profiles.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Bikin profile dengan direction=WA_PASTE di Settings → Converter Profiles dulu.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label className="text-sm">Teks WA Chat</Label>
                <Textarea
                  value={text}
                  onChange={(e) => { setText(e.target.value); setPreview(null) }}
                  rows={14}
                  placeholder={`Bisa paste 1 atau lebih order sekaligus (WA Web copy format ke-detect otomatis):

[21.12, 20/5/2026] Bojo Pertama: (10) CS : Fiaro
KODE ADV : Umo
Produk : 1 Sandal GD F (1pcs)

Nama penerima : Andi Darmawan
No HP : +6281234567890
Alamat Lengkap : Jl. Merdeka No. 10
Kecamatan : Sukmajaya
Kota/Kab : Depok
Provinsi : Jawa Barat

Ongkir : Rp 15.000
Total Bayar : Rp 140.000
Pembayaran : COD

Keterangan : Coklat 40`}
                  className="font-mono text-xs"
                />
                <div className="rounded-md bg-violet-500/5 border border-violet-500/20 p-3 text-xs space-y-1.5">
                  <div className="font-semibold text-violet-600">Format yang ke-recognize (profile wa_paste_keyvalue):</div>
                  <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                    <div>
                      <div className="text-red-500 font-semibold mb-0.5">Wajib (4)</div>
                      <ul className="list-disc list-inside space-y-0.5">
                        <li><code>Nama penerima :</code></li>
                        <li><code>No HP :</code></li>
                        <li><code>Alamat Lengkap :</code></li>
                        <li><code>Produk :</code> &lt;qty&gt; &lt;nama&gt;</li>
                      </ul>
                    </div>
                    <div>
                      <div className="text-emerald-500 font-semibold mb-0.5">Opsional (9)</div>
                      <ul className="list-disc list-inside space-y-0.5">
                        <li><code>(NN) CS :</code> → cs_name</li>
                        <li><code>KODE ADV :</code> → meta</li>
                        <li><code>Kecamatan / Kota/Kab / Provinsi</code></li>
                        <li><code>Ongkir / Total Bayar</code> (Rp 140.000 → 140000)</li>
                        <li><code>Pembayaran :</code> COD / Transfer</li>
                        <li><code>Keterangan :</code></li>
                      </ul>
                    </div>
                  </div>
                  <div className="text-muted-foreground pt-1.5 border-t border-violet-500/20 space-y-0.5">
                    <div>• <strong>Multi-order</strong>: paste WA Web copy dengan multiple <code>[HH.MM, dd/mm/yyyy] Sender:</code> prefix akan ke-split otomatis per order.</div>
                    <div>• <strong>Qty</strong>: leading digit di <code>Produk : 2 Sandal Hitam</code> → qty=2. Default 1.</div>
                    <div>• Urutan field bebas. Masuk ke <strong>Antrian Kerja</strong> setelah import.</div>
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={runPreview}
                  disabled={!profileDetail || !text.trim() || previewLoading}
                  variant="outline"
                >
                  {previewLoading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null}
                  Preview Block
                </Button>
              </div>
            </CardContent>
          </Card>

          {preview && (
            <Card>
              <CardContent className="pt-4 pb-4 space-y-3">
                <div className="text-sm font-medium">
                  {preview.totalRowsDetected} block(s) terdeteksi
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
                    <summary className="cursor-pointer text-amber-600 font-medium">{preview.warnings.length} warnings</summary>
                    <div className="mt-2 space-y-0.5 pl-4 max-h-40 overflow-y-auto">
                      {preview.warnings.map((w, i) => <div key={i} className="text-muted-foreground">• {w}</div>)}
                    </div>
                  </details>
                )}
                {preview.rows.map((row, i) => (
                  <div key={i} className="border rounded p-3 space-y-2 text-xs">
                    <div className="font-semibold text-muted-foreground">Block {i + 1}</div>
                    {(['orders', 'order_items', 'meta'] as const).map((bucket) => {
                      const data = row[bucket]
                      const keys = Object.keys(data || {})
                      if (keys.length === 0) return null
                      return (
                        <div key={bucket} className="space-y-1">
                          <Badge variant="outline" className={TARGET_TABLE_BADGE_COLOR[bucket]}>{bucket}</Badge>
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
                {canApprove && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox checked={skipReview} onCheckedChange={(v) => setSkipReview(v === true)} />
                    <span className="text-sm">
                      Skip review (insert sebagai SIAP_KIRIM)
                    </span>
                  </label>
                )}
                <div className="flex justify-end">
                  <Button
                    onClick={submit}
                    disabled={running || preview.totalRowsDetected === 0 || preview.errors.length > 0}
                    className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white"
                  >
                    {running && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
                    Import {preview.totalRowsDetected} order
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
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
