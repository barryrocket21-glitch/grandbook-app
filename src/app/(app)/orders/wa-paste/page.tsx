'use client'
import { useState, useEffect, useMemo, useCallback } from 'react'
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
  insertAdaptedOrders,
  type AdaptedOrder,
  type AdapterContext,
} from '@/lib/converter/wa-paste-adapter'
import { WaPastePreviewTable } from '@/components/orders/wa-paste-preview-table'
import type { CourierChannel } from '@/lib/types'

const supabase = createClient()

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

  const [step, setStep] = useState<StepKey>('paste')
  const [text, setText] = useState('')
  const [channels, setChannels] = useState<CourierChannel[]>([])
  const [channelId, setChannelId] = useState<string>('')
  const [parseWarnings, setParseWarnings] = useState<string[]>([])
  const [adapted, setAdapted] = useState<AdaptedOrder[]>([])
  const [refData, setRefData] = useState<RefData | null>(null)
  const [insertResult, setInsertResult] = useState<{
    inserted: number
    failed: number
    errors: Array<{ index: number; message: string }>
  } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from('courier_channels').select('*').eq('active', true).order('code')
      const list = (data || []) as CourierChannel[]
      setChannels(list)
      const spx = list.find((c) => c.code === 'SPX_DIRECT')
      if (spx) setChannelId(String(spx.id))
      else if (list[0]) setChannelId(String(list[0].id))
    }
    load()
  }, [])

  const orgId = userProfile?.organization_id ?? 1

  // Preload reference data sekali per session (products + cs profiles).
  // Dipakai utk re-adapt 1 row begitu user edit cell di preview.
  useEffect(() => {
    let cancelled = false
    if (orgId) {
      preloadAdapterData(supabase, orgId).then((data) => {
        if (!cancelled) setRefData(data)
      })
    }
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
    const incomplete = adapted.filter(
      (a) =>
        !a.parsed.nama ||
        !a.parsed.hp ||
        !a.parsed.alamat ||
        !a.parsed.produk ||
        a.parsed.hargaTotal == null ||
        !a.phoneValid ||
        !a.productId, // produk harus match master — kalau cuma teks tanpa match, status incomplete
    ).length
    return { total, matched, validPhone, csMatched, incomplete }
  }, [adapted])

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
      setAdapted(ad)
      setStep('preview')
      if (result.warnings.length > 0) {
        toast.warning(`${result.orders.length} order kebaca dengan ${result.warnings.length} catatan`)
      } else {
        toast.success(`${result.orders.length} order kebaca`)
      }
    } finally {
      setBusy(false)
    }
  }

  // Re-adapt 1 row saat user edit cell. Pakai cached refData + ctx
  // supaya product/CS/phone re-resolve otomatis tanpa round-trip ke DB.
  const handleUpdate = useCallback(
    (index: number, field: keyof ParsedWaOrder, value: string | number | null) => {
      if (!ctx || !refData) return
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
    setAdapted((prev) => prev.filter((_, i) => i !== index))
  }, [])

  async function handleSubmit() {
    if (adapted.length === 0) return
    setStep('submitting')
    const result = await insertAdaptedOrders(supabase, orgId, adapted)
    setInsertResult({ inserted: result.inserted, failed: result.failed, errors: result.errors })
    setStep('done')
    if (result.inserted > 0) toast.success(`${result.inserted} order masuk Antrian Kerja (status BARU)`)
    if (result.failed > 0) toast.error(`${result.failed} order gagal masuk`)
  }

  function reset() {
    setStep('paste')
    setText('')
    setParseWarnings([])
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
      <PageHeader
        icon={MessageSquare}
        title="WA Paste"
        description="Paste teks order dari WhatsApp → parser ekstrak otomatis. Bisa multi-order sekaligus."
        actions={
          step !== 'paste' ? (
            <Button variant="outline" size="sm" onClick={reset}>
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
                className="bg-gradient-to-r from-zinc-600 to-zinc-600 hover:from-zinc-700 hover:to-zinc-700 text-white"
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
            {stats.incomplete > 0 && (
              <>
                <Sep />
                <StatChip label="Belum lengkap" value={stats.incomplete} tone="red" />
              </>
            )}
            <div className="ml-auto">
              <Button
                onClick={handleSubmit}
                disabled={adapted.length === 0}
                size="sm"
                className="bg-gradient-to-r from-zinc-600 to-zinc-600 hover:from-zinc-700 hover:to-zinc-700 text-white"
              >
                <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Submit {adapted.length} Order
              </Button>
            </div>
          </div>

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
            akan masuk <strong>Antrian Kerja</strong> dengan status <strong>BARU</strong>.
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
                onClick={() => router.push('/orders/draft')}
                className="bg-gradient-to-r from-zinc-600 to-zinc-600 hover:from-zinc-700 hover:to-zinc-700 text-white"
              >
                Lihat Antrian Kerja <ArrowRight className="w-3.5 h-3.5 ml-1" />
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
