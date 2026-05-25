'use client'
import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { MessageSquare, Loader2, CheckCircle2, AlertTriangle, ArrowRight, RotateCcw } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { canCreateOrders } from '@/lib/auth/permissions'
import { parseWaPasteV3 } from '@/lib/converter/wa-paste-v3'
import { adaptOrders, insertAdaptedOrders, type AdaptedOrder } from '@/lib/converter/wa-paste-adapter'
import type { CourierChannel } from '@/lib/types'

const supabase = createClient()

type StepKey = 'paste' | 'preview' | 'submitting' | 'done'

const SAMPLE_TEXT = `[21.12, 20/5/2026] Bojo Pertama: (10) CS : Lisa
KODE ADV : Umo
Produk : 1 Jaring Paranet (1pcs)

Nama penerima : Andi Darmawan
No HP : +6281234567890
Alamat Lengkap : Jl. Merdeka No. 10, RT 02/RW 03
Kelurahan : Sukamaju
Kecamatan : Sukmajaya
Kota/Kab : Depok
Provinsi : Jawa Barat

Ongkir : Rp 15.000
Total Bayar : Rp 140.000
Pembayaran : COD

Keterangan : Coklat 40`

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
  const [insertResult, setInsertResult] = useState<{ inserted: number; failed: number; errors: Array<{ index: number; message: string }> } | null>(null)

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from('courier_channels').select('*').eq('active', true).order('code')
      const list = (data || []) as CourierChannel[]
      setChannels(list)
      const spx = list.find(c => c.code === 'SPX_DIRECT')
      if (spx) setChannelId(String(spx.id))
      else if (list[0]) setChannelId(String(list[0].id))
    }
    load()
  }, [])

  const orgId = userProfile?.organization_id ?? 1

  const stats = useMemo(() => {
    const matched = adapted.filter(a => a.productId).length
    const validPhone = adapted.filter(a => a.phoneValid).length
    const csMatched = adapted.filter(a => a.csMatched).length
    return { matched, validPhone, csMatched, total: adapted.length }
  }, [adapted])

  async function handleParse() {
    if (!text.trim()) return toast.error('Paste teks WA dulu')
    if (!channelId) return toast.error('Pilih channel dulu')
    const result = parseWaPasteV3(text)
    if (result.orders.length === 0) {
      toast.error('Gak ada order yang kebaca', { description: result.warnings.join('; ') })
      return
    }
    setParseWarnings(result.warnings)
    const ad = await adaptOrders(result.orders, {
      supabase,
      organizationId: orgId,
      channelId: Number(channelId),
      createdBy: user?.id ?? null,
      initialStatus: 'BARU',
    })
    setAdapted(ad)
    setStep('preview')
  }

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
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          Hanya owner/admin/cs yang bisa input order via WA Paste.
        </CardContent></Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={MessageSquare}
        title="WA Paste"
        description="Paste teks order dari WhatsApp → parser ekstrak otomatis nama, alamat, produk, dst. Bisa multi-order sekaligus."
        actions={step !== 'paste' ? (
          <Button variant="outline" size="sm" onClick={reset}>
            <RotateCcw className="w-3.5 h-3.5 mr-1" /> Mulai Ulang
          </Button>
        ) : null}
      />

      {step === 'paste' && (
        <Card>
          <CardContent className="pt-4 pb-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Channel Ekspedisi *</Label>
                <Select value={channelId} onValueChange={(v) => v && setChannelId(v)}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Pilih channel">
                    {(value: string | null) => {
                      if (!value) return 'Pilih channel'
                      return channels.find(c => String(c.id) === value)?.code ?? value
                    }}
                  </SelectValue></SelectTrigger>
                  <SelectContent>
                    {channels.map(c => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.code}{c.aggregator ? ` · ${c.aggregator}` : ''}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">Semua order di paste session ini pakai channel ini.</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Initial Status</Label>
                <div className="h-9 px-3 flex items-center rounded-md border bg-muted/30 text-sm">
                  BARU <Badge variant="outline" className="ml-2 text-[10px]">Perlu approval admin</Badge>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Paste teks WA di bawah (bisa multi-order)</Label>
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste chat WA langsung di sini..."
                className="font-mono text-xs min-h-[280px]"
              />
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>{text.split('\n').length} baris · {text.length} karakter</span>
                <button type="button" onClick={() => setText(SAMPLE_TEXT)} className="text-violet-500 hover:underline">
                  Isi sample
                </button>
              </div>
            </div>

            <div className="flex justify-end">
              <Button onClick={handleParse} disabled={!text.trim() || !channelId} className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white">
                Parse & Preview <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'preview' && (
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-4 pb-4 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                <Stat label="Order terbaca" value={String(stats.total)} color="violet" />
                <Stat label="Produk match" value={`${stats.matched}/${stats.total}`} color={stats.matched === stats.total ? 'emerald' : 'amber'} />
                <Stat label="HP valid" value={`${stats.validPhone}/${stats.total}`} color={stats.validPhone === stats.total ? 'emerald' : 'amber'} />
                <Stat label="CS resolved" value={`${stats.csMatched}/${stats.total}`} color={stats.csMatched === stats.total ? 'emerald' : 'amber'} />
              </div>

              {parseWarnings.length > 0 && (
                <div className="text-xs space-y-1 p-3 rounded bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400">
                  <div className="font-semibold flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Parser warnings</div>
                  {parseWarnings.map((w, i) => <div key={i}>• {w}</div>)}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">#</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>HP</TableHead>
                      <TableHead>Alamat</TableHead>
                      <TableHead>Produk → Match</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>CS</TableHead>
                      <TableHead>Issues</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {adapted.map((a, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                        <TableCell>
                          <div className="text-xs font-medium">{a.parsed.nama || <span className="text-red-500">(kosong)</span>}</div>
                          <div className="text-[10px] text-muted-foreground">{a.parsed.kota ?? ''}{a.parsed.provinsi ? `, ${a.parsed.provinsi}` : ''}</div>
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                          {a.phoneValid ? a.parsed.hp : <span className="text-red-500">{a.parsed.hp} ⚠</span>}
                        </TableCell>
                        <TableCell className="text-[10px] max-w-[200px] truncate" title={a.parsed.alamat}>{a.parsed.alamat}</TableCell>
                        <TableCell className="text-xs">
                          <div className="text-[10px] text-muted-foreground italic">{a.parsed.produk}</div>
                          {a.productMatchedName ? (
                            <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-600">→ {a.productMatchedName}</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] bg-red-500/10 text-red-500">Tidak match</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-xs">{a.parsed.qty}</TableCell>
                        <TableCell className="text-right text-xs whitespace-nowrap">
                          {a.parsed.hargaTotal != null ? `Rp ${a.parsed.hargaTotal.toLocaleString('id-ID')}` : '—'}
                        </TableCell>
                        <TableCell className="text-xs">
                          {a.csMatched ? (
                            <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-600">{a.parsed.csName}</Badge>
                          ) : a.parsed.csName ? (
                            <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-600">{a.parsed.csName} (?)</Badge>
                          ) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-[10px]">
                          {a.warnings.length > 0 ? (
                            <span className="text-amber-600">{a.warnings.length} warn</span>
                          ) : <span className="text-emerald-600">✓</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-between items-center">
            <p className="text-xs text-muted-foreground">
              ✓ Order akan masuk ke <strong>Antrian Kerja</strong> dengan status <strong>BARU</strong>.
              Admin perlu approve di Inbox Pending Review sebelum bisa di-export.
            </p>
            <Button onClick={handleSubmit} disabled={adapted.length === 0} className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white">
              <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Submit {adapted.length} Order
            </Button>
          </div>
        </div>
      )}

      {step === 'submitting' && (
        <Card>
          <CardContent className="pt-8 pb-8 text-center space-y-3">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-violet-500" />
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
              <Stat label="Gagal" value={String(insertResult.failed)} color={insertResult.failed > 0 ? 'red' : 'emerald'} />
            </div>
            {insertResult.errors.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-red-600 font-medium">Detail {insertResult.errors.length} error</summary>
                <div className="mt-2 space-y-1 max-h-40 overflow-y-auto border rounded p-2">
                  {insertResult.errors.map((e, i) => (
                    <div key={i} className="text-muted-foreground">Row {e.index + 1}: {e.message}</div>
                  ))}
                </div>
              </details>
            )}
            <div className="flex gap-2 pt-1">
              <Button onClick={() => router.push('/orders/draft')} className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white">
                Buka Antrian Kerja
              </Button>
              <Button variant="outline" onClick={reset}>Paste Lagi</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color: 'emerald' | 'red' | 'amber' | 'violet' }) {
  const colorMap: Record<string, string> = {
    emerald: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600',
    red: 'bg-red-500/10 border-red-500/30 text-red-600',
    amber: 'bg-amber-500/10 border-amber-500/30 text-amber-600',
    violet: 'bg-violet-500/10 border-violet-500/30 text-violet-600',
  }
  return (
    <div className={`p-3 rounded border ${colorMap[color]}`}>
      <div className="text-xl font-bold">{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  )
}
