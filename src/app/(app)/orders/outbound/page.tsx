'use client'
import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import {
  Truck, ArrowRight, ArrowLeft, Loader2, CheckCircle2,
  AlertTriangle, Eye, RotateCcw, Search, Download, FileSpreadsheet,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { canApproveOrders } from '@/lib/auth/permissions'
import { previewOutbound, type OutboundPreviewResult } from '@/lib/converter/preview'
import {
  buildOutbound,
  generateCsv,
  generateXlsx,
  downloadBlob,
  suggestFilename,
  markOrdersExported,
  type OutboundResult,
} from '@/lib/converter/engine-outbound'
import type {
  ConverterProfile,
  ConverterFieldMapping,
  ConverterValueMapping,
  CourierChannel,
  OrderStatus,
} from '@/lib/types'

const supabase = createClient()

type StepKey = 'profile' | 'orders' | 'preview' | 'generate' | 'done'

interface OrderRow {
  id: number
  order_number: string
  status: OrderStatus
  customer_name: string
  customer_city: string | null
  channel_id: number | null
  total: number
  created_at: string
  channel?: { id: number; code: string }
}

const ELIGIBLE_STATUSES: OrderStatus[] = ['SIAP_KIRIM', 'BARU']

export default function OrdersOutboundPage() {
  const router = useRouter()
  const { profile: userProfile, role } = useAuth()
  const canExport = canApproveOrders(role)

  const [step, setStep] = useState<StepKey>('profile')
  const [profiles, setProfiles] = useState<ConverterProfile[]>([])
  const [loading, setLoading] = useState(true)

  const [selectedProfileId, setSelectedProfileId] = useState<string>('')
  const [profileBundle, setProfileBundle] = useState<{
    profile: ConverterProfile
    fieldMappings: ConverterFieldMapping[]
    valueMappings: ConverterValueMapping[]
    channel: CourierChannel | null
  } | null>(null)

  const [orders, setOrders] = useState<OrderRow[]>([])
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'ELIGIBLE'>('SIAP_KIRIM')
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  const [preview, setPreview] = useState<OutboundPreviewResult | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [result, setResult] = useState<OutboundResult | null>(null)
  const [filename, setFilename] = useState('')
  const [markAsDikirim, setMarkAsDikirim] = useState(false)
  const [markedCount, setMarkedCount] = useState<number | null>(null)
  const [generating, setGenerating] = useState(false)

  // ----- Effects -----
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('converter_profiles')
        .select('*')
        .eq('active', true)
        .eq('direction', 'OUTBOUND_TO_COURIER')
        .order('code')
      setProfiles((data || []) as ConverterProfile[])
      setLoading(false)
    }
    load()
  }, [])

  // ----- Profile bundle loader -----
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
    let channel: CourierChannel | null = null
    const channelId = (p as ConverterProfile).channel_id
    if (channelId) {
      const { data: c } = await supabase
        .from('courier_channels')
        .select('*')
        .eq('id', channelId)
        .maybeSingle()
      channel = (c as CourierChannel) || null
    }
    return {
      profile: p as ConverterProfile,
      fieldMappings: (fms || []) as ConverterFieldMapping[],
      valueMappings: (vms || []) as ConverterValueMapping[],
      channel,
    }
  }

  // ----- Step navigation -----
  const goToOrdersStep = async () => {
    if (!selectedProfileId) return
    const b = await loadBundle(Number(selectedProfileId))
    if (!b) return
    setProfileBundle(b)
    await loadOrders(b.profile.channel_id, statusFilter)
    setStep('orders')
  }

  const loadOrders = async (channelId: number | null, status: OrderStatus | 'ELIGIBLE') => {
    setOrdersLoading(true)
    let q = supabase
      .from('orders')
      .select(
        'id, order_number, status, customer_name, customer_city, channel_id, total, created_at, channel:courier_channels(id, code)'
      )
      .order('created_at', { ascending: false })
      .limit(500)
    if (channelId) q = q.eq('channel_id', channelId)
    if (status === 'ELIGIBLE') q = q.in('status', ELIGIBLE_STATUSES)
    else q = q.eq('status', status)
    const { data } = await q
    setOrders((data as unknown as OrderRow[]) || [])
    setOrdersLoading(false)
  }

  useEffect(() => {
    if (step === 'orders' && profileBundle) {
      loadOrders(profileBundle.profile.channel_id, statusFilter)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter])

  const goToPreview = async () => {
    if (!profileBundle || selectedIds.size === 0) return
    setPreviewLoading(true)
    try {
      const orgId = userProfile?.organization_id || 1
      const ids = Array.from(selectedIds)
      const r = await previewOutbound(
        supabase,
        orgId,
        profileBundle.profile,
        profileBundle.fieldMappings,
        profileBundle.valueMappings,
        ids,
        5
      )
      setPreview(r)
      setStep('preview')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error('Gagal preview', { description: msg })
    } finally {
      setPreviewLoading(false)
    }
  }

  const startGenerate = async () => {
    if (!profileBundle) return
    setGenerating(true)
    setStep('generate')
    setProgress({ done: 0, total: selectedIds.size })
    try {
      const orgId = userProfile?.organization_id || 1
      const ids = Array.from(selectedIds)
      const r = await buildOutbound({
        profile: profileBundle.profile,
        fieldMappings: profileBundle.fieldMappings,
        valueMappings: profileBundle.valueMappings,
        orderIds: ids,
        organizationId: orgId,
        supabase,
        onProgress: (done, total) => setProgress({ done, total }),
      })
      setResult(r)

      // Generate file & download
      const name = suggestFilename(profileBundle.profile)
      setFilename(name)
      if (r.rows.length > 0) {
        const blob =
          profileBundle.profile.file_format === 'XLSX'
            ? generateXlsx(r.rows, r.headers)
            : generateCsv(r.rows, r.headers, profileBundle.profile.file_delimiter || ',')
        downloadBlob(blob, name)
      }

      // Mark orders as DIKIRIM (optional)
      if (markAsDikirim && r.ordersProcessed > 0) {
        const successIds = ids.filter(
          (id) => !r.errors.find((e) => e.orderId === id)
        )
        const note = `Outbound export via ${profileBundle.profile.code} (${name})`
        const { updated, error: rpcErr } = await markOrdersExported(
          supabase,
          successIds,
          'DIKIRIM',
          profileBundle.profile.id,
          note
        )
        if (rpcErr) {
          toast.error('Gagal update status order', { description: rpcErr })
          setMarkedCount(0)
        } else {
          setMarkedCount(updated)
        }
      } else {
        setMarkedCount(null)
      }

      setStep('done')
      if (r.errors.length === 0)
        toast.success(`Selesai: ${r.ordersProcessed} order, file ${name} diunduh`)
      else toast.error(`Selesai dengan ${r.errors.length} error`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error('Gagal generate file', { description: msg })
      setStep('preview')
    } finally {
      setGenerating(false)
    }
  }

  const reset = () => {
    setStep('profile')
    setSelectedProfileId('')
    setProfileBundle(null)
    setOrders([])
    setSelectedIds(new Set())
    setPreview(null)
    setResult(null)
    setMarkedCount(null)
    setMarkAsDikirim(false)
  }

  // ----- Order list selection -----
  const filteredOrders = useMemo(() => {
    if (!search.trim()) return orders
    const q = search.toLowerCase().trim()
    return orders.filter(
      (o) =>
        o.order_number.toLowerCase().includes(q) ||
        o.customer_name.toLowerCase().includes(q) ||
        (o.customer_city || '').toLowerCase().includes(q)
    )
  }, [orders, search])

  const allFilteredSelected =
    filteredOrders.length > 0 && filteredOrders.every((o) => selectedIds.has(o.id))

  const toggleAllFiltered = (checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) for (const o of filteredOrders) next.add(o.id)
      else for (const o of filteredOrders) next.delete(o.id)
      return next
    })
  }

  const toggleOne = (id: number, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  // ----- Render -----
  if (!canExport) {
    return (
      <div className="space-y-6">
        <PageHeader icon={Truck} title="Export Outbound" />
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          Hanya owner/admin yang bisa export order ke ekspedisi.
        </CardContent></Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Truck}
        title="Export Outbound (ke Ekspedisi)"
        description="Pilih profile outbound → pilih order yang siap kirim → preview → unduh file untuk upload ke ekspedisi/agregator."
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
              <Label className="text-sm">Pilih Profile Outbound *</Label>
              <Select
                value={selectedProfileId}
                onValueChange={(v) => v && v !== 'none' && setSelectedProfileId(v)}
              >
                <SelectTrigger className="w-full max-w-md">
                  <SelectValue placeholder={loading ? 'Loading...' : 'Pilih profile outbound'} />
                </SelectTrigger>
                <SelectContent className="w-[420px]">
                  {profiles.length === 0 ? (
                    <SelectItem value="none" disabled>Tidak ada profile outbound aktif</SelectItem>
                  ) : profiles.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name} ({p.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Profile outbound mengkonversi order Grandbook ke format file ekspedisi/agregator.
                Bikin/edit profile di <Link href="/settings/converter-profiles" className="text-violet-400 hover:underline">Settings → Converter Profiles</Link>.
              </p>
            </div>
            <div className="flex justify-end">
              <Button
                onClick={goToOrdersStep}
                disabled={!selectedProfileId}
                className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white"
              >Lanjut <ArrowRight className="w-3.5 h-3.5 ml-1" /></Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'orders' && profileBundle && (
        <div className="space-y-3">
          <Card>
            <CardContent className="pt-4 pb-4 space-y-2">
              <div className="text-xs text-muted-foreground space-y-1">
                <div>Profile: <span className="font-medium text-foreground">{profileBundle.profile.name}</span></div>
                <div>Format file: {profileBundle.profile.file_format}{profileBundle.profile.file_format === 'CSV' && profileBundle.profile.file_delimiter && ` (delimiter "${profileBundle.profile.file_delimiter}")`}</div>
                <div>Channel filter: {profileBundle.channel ? <Badge variant="outline">{profileBundle.channel.code}</Badge> : <span className="italic">tidak dibatasi channel</span>}</div>
                <div>{profileBundle.fieldMappings.filter((f) => f.target_table === 'file_column').length} kolom output</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4 pb-4 space-y-3">
              <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
                <div className="flex-1 min-w-[200px] relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Cari order# / nama customer / kota..."
                    className="pl-9"
                  />
                </div>
                <Select value={statusFilter} onValueChange={(v) => v && setStatusFilter(v as OrderStatus | 'ELIGIBLE')}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SIAP_KIRIM">Siap Kirim (default)</SelectItem>
                    <SelectItem value="BARU">Baru</SelectItem>
                    <SelectItem value="ELIGIBLE">Siap Kirim + Baru</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="text-xs text-muted-foreground flex items-center gap-3">
                <span>{filteredOrders.length} order tampil · {selectedIds.size} dipilih</span>
                {selectedIds.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedIds(new Set())}
                    className="text-violet-500 hover:underline"
                  >Clear pilihan</button>
                )}
              </div>

              {ordersLoading ? (
                <div className="py-12 text-center text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                </div>
              ) : filteredOrders.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  Tidak ada order eligible. Coba ubah filter atau pastikan ada order status SIAP_KIRIM dengan channel yang sesuai profile.
                </div>
              ) : (
                <div className="border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">
                          <Checkbox
                            checked={allFilteredSelected}
                            onCheckedChange={(v) => toggleAllFiltered(!!v)}
                          />
                        </TableHead>
                        <TableHead>Order#</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Kota</TableHead>
                        <TableHead>Channel</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredOrders.map((o) => (
                        <TableRow key={o.id} className="cursor-pointer" onClick={() => toggleOne(o.id, !selectedIds.has(o.id))}>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={selectedIds.has(o.id)}
                              onCheckedChange={(v) => toggleOne(o.id, !!v)}
                            />
                          </TableCell>
                          <TableCell className="font-mono text-xs">{o.order_number}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[10px]">{o.status}</Badge>
                          </TableCell>
                          <TableCell>{o.customer_name}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{o.customer_city || '-'}</TableCell>
                          <TableCell className="text-xs">{o.channel?.code || '-'}</TableCell>
                          <TableCell className="text-right text-xs">Rp {Number(o.total).toLocaleString('id-ID')}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep('profile')}><ArrowLeft className="w-3.5 h-3.5 mr-1" /> Kembali</Button>
            <Button
              onClick={goToPreview}
              disabled={selectedIds.size === 0 || previewLoading}
              className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white"
            >
              {previewLoading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Eye className="w-3.5 h-3.5 mr-1" />}
              Preview {selectedIds.size} Order
            </Button>
          </div>
        </div>
      )}

      {step === 'preview' && preview && profileBundle && (
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-4 pb-4 space-y-3">
              <div>
                <div className="text-sm font-medium">Preview {preview.rows.length} dari {preview.totalOrdersRequested} order</div>
                <div className="text-xs text-muted-foreground">Inilah baris file yang akan di-generate. Periksa kolom & format-nya.</div>
              </div>
              {preview.errors.length > 0 && (
                <div className="text-xs space-y-1 p-3 rounded bg-red-500/10 border border-red-500/20 text-red-600">
                  <div className="font-semibold flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Errors</div>
                  {preview.errors.map((e, i) => (
                    <div key={i}>• {e.orderNumber || `#${e.orderId}`}: {e.reason}</div>
                  ))}
                </div>
              )}
              {preview.warnings.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-amber-600 font-medium">{preview.warnings.length} warning(s)</summary>
                  <div className="mt-2 space-y-0.5 pl-4 max-h-40 overflow-y-auto text-muted-foreground">
                    {preview.warnings.map((w, i) => (
                      <div key={i}>• {w.orderNumber || `#${w.orderId}`}: {w.message}</div>
                    ))}
                  </div>
                </details>
              )}

              {preview.rows.length > 0 && (
                <div className="border rounded-md overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {preview.headers.map((h) => (
                          <TableHead key={h} className="whitespace-nowrap text-xs">{h}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.rows.map((r, i) => (
                        <TableRow key={i}>
                          {preview.headers.map((h) => {
                            const v = r[h]
                            const display = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
                            return (
                              <TableCell key={h} className="whitespace-nowrap text-xs font-mono">
                                {display}
                              </TableCell>
                            )
                          })}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4 pb-4 space-y-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="mark-dikirim"
                  checked={markAsDikirim}
                  onCheckedChange={(v) => setMarkAsDikirim(!!v)}
                />
                <Label htmlFor="mark-dikirim" className="text-sm cursor-pointer">
                  Setelah generate, set status order ke <span className="font-mono">DIKIRIM</span>
                </Label>
              </div>
              <p className="text-xs text-muted-foreground pl-6">
                Default off — biarkan SIAP_KIRIM sampai upload file rekonsil dari ekspedisi (Phase 3B akan auto-update).
                Centang kalau workflow Anda butuh tanda &quot;sudah handover ke ekspedisi&quot; sekarang.
              </p>
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep('orders')}><ArrowLeft className="w-3.5 h-3.5 mr-1" /> Kembali</Button>
            <Button
              onClick={startGenerate}
              disabled={preview.errors.length > 0 || preview.totalOrdersRequested === 0 || generating}
              className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white"
            >
              <Download className="w-3.5 h-3.5 mr-1" />
              Generate &amp; Unduh ({preview.totalOrdersRequested} order)
            </Button>
          </div>
        </div>
      )}

      {step === 'generate' && (
        <Card>
          <CardContent className="pt-8 pb-8 text-center space-y-4">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-violet-500" />
            <div className="text-sm font-medium">Mengolah {progress.done} / {progress.total} order...</div>
            <div className="w-full max-w-md mx-auto bg-muted rounded-full h-2 overflow-hidden">
              <div
                className="bg-gradient-to-r from-violet-500 to-indigo-500 h-2 transition-all"
                style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">Menghasilkan file output. Jangan tutup tab.</p>
          </CardContent>
        </Card>
      )}

      {step === 'done' && result && profileBundle && (
        <Card>
          <CardContent className="pt-4 pb-4 space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-6 h-6 text-emerald-500" />
              <h3 className="text-lg font-bold">Export Selesai</h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <Stat label="diproses" value={result.ordersProcessed} color="emerald" />
              <Stat label="dilewat" value={result.ordersSkipped} color="amber" />
              <Stat label="warning" value={result.warnings.length} color="amber" />
              <Stat label="error" value={result.errors.length} color="red" />
            </div>

            <div className="text-sm space-y-1 pt-2 border-t">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-violet-500" />
                File: <span className="font-mono text-xs">{filename}</span>
                <Badge variant="outline">{profileBundle.profile.file_format}</Badge>
              </div>
              <div className="text-xs text-muted-foreground">
                File otomatis terunduh. Cek folder Downloads untuk file-nya.
              </div>
              {markedCount !== null && (
                <div className="text-xs text-muted-foreground">
                  Status update: {markedCount} order di-set DIKIRIM
                </div>
              )}
            </div>

            {result.errors.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-red-600 font-medium">Detail {result.errors.length} error</summary>
                <div className="mt-2 space-y-1 max-h-60 overflow-y-auto border rounded p-2">
                  {result.errors.map((e, i) => (
                    <div key={i} className="text-muted-foreground">
                      <span className="text-red-600">{e.orderNumber || `#${e.orderId}`}</span>: {e.reason}
                    </div>
                  ))}
                </div>
              </details>
            )}
            {result.warnings.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-amber-600 font-medium">{result.warnings.length} warnings</summary>
                <div className="mt-2 space-y-0.5 pl-4 max-h-40 overflow-y-auto text-muted-foreground">
                  {result.warnings.map((w, i) => (
                    <div key={i}>{w.orderNumber || `#${w.orderId}`}: {w.message}</div>
                  ))}
                </div>
              </details>
            )}

            <div className="flex flex-wrap gap-2 pt-2">
              <Button
                onClick={() => router.push('/orders/list')}
                className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white"
              >Lihat Daftar Order</Button>
              <Button variant="outline" onClick={reset}>Export Lagi</Button>
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
    { key: 'orders', label: '2. Pilih Order' },
    { key: 'preview', label: '3. Preview' },
    { key: 'generate', label: '4. Generate' },
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
