'use client'
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { MessageSquare, Loader2, CheckCircle2, AlertTriangle, ArrowRight, RotateCcw, Info } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { PageTabs } from '@/components/ui/page-tabs'
import { canCreateOrders } from '@/lib/auth/permissions'

const INPUT_TABS = [
  { label: 'Ketik Manual', href: '/orders/new' },
  { label: 'Upload CSV', href: '/orders/bulk-upload' },
  { label: 'Tempel WA', href: '/orders/wa-paste' },
]
import { parseWaPasteV3, type ParsedWaOrder } from '@/lib/converter/wa-paste-v3'
import {
  adaptOrder,
  preloadAdapterData,
  type AdaptedOrder,
  type AdapterContext,
} from '@/lib/converter/wa-paste-adapter'
import { WaPastePreviewTable } from '@/components/orders/wa-paste-preview-table'
import { addSandboxOrders, findSandboxDuplicateWarnings, isSandboxMode } from '@/lib/sandbox-orders'
import { getWaPasteSubmitBlockers } from '@/lib/converter/wa-paste-submit-guard'
import { detectDuplicatePhones } from '@/lib/converter/wa-paste-phone-dup'
import type { CourierChannel } from '@/lib/types'

import { pendingWaSubmission } from '@/lib/converter/wa-submission-request'

const supabase = createClient()

async function fetchExistingPhones(parsedPhones: string[]) {
  const phones = Array.from(new Set(parsedPhones.map((phone) => phone.trim()).filter(Boolean)))
  if (phones.length === 0) return []

  // Same bounded, organization-scoped RPC as the server endpoint. The browser's
  // normal Auth session is validated by the RPC; failed checks still block preview.
  const { data, error } = await supabase.rpc('operations_existing_phones_today', { p_phones: phones })
  if (error) {
    if (error.code === 'PGRST301' || error.code === 'PGRST303' || error.code === '42501') {
      throw new Error('Sesi atau akses pemeriksaan duplikat tidak valid. Login ulang lalu coba lagi.')
    }
    throw new Error('Pemeriksaan duplikat belum berhasil. Data belum disimpan; coba Parse & Preview lagi.')
  }
  if (!Array.isArray(data) || data.some((phone) => typeof phone !== 'string')) {
    throw new Error('Hasil pemeriksaan duplikat tidak valid. Data belum disimpan; coba lagi.')
  }
  return data.filter(Boolean)
}

async function fetchWaPasteRefData(): Promise<RefData & { channels: CourierChannel[] }> {
  const api = await fetch('/api/orders/wa-paste/ref-data', { cache: 'no-store' })
  if (api.ok) {
    const json = await api.json()
    return {
      channels: (json.channels || []) as CourierChannel[],
      products: json.products || [],
      csProfiles: json.csProfiles || [],
    }
  }

  throw new Error('Data referensi gagal dimuat. Coba lagi setelah login.')
}

async function submitWaPasteOrders(orders: AdaptedOrder[], requestId: string, confirmDuplicate = false) {
  const api = await fetch('/api/orders/wa-paste/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId, confirmDuplicate, orders: orders.map((order) => ({ originalIndex: order.originalIndex, payload: order.payload })) }),
  })
  if (api.ok) return api.json()
  const body = await api.json().catch(() => ({}))
  if (body.code === 'PHONE_DUPLICATE_TODAY') return body
  throw new Error(body.error || 'Pengiriman gagal. Periksa antrian sebelum mencoba lagi.')
}

type StepKey = 'paste' | 'preview' | 'submitting' | 'done'
type RefData = Awaited<ReturnType<typeof preloadAdapterData>>

const SAMPLE_TEXT = `SALE LISA (22)

Produk: Jaring Paranet
Harga: Rp125.000
Ukuran: Ukuran 2 X 3
Ongkir: 10.000

Total: Rp 135.000

Dikirim ke:
Nama: Riko
No HP: +6282123567609
Alamat:
Villa gading harapan
Jln nakula 2 blok bd 10 no 9 rt 06/46 kelurahan bahagia kec babelan
Bekasi
SALE AIS (23)

Produk: MJO Luna
Harga: Rp99.000
Ukuran: 38-39, Warna: Biru
Ongkir: 76.000

Total: Rp173.000

Dikirim ke:
Nama: Suri
No HP: +628218732323
Alamat: Desa Mambu Dusun Pepalan
Kecamatan : Luyo
Kab : Polewali Mandar`

export default function WaPastePage() {
  const router = useRouter()
  const { profile: userProfile, role, user } = useAuth()
  const canCreate = canCreateOrders(role)

  const submittingRef = useRef(false)
  const [step, setStep] = useState<StepKey>('paste')
  const [text, setText] = useState('')
  const [channels, setChannels] = useState<CourierChannel[]>([])
  const [channelId, setChannelId] = useState<string>('')
  const [parseWarnings, setParseWarnings] = useState<string[]>([])
  const [duplicateWarnings, setDuplicateWarnings] = useState<string[]>([])
  const [phoneDupWarnings, setPhoneDupWarnings] = useState<Awaited<ReturnType<typeof detectDuplicatePhones>>>([])
  const [adapted, setAdapted] = useState<AdaptedOrder[]>([])
  const [refData, setRefData] = useState<RefData | null>(null)
  const [insertResult, setInsertResult] = useState<{
    inserted: number
    failed: number
    errors: Array<{ index: number; message: string }>
  } | null>(null)
  const [duplicateConfirmation, setDuplicateConfirmation] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const orgId = userProfile?.organization_id ?? 1

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const data = await fetchWaPasteRefData()
        if (cancelled) return
        const list = data.channels || []
        setChannels(list)
        setRefData({ products: data.products, csProfiles: data.csProfiles })
        const spx = list.find((c) => c.code === 'SPX_DIRECT')
        if (spx) setChannelId(String(spx.id))
        else if (list[0]) setChannelId(String(list[0].id))
      } catch (err) {
        toast.error('Gagal load data master WA Paste', {
          description: err instanceof Error ? err.message : String(err),
        })
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [orgId])

  const ctx: AdapterContext | null = useMemo(() => {
    if (!channelId) return null
    return {
      supabase,
      organizationId: orgId,
      channelId: Number(channelId),
      createdBy: user?.id ?? null,
      initialStatus: 'BARU',
    }
  }, [channelId, orgId, user?.id])

  const stats = useMemo(() => {
    const total = adapted.length
    const matched = adapted.filter((a) => a.productId).length
    const validPhone = adapted.filter((a) => a.phoneValid).length
    const csMatched = adapted.filter((a) => a.csMatched).length
    const attributionMissing = adapted.filter((a) => !a.parsed.atribusiCodeRaw).length
    const incomplete = adapted.filter(
      (a) =>
        !a.parsed.nama ||
        !a.parsed.hp ||
        !a.parsed.alamat ||
        !a.parsed.produk ||
        !a.parsed.atribusiCodeRaw ||
        a.parsed.hargaTotal == null ||
        !a.phoneValid ||
        !a.productId, // produk harus match master — kalau cuma teks tanpa match, status incomplete
    ).length
    return { total, matched, validPhone, csMatched, attributionMissing, incomplete }
  }, [adapted])

  const issueStats = useMemo(() => {
    const total = adapted.length
    const submitBlockers = getWaPasteSubmitBlockers(adapted)
    const csMissing = submitBlockers.filter((b) => b.code === 'NO_CS').length
    const requiredMissing = adapted.filter(
      (a) => !a.parsed.nama || !a.parsed.hp || !a.parsed.alamat || !a.parsed.produk || a.parsed.hargaTotal == null,
    ).length
    const productUnmatched = adapted.filter((a) => !a.productId).length
    const phoneInvalid = adapted.filter((a) => !a.phoneValid).length
    const csUnmatched = adapted.filter((a) => a.parsed.csName && !a.csMatched).length
    const attributionMissing = adapted.filter((a) => !a.parsed.atribusiCodeRaw).length
    const attributionWarnings = adapted.filter((a) => a.warnings.some((w) => w.toLowerCase().includes('atribusi'))).length
    const mustFix = requiredMissing + productUnmatched + phoneInvalid + attributionMissing + submitBlockers.length
    const needCheck = attributionWarnings + parseWarnings.length
    const safe = Math.max(0, total - Math.min(total, mustFix))
    return {
      total,
      mustFix,
      needCheck,
      safe,
      requiredMissing,
      productUnmatched,
      phoneInvalid,
      csMissing,
      csUnmatched,
      submitBlockers,
      attributionMissing,
      attributionWarnings,
      parserWarnings: parseWarnings.length,
    }
  }, [adapted, parseWarnings.length])

  const channelLabel = useMemo(() => {
    const c = channels.find((c) => String(c.id) === channelId)
    if (!c) return '—'
    return c.aggregator ? `${c.code} · ${c.aggregator}` : c.code
  }, [channelId, channels])

  async function handleParse() {
    if (!text.trim()) return toast.error('Paste teks WA dulu')
    if (!channelId) return toast.error('Pilih channel dulu')
    if (!ctx || !refData) return toast.error('Loading data master… coba lagi sebentar')
    setBusy(true)
    try {
      const result = parseWaPasteV3(text)
      if (result.orders.length === 0) {
        toast.error('Gak ada order yang kebaca', {
          description: result.warnings.join('; ') || undefined,
        })
        return
      }
      setParseWarnings(result.warnings)
      const ad = result.orders.map((p, i) => adaptOrder(p, i, ctx, refData))
      const duplicates = isSandboxMode() ? findSandboxDuplicateWarnings(ad).map((d) => d.message) : []
      // Check HP duplikat: dalam batch + vs existing GrandBook (hanya production)
      let phoneDup: Awaited<ReturnType<typeof detectDuplicatePhones>> = []
      if (!isSandboxMode()) {
        const parsedPhones = ad.map((a) => a.parsed.hp)
        const existingDbPhones = await fetchExistingPhones(parsedPhones)
        phoneDup = detectDuplicatePhones({ parsedPhones, existingDbPhones })
      }
      setDuplicateWarnings(duplicates)
      setPhoneDupWarnings(phoneDup)
      setAdapted(ad)
      setStep('preview')
      if (duplicates.length > 0) {
        toast.warning(`${duplicates.length} order kemungkinan duplikat di sandbox`)
      } else if (phoneDup.length > 0) {
        toast.warning(`${phoneDup.length} nomor HP kemungkinan duplikat`)
      } else if (result.warnings.length > 0) {
        toast.warning(`${result.orders.length} order kebaca dengan ${result.warnings.length} catatan`)
      } else {
        toast.success(`${result.orders.length} order kebaca`)
      }
    } catch (error) {
      toast.error('Preview belum berhasil dimuat', { description: error instanceof Error ? error.message : 'Coba lagi setelah koneksi pulih.' })
    } finally {
      setBusy(false)
    }
  }

  // Re-adapt 1 row saat user edit cell. Pakai cached refData + ctx
  // supaya product/CS/phone re-resolve otomatis tanpa round-trip ke DB.
  const handleUpdate = useCallback(
    (index: number, field: keyof ParsedWaOrder, value: string | number | null) => {
      if (!ctx || !refData) return
      setDuplicateConfirmation(null)
      setAdapted((prev) => {
        const cur = prev[index]
        if (!cur) return prev
        const newParsed = { ...cur.parsed, [field]: value as never }
        const re = adaptOrder(newParsed, cur.originalIndex, ctx, refData)
        const next = [...prev]
        next[index] = re
        return next
      })
    },
    [ctx, refData],
  )

  const handleRemove = useCallback((index: number) => {
    setDuplicateConfirmation(null)
    setAdapted((prev) => prev.filter((_, i) => i !== index))
  }, [])

  async function handleSubmit(confirmDuplicate = false) {
    if (adapted.length === 0 || submittingRef.current) return
    const submitBlockers = getWaPasteSubmitBlockers(adapted)
    if (submitBlockers.length > 0) {
      toast.error('CS wajib tampil sebelum submit', {
        description: submitBlockers.slice(0, 3).map((b) => b.message).join('; '),
      })
      return
    }
    if (isSandboxMode()) {
      const inserted = addSandboxOrders(adapted)
      setInsertResult({ inserted: inserted.length, failed: 0, errors: [] })
      setStep('done')
      toast.success(`${inserted.length} order masuk Sandbox Antrian Kirim`)
      return
    }
    if (!user?.id) return toast.error('Login ulang sebelum mengirim order.')
    submittingRef.current = true
    setStep('submitting')
    try {
      const orders = adapted.map(order => ({ originalIndex: order.originalIndex, payload: order.payload }))
      const pending = await pendingWaSubmission(user.id, orders, sessionStorage)
      const result = await submitWaPasteOrders(adapted, pending.requestId, confirmDuplicate)
      if (result.code === 'PHONE_DUPLICATE_TODAY') {
        setDuplicateConfirmation(result.phones)
        setStep('preview')
        return
      }
      setDuplicateConfirmation(null)
      setInsertResult({ inserted: result.inserted, failed: result.failed, errors: result.errors })
      setStep('done')
      // A new deliberate submission may contain identical legitimate orders.
      sessionStorage.removeItem(pending.storageKey)
      if (result.inserted > 0) toast.success(`${result.inserted} order masuk Antrian Kerja (status BARU)`)
    } catch (error) {
      setStep('preview')
      toast.error('Pengiriman belum dikonfirmasi', {
        description: error instanceof Error ? error.message : 'Coba kirim ulang data yang sama.',
      })
    } finally {
      submittingRef.current = false
    }
  }

  function reset() {
    setDuplicateConfirmation(null)
    setStep('paste')
    setText('')
    setParseWarnings([])
    setDuplicateWarnings([])
    setPhoneDupWarnings([])
    setAdapted([])
    setInsertResult(null)
  }

  if (!canCreate) {
    return (
      <div className="space-y-6">
        <PageHeader icon={MessageSquare} title="WA Paste" />
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Hanya owner/admin/cs yang bisa input order via WA Paste.
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageTabs items={INPUT_TABS} />
      {duplicateConfirmation && step === 'preview' && (
        <Card role="alert" className="border-amber-500">
          <CardContent className="p-4 space-y-3">
            <p className="font-medium">Nomor HP sama pada input hari ini (WIB)</p>
            <p className="text-sm">{duplicateConfirmation.join(', ')} muncul dalam batch ini atau sudah tersimpan hari ini. Periksa order sebelum melanjutkan.</p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setDuplicateConfirmation(null)}>Periksa lagi</Button>
              <Button onClick={() => handleSubmit(true)}>Tetap simpan sebagai order baru</Button>
            </div>
          </CardContent>
        </Card>
      )}
      <PageHeader
        icon={MessageSquare}
        title="WA Paste"
        description="Paste teks order dari WhatsApp → parser ekstrak otomatis. Bisa multi-order sekaligus."
        actions={
          step !== 'paste' ? (
            <Button variant="outline" size="sm" onClick={reset} disabled={step === 'submitting'}>
              <RotateCcw className="w-3.5 h-3.5 mr-1" /> Mulai Ulang
            </Button>
          ) : null
        }
      />

      {step === 'paste' && (
        <Card>
          <CardContent className="pt-4 pb-4 space-y-4">
            <div className="flex items-start gap-2 px-3 py-2 rounded-md border bg-muted/30 text-[11px]">
              <Info className="w-3.5 h-3.5 mt-0.5 text-muted-foreground flex-shrink-0" />
              <div className="text-muted-foreground">
                Order masuk ke <strong>Antrian Kerja</strong> dengan status <strong>BARU</strong>. Channel default
                <strong className="mx-1">{channelLabel}</strong>— bisa diubah per-order di Antrian Kerja sebelum cetak resi.
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Paste teks WA di bawah (bisa multi-order sekaligus)</Label>
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste chat WA langsung di sini... Banyak orderan? Tinggal paste semua sekaligus."
                className="font-mono text-xs min-h-[220px]"
              />
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>
                  {text.split('\n').length} baris · {text.length} karakter
                </span>
                <button
                  type="button"
                  onClick={() => setText(SAMPLE_TEXT)}
                  className="text-zinc-500 hover:underline"
                >
                  Isi sample
                </button>
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                onClick={handleParse}
                disabled={!text.trim() || !channelId || busy || !refData}
                className=""
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null}
                Parse & Preview <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'preview' && (
        <div className="space-y-3">
          {/* Sticky stats bar — selalu visible saat scroll banyak order */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 rounded-lg bg-card/95 backdrop-blur border shadow-sm sticky top-0 z-20">
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">Channel:</span>
              <Badge variant="outline" className="text-[10px]">
                {channelLabel}
              </Badge>
            </div>
            <Sep />
            <StatChip label="Order" value={stats.total} tone="violet" />
            <StatChip
              label="Produk match"
              value={`${stats.matched}/${stats.total}`}
              tone={stats.matched === stats.total ? 'emerald' : 'amber'}
            />
            <StatChip
              label="HP valid"
              value={`${stats.validPhone}/${stats.total}`}
              tone={stats.validPhone === stats.total ? 'emerald' : 'amber'}
            />
            <StatChip
              label="CS resolved"
              value={`${stats.csMatched}/${stats.total}`}
              tone={stats.csMatched === stats.total ? 'emerald' : 'amber'}
            />
            {stats.attributionMissing > 0 && (
              <StatChip label="Atribusi kosong" value={stats.attributionMissing} tone="red" />
            )}
            {stats.incomplete > 0 && (
              <>
                <Sep />
                <StatChip label="Belum lengkap" value={stats.incomplete} tone="red" />
              </>
            )}
            <div className="ml-auto">
              <Button
                onClick={() => handleSubmit()}
                disabled={adapted.length === 0 || stats.incomplete > 0 || issueStats.submitBlockers.length > 0}
                size="sm"
                className=""
              >
                <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Submit {adapted.length} Order
              </Button>
            </div>
          </div>

          <IssueSummary stats={issueStats} />

          {issueStats.submitBlockers.length > 0 && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-300">
              <div className="font-semibold mb-1">Submit dikunci: CS wajib tampil dan match user GrandBook.</div>
              <ul className="list-disc pl-4 space-y-0.5">
                {issueStats.submitBlockers.slice(0, 8).map((blocker) => (
                  <li key={`${blocker.code}-${blocker.index}`}>{blocker.message}</li>
                ))}
              </ul>
              {issueStats.submitBlockers.length > 8 && <div className="mt-1">+{issueStats.submitBlockers.length - 8} order lain</div>}
            </div>
          )}

          {duplicateWarnings.length > 0 && (
            <details open className="text-xs rounded-md border border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400">
              <summary className="cursor-pointer px-3 py-2 font-semibold flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> {duplicateWarnings.length} kemungkinan order duplikat
              </summary>
              <div className="px-3 pb-2 space-y-0.5">
                {duplicateWarnings.map((w, i) => (
                  <div key={i}>• {w}</div>
                ))}
              </div>
            </details>
          )}

          {phoneDupWarnings.length > 0 && (
            <details open className="text-xs rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400">
              <summary className="cursor-pointer px-3 py-2 font-semibold flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> {phoneDupWarnings.length} nomor HP duplikat / pernah input
              </summary>
              <div className="px-3 pb-2 space-y-0.5">
                {phoneDupWarnings.map((w, i) => (
                  <div key={`${w.scope}-${w.phone}-${i}`}>• {w.message}</div>
                ))}
              </div>
            </details>
          )}

          {parseWarnings.length > 0 && (
            <details className="text-xs rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400">
              <summary className="cursor-pointer px-3 py-2 font-semibold flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> {parseWarnings.length} parser warning
              </summary>
              <div className="px-3 pb-2 space-y-0.5">
                {parseWarnings.map((w, i) => (
                  <div key={i}>• {w}</div>
                ))}
              </div>
            </details>
          )}

          <p className="text-[11px] text-muted-foreground">
            💡 Cell merah = field wajib kosong. Klik & edit langsung di tabel. Salah baca? Klik × buat hapus order. Order
            akan masuk <strong>{isSandboxMode() ? 'Data Orderan Sandbox' : 'Antrian Kerja'}</strong> dengan status <strong>BARU</strong>.
          </p>

          {adapted.length === 0 ? (
            <Card>
              <CardContent className="pt-6 pb-6 text-center text-sm text-muted-foreground">
                Semua order udah dihapus. Klik &quot;Mulai Ulang&quot; di atas buat paste lagi.
              </CardContent>
            </Card>
          ) : (
            <WaPastePreviewTable orders={adapted} products={refData?.products ?? []} onUpdate={handleUpdate} onRemove={handleRemove} />
          )}
        </div>
      )}

      {step === 'submitting' && (
        <Card>
          <CardContent className="pt-8 pb-8 text-center space-y-3">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-zinc-500" />
            <div className="text-sm">Memasukkan {adapted.length} order ke database...</div>
          </CardContent>
        </Card>
      )}

      {step === 'done' && insertResult && (
        <Card>
          <CardContent className="pt-4 pb-4 space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-6 h-6 text-emerald-500" />
              <h3 className="text-lg font-bold">Selesai</h3>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Berhasil" value={String(insertResult.inserted)} color="emerald" />
              <Stat
                label="Gagal"
                value={String(insertResult.failed)}
                color={insertResult.failed > 0 ? 'red' : 'emerald'}
              />
            </div>
            {insertResult.errors.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-red-600 font-medium">
                  Detail {insertResult.errors.length} error
                </summary>
                <div className="mt-2 space-y-1 max-h-40 overflow-y-auto border rounded p-2">
                  {insertResult.errors.map((e, i) => (
                    <div key={i} className="text-muted-foreground">
                      Row {e.index + 1}: {e.message}
                    </div>
                  ))}
                </div>
              </details>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                onClick={() => router.push(isSandboxMode() ? '/orders/sandbox' : '/orders/draft')}
                className=""
              >
                {isSandboxMode() ? 'Lihat Antrian Sandbox' : 'Lihat Antrian Kerja'} <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Button>
              <Button variant="outline" onClick={() => router.push('/orders/export-resi')}>
                Export ke Ekspedisi
              </Button>
              <Button variant="outline" onClick={reset}>
                Paste Lagi
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Sep() {
  return <span className="text-muted-foreground/30 select-none">|</span>
}

function StatChip({
  label,
  value,
  tone,
}: {
  label: string
  value: string | number
  tone: 'emerald' | 'red' | 'amber' | 'violet'
}) {
  const toneMap: Record<string, string> = {
    emerald: 'text-emerald-700 dark:text-emerald-300 bg-emerald-500/10',
    red: 'text-red-700 dark:text-red-300 bg-red-500/10',
    amber: 'text-amber-700 dark:text-amber-300 bg-amber-500/10',
    violet: 'text-zinc-700 dark:text-zinc-300 bg-zinc-500/10',
  }
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">{label}:</span>
      <span className={`px-1.5 py-0.5 rounded font-semibold text-[10px] tabular-nums ${toneMap[tone]}`}>{value}</span>
    </div>
  )
}

function Stat({
  label,
  value,
  color,
}: {
  label: string
  value: string
  color: 'emerald' | 'red' | 'amber' | 'violet'
}) {
  const colorMap: Record<string, string> = {
    emerald: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600',
    red: 'bg-red-500/10 border-red-500/30 text-red-600',
    amber: 'bg-amber-500/10 border-amber-500/30 text-amber-600',
    violet: 'bg-zinc-500/10 border-zinc-500/30 text-zinc-600',
  }
  return (
    <div className={`p-3 rounded border ${colorMap[color]}`}>
      <div className="text-xl font-bold">{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  )
}


function IssueSummary({ stats }: { stats: {
  total: number
  mustFix: number
  needCheck: number
  safe: number
  requiredMissing: number
  productUnmatched: number
  phoneInvalid: number
  csMissing: number
  csUnmatched: number
  submitBlockers: Array<{ code: string; index: number; message: string }>
  attributionMissing: number
  attributionWarnings: number
  parserWarnings: number
} }) {
  if (stats.total === 0) return null
  return (
    <Card>
      <CardContent className="pt-3 pb-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-xs font-semibold">Ringkasan Cek Admin</div>
          <Badge variant="outline" className="bg-red-500/10 text-red-700 dark:text-red-300">Wajib Fix: {stats.mustFix}</Badge>
          <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-300">Perlu Dicek: {stats.needCheck}</Badge>
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">Aman Diproses: {stats.safe}</Badge>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-[11px] text-muted-foreground">
          <IssueLine label="Field wajib kosong" value={stats.requiredMissing} tone={stats.requiredMissing > 0 ? 'red' : 'emerald'} />
          <IssueLine label="Produk belum match master" value={stats.productUnmatched} tone={stats.productUnmatched > 0 ? 'red' : 'emerald'} />
          <IssueLine label="HP invalid/kosong" value={stats.phoneInvalid} tone={stats.phoneInvalid > 0 ? 'red' : 'emerald'} />
          <IssueLine label="CS kosong" value={stats.csMissing} tone={stats.csMissing > 0 ? 'red' : 'emerald'} />
          <IssueLine label="CS belum match" value={stats.csUnmatched} tone={stats.csUnmatched > 0 ? 'red' : 'emerald'} />
          <IssueLine label="Atribusi perlu dicek" value={stats.attributionWarnings} tone={stats.attributionWarnings > 0 ? 'amber' : 'emerald'} />
          <IssueLine label="Parser warning" value={stats.parserWarnings} tone={stats.parserWarnings > 0 ? 'amber' : 'emerald'} />
        </div>
        <p className="text-[10px] text-muted-foreground">
          Tidak mengubah parser atau cara submit — ini cuma ringkasan baca masalah sebelum admin klik Submit Order.
        </p>
      </CardContent>
    </Card>
  )
}

function IssueLine({ label, value, tone }: { label: string; value: number; tone: 'emerald' | 'amber' | 'red' }) {
  const toneClass = tone === 'red'
    ? 'text-red-700 dark:text-red-300'
    : tone === 'amber'
      ? 'text-amber-700 dark:text-amber-300'
      : 'text-emerald-700 dark:text-emerald-300'
  return (
    <div className="flex items-center justify-between rounded border px-2 py-1 bg-muted/20">
      <span>{label}</span>
      <span className={`font-semibold tabular-nums ${toneClass}`}>{value}</span>
    </div>
  )
}
