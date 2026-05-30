'use client'
import { useState, useEffect, useMemo, useCallback } from 'react'
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
  Filter,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { canApproveOrders } from '@/lib/auth/permissions'
import { previewOutbound, type OutboundPreviewResult } from '@/lib/converter/preview'
import {
  generateOutbound,
  markOrdersExported,
  downloadBlob,
  type OutboundResult,
} from '@/lib/converter/engine-outbound'
import type {
  ConverterProfile,
  ConverterFieldMapping,
  ConverterValueMapping,
  CourierChannel,
  OrderStatus,
  Product,
} from '@/lib/types'

const supabase = createClient()

type StepKey = 'filter' | 'profile' | 'preview' | 'generate' | 'done'
type StatusFilter = OrderStatus | 'ELIGIBLE'

interface OrderRow {
  id: number
  order_number: string
  status: OrderStatus
  customer_name: string
  customer_city: string | null
  channel_id: number | null
  total: number
  order_date: string
  created_at: string
  channel?: { id: number; code: string }
  items_count?: number
}

// Phase 8H — order yang tujuannya ke area SPX non-coverage.
interface CoverageRow {
  order_id: number
  order_number: string
  customer_name: string
  customer_city: string | null
  customer_province: string | null
}

const ELIGIBLE_STATUSES: OrderStatus[] = ['SIAP_KIRIM', 'BARU']
const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'SIAP_KIRIM', label: 'Siap Kirim (default)' },
  { value: 'BARU', label: 'Baru' },
  { value: 'ELIGIBLE', label: 'Siap Kirim + Baru' },
  { value: 'DIKIRIM', label: 'Dikirim (re-export)' },
]

export default function OrdersExportResiPage() {
  const router = useRouter()
  const { profile: userProfile, role, user } = useAuth()
  const canExport = canApproveOrders(role)

  const [step, setStep] = useState<StepKey>('filter')

  // Step 1: Filter orders
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [channels, setChannels] = useState<CourierChannel[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [channelFilter, setChannelFilter] = useState<string>('ALL')
  // Default 'ELIGIBLE' = BARU + SIAP_KIRIM. WA paste / input baru insert
  // status BARU; kalau default-nya cuma SIAP_KIRIM, halaman keliatan kosong
  // setelah submit dari WA Paste.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ELIGIBLE')
  const [productFilter, setProductFilter] = useState<string>('ALL')
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  // Step 2: Profile picker
  const [profiles, setProfiles] = useState<ConverterProfile[]>([])
  const [profilesLoading, setProfilesLoading] = useState(true)
  const [selectedProfileId, setSelectedProfileId] = useState<string>('')
  const [profileBundle, setProfileBundle] = useState<{
    profile: ConverterProfile
    fieldMappings: ConverterFieldMapping[]
    valueMappings: ConverterValueMapping[]
  } | null>(null)

  // Step 3: Preview
  const [preview, setPreview] = useState<OutboundPreviewResult | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [coverageWarn, setCoverageWarn] = useState<CoverageRow[]>([])

  // Step 4: Generate
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [result, setResult] = useState<OutboundResult | null>(null)
  const [generating, setGenerating] = useState(false)

  // Step 5: Post-action
  const [batchNote, setBatchNote] = useState<string>('')
  const [markedCount, setMarkedCount] = useState<number | null>(null)
  const [marking, setMarking] = useState(false)

  // ----- Effects -----
  useEffect(() => {
    const load = async () => {
      const [{ data: ps }, { data: chs }, { data: prods }] = await Promise.all([
        supabase
          .from('converter_profiles')
          .select('*')
          .eq('active', true)
          .eq('direction', 'OUTBOUND_TO_COURIER')
          .order('code'),
        supabase.from('courier_channels').select('*').eq('active', true).order('code'),
        supabase.from('products').select('id, name').eq('active', true).order('name'),
      ])
      setProfiles((ps || []) as ConverterProfile[])
      setChannels((chs || []) as CourierChannel[])
      setProducts((prods || []) as Product[])
      setProfilesLoading(false)
    }
    load()
  }, [])

  const loadOrders = useCallback(async () => {
    setOrdersLoading(true)

    // Phase 8I-Followup — kalau product filter aktif, pre-fetch order_id yang punya
    // produk itu (SPX dashboard 1 alamat pengirim per batch upload — operator perlu
    // split per supplier produk).
    // Phase 8H — source table = orders_draft (orders yang BELUM dapet resi). Yang
    // udah dapet resi otomatis pindah ke `orders` lewat promote trigger.
    let restrictToOrderIds: number[] | null = null
    if (productFilter !== 'ALL') {
      const { data: oiRows } = await supabase
        .from('order_items_draft')
        .select('order_id')
        .eq('product_id', Number(productFilter))
      restrictToOrderIds = Array.from(new Set((oiRows || []).map((r) => r.order_id as number)))
      if (restrictToOrderIds.length === 0) {
        setOrders([])
        setOrdersLoading(false)
        return
      }
    }

    let q = supabase
      .from('orders_draft')
      .select(
        'id, order_number, status, customer_name, customer_city, channel_id, total, order_date, created_at, channel:courier_channels(id, code), items:order_items_draft(id)'
      )
      .order('order_date', { ascending: false })
      .limit(500)
    if (channelFilter !== 'ALL') {
      // Phase 8K — aggregator filter (e.g. "AGG:LINCAH") expands to all channels
      // under that aggregator. Lincah/Mengantar pakai 1 profile untuk semua
      // sub-courier; user gak perlu split export per courier.
      if (channelFilter.startsWith('AGG:')) {
        const agg = channelFilter.slice(4)
        const channelIds = channels.filter((c) => c.aggregator === agg).map((c) => c.id)
        if (channelIds.length === 0) {
          setOrders([])
          setOrdersLoading(false)
          return
        }
        q = q.in('channel_id', channelIds)
      } else {
        q = q.eq('channel_id', Number(channelFilter))
      }
    }
    if (statusFilter === 'ELIGIBLE') q = q.in('status', ELIGIBLE_STATUSES)
    else q = q.eq('status', statusFilter)
    if (dateFrom) q = q.gte('order_date', dateFrom)
    if (dateTo) q = q.lte('order_date', dateTo)
    if (restrictToOrderIds) q = q.in('id', restrictToOrderIds)

    const { data } = await q
    type Row = Omit<OrderRow, 'items_count'> & { items?: { id: number }[] }
    const rows = ((data || []) as unknown as Row[]).map((r) => ({
      ...r,
      items_count: r.items?.length || 0,
    })) as OrderRow[]
    setOrders(rows)
    setOrdersLoading(false)
  }, [channelFilter, statusFilter, productFilter, dateFrom, dateTo, channels])

  useEffect(() => {
    if (step !== 'filter') return
    void loadOrders()
  }, [step, loadOrders])

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
    return {
      profile: p as ConverterProfile,
      fieldMappings: (fms || []) as ConverterFieldMapping[],
      valueMappings: (vms || []) as ConverterValueMapping[],
    }
  }

  // ----- Step navigation -----
  const goToProfile = () => {
    if (selectedIds.size === 0) return
    setStep('profile')
  }

  const goToPreview = async () => {
    if (!selectedProfileId) return
    const b = await loadBundle(Number(selectedProfileId))
    if (!b) return
    setProfileBundle(b)
    setPreviewLoading(true)
    try {
      const orgId = userProfile?.organization_id || 1
      const ids = Array.from(selectedIds)
      const r = await previewOutbound(
        supabase,
        orgId,
        b.profile,
        b.fieldMappings,
        b.valueMappings,
        ids,
        5,
        'orders_draft',
      )
      setPreview(r)
      // Phase 8H — cek coverage SPX (hanya untuk profile channel SPX)
      const profCode = channels.find((c) => c.id === b.profile.channel_id)?.code || ''
      if (!profCode || profCode.toUpperCase().includes('SPX')) {
        const { data: cov } = await supabase.rpc('check_orders_spx_coverage', { p_order_ids: ids })
        setCoverageWarn((cov || []) as CoverageRow[])
      } else {
        setCoverageWarn([])
      }
      setStep('preview')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error('Gagal preview', { description: msg })
    } finally {
      setPreviewLoading(false)
    }
  }

  const startGenerate = async () => {
    if (!profileBundle || !user) return

    // Phase 8F — Export gate: cek tiap order siap export (alamat lengkap + channel)
    // Block kalau ada yang gagal. Konsisten dengan keputusan owner: STRICT mode.
    const ids = Array.from(selectedIds)
    const notReady: Array<{ id: number; order_number: string; missing: string[] }> = []
    for (const id of ids) {
      try {
        const { data, error } = await supabase.rpc('check_order_export_ready', { p_order_id: id })
        if (error) continue
        const row = Array.isArray(data) ? data[0] : data
        if (row && !row.is_ready) {
          notReady.push({
            id,
            order_number: String(id),
            missing: row.missing_fields || [],
          })
        }
      } catch {
        // ignore — kalau RPC error, skip check (jangan block generate karena infra issue)
      }
    }
    if (notReady.length > 0) {
      const sample = notReady.slice(0, 5).map(o =>
        `• ${o.order_number} (missing: ${o.missing.join(', ')})`
      ).join('\n')
      const more = notReady.length > 5 ? `\n…dan ${notReady.length - 5} order lain` : ''
      toast.error(
        `${notReady.length} order belum siap export`,
        {
          description: `Lengkapi alamat/channel dulu sebelum generate:\n${sample}${more}`,
          duration: 12000,
          action: {
            label: 'Buka Inbox Address Review',
            onClick: () => { window.location.href = '/inbox/address-review' },
          },
        },
      )
      return
    }

    setGenerating(true)
    setStep('generate')
    setProgress({ done: 0, total: selectedIds.size })
    try {
      const orgId = userProfile?.organization_id || 1
      const r = await generateOutbound({
        profile: profileBundle.profile,
        fieldMappings: profileBundle.fieldMappings,
        valueMappings: profileBundle.valueMappings,
        orderIds: ids,
        organizationId: orgId,
        performedBy: user.id,
        supabase,
        sourceTable: 'orders_draft',
        onProgress: (done, total) => setProgress({ done, total }),
      })
      setResult(r)
      if (r.rows.length > 0) {
        downloadBlob(r.fileBlob, r.fileName)
      }
      setStep('done')
      if (r.errors.length === 0) toast.success(`File ${r.fileName} terunduh (${r.rowsGenerated} baris)`)
      else toast.error(`Selesai dengan ${r.errors.length} error`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error('Gagal generate file', { description: msg })
      setStep('preview')
    } finally {
      setGenerating(false)
    }
  }

  const finishWithStatusUpdate = async () => {
    if (!result || !profileBundle) return
    setMarking(true)
    try {
      const successIds = Array.from(selectedIds).filter(
        (id) => !result.errors.find((e) => e.orderId === id)
      )
      // Phase 8H — order ada di orders_draft, jadi update inline (tidak pakai
      // RPC mark_orders_exported yg targetnya `orders`). Status SIAP_KIRIM
      // nandain "file udah generate, lagi nunggu resi balik dari kurir."
      const { error: updErr, count } = await supabase
        .from('orders_draft')
        .update({ status: 'SIAP_KIRIM' }, { count: 'exact' })
        .in('id', successIds)
        .neq('status', 'SIAP_KIRIM')
      const rpcErr = updErr?.message ?? null
      const updated = count ?? 0
      if (rpcErr) {
        toast.error('Gagal update status order', { description: rpcErr })
        setMarkedCount(0)
      } else {
        setMarkedCount(updated)
        toast.success(`${updated} order di-set DIKIRIM`)
      }
    } finally {
      setMarking(false)
    }
  }

  const reset = () => {
    setStep('filter')
    setSelectedIds(new Set())
    setSelectedProfileId('')
    setProfileBundle(null)
    setPreview(null)
    setCoverageWarn([])
    setResult(null)
    setMarkedCount(null)
    setBatchNote('')
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

  // ----- Channel mismatch check -----
  const selectedChannels = useMemo(() => {
    const set = new Set<number | null>()
    for (const o of orders) if (selectedIds.has(o.id)) set.add(o.channel_id)
    return Array.from(set)
  }, [orders, selectedIds])

  // Phase 8K — aggregator-aware grouping. Channels under the same aggregator
  // (e.g. JNE_VIA_LINCAH + NINJA_VIA_LINCAH both → LINCAH) collapse ke 1 group
  // karena profile aggregator (lincah_outbound) handle semua sub-courier via
  // value_mapping `channel_courier_code`. Direct channels (aggregator=NULL,
  // e.g. SPX_DIRECT) tetap distinct per channel.
  const selectedAggregatorGroups = useMemo(() => {
    const set = new Set<string>()
    for (const cid of selectedChannels) {
      if (cid == null) {
        set.add('NO_CHANNEL')
        continue
      }
      const ch = channels.find((c) => c.id === cid)
      if (ch?.aggregator) set.add(`AGG:${ch.aggregator}`)
      else set.add(`CH:${cid}`)
    }
    return Array.from(set)
  }, [selectedChannels, channels])

  // List of distinct aggregators across all channels — drives the Step 1 filter
  // dropdown ("Semua LINCAH" / "Semua MENGANTAR" entries).
  const aggregatorOptions = useMemo(() => {
    const map = new Map<string, number>()
    for (const c of channels) {
      if (!c.active || !c.aggregator) continue
      map.set(c.aggregator, (map.get(c.aggregator) || 0) + 1)
    }
    return Array.from(map.entries()).map(([name, count]) => ({ name, count }))
  }, [channels])

  const channelMismatch = useMemo(() => {
    if (!profileBundle) return null
    const profChannel = profileBundle.profile.channel_id
    if (!profChannel) return null
    const profChannelObj = channels.find((c) => c.id === profChannel)
    const profAggregator = profChannelObj?.aggregator || null
    // Offending = selected channels yang BUKAN profile channel AND
    // (kalau profile aggregator-scoped) BUKAN dari aggregator yang sama.
    const offending = selectedChannels.filter((cid) => {
      if (cid === profChannel) return false
      if (profAggregator) {
        const ch = channels.find((c) => c.id === cid)
        if (ch?.aggregator === profAggregator) return false
      }
      return true
    })
    if (offending.length === 0) return null
    const channelLookup = (id: number | null) =>
      channels.find((c) => c.id === id)?.code || (id == null ? '(tidak ada channel)' : `#${id}`)
    return {
      profileChannelCode: channelLookup(profChannel),
      offendingCodes: offending.map(channelLookup),
      total: selectedChannels.length,
    }
  }, [profileBundle, selectedChannels, channels])

  // ----- Render -----
  if (!canExport) {
    return (
      <div className="space-y-6">
        <PageHeader icon={Truck} title="Export ke Ekspedisi" />
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
        title="Export ke Ekspedisi"
        description="Filter orders siap kirim → pilih outbound profile → preview → generate file untuk upload ke ekspedisi/agregator."
        actions={
          step !== 'filter' ? (
            <Button variant="outline" size="sm" onClick={reset}>
              <RotateCcw className="w-3.5 h-3.5 mr-1" />Mulai Ulang
            </Button>
          ) : null
        }
      />
      <StepIndicator current={step} />

      {step === 'filter' && (
        <div className="space-y-3">
          <Card>
            <CardContent className="pt-4 pb-4 space-y-3">
              <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5" /> Filter orders di bawah, lalu pilih order yang mau di-export.
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Channel</Label>
                  <Select value={channelFilter} onValueChange={(v) => v && setChannelFilter(v)}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Semua channel">
                      {(value: string | null) => {
                        if (!value || value === 'ALL') return 'Semua channel'
                        if (value.startsWith('AGG:')) return `${value.slice(4)} (semua)`
                        return channels.find((c) => String(c.id) === value)?.code ?? value
                      }}
                    </SelectValue></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">Semua channel</SelectItem>
                      {/* Aggregator-level entries (LINCAH/MENGANTAR) — pilih 1 entry
                          untuk export semua sub-courier di bawahnya. */}
                      {aggregatorOptions.map((a) => (
                        <SelectItem key={`agg-${a.name}`} value={`AGG:${a.name}`}>
                          {a.name} ({a.count} courier)
                        </SelectItem>
                      ))}
                      {/* Direct channels (aggregator=NULL, e.g. SPX_DIRECT) —
                          tampil per channel. Sub-courier under aggregator di-skip
                          karena udah ke-cover lewat aggregator entry. */}
                      {channels.filter((c) => !c.aggregator).map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>{c.code}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Status</Label>
                  <Select value={statusFilter} onValueChange={(v) => v && setStatusFilter(v as StatusFilter)}>
                    <SelectTrigger className="w-full"><SelectValue>
                      {(value: string | null) => STATUS_OPTIONS.find((o) => o.value === value)?.label ?? value ?? '—'}
                    </SelectValue></SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Produk</Label>
                  <Select value={productFilter} onValueChange={(v) => v && setProductFilter(v)}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Semua produk">
                      {(value: string | null) => {
                        if (!value || value === 'ALL') return 'Semua produk'
                        return products.find((p) => String(p.id) === value)?.name ?? value
                      }}
                    </SelectValue></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">Semua produk</SelectItem>
                      {products.map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Tanggal dari</Label>
                  <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Tanggal sampai</Label>
                  <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                </div>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Cari order# / customer / kota..."
                  className="pl-9"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4 pb-4 space-y-3">
              <div className="text-xs text-muted-foreground flex items-center gap-3">
                <span>{selectedIds.size} dipilih dari {filteredOrders.length} order tampil</span>
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
                  Tidak ada order eligible. Coba ubah filter, atau pastikan ada order status SIAP_KIRIM.
                </div>
              ) : (
                <div className="border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">
                          <Checkbox checked={allFilteredSelected} onCheckedChange={(v) => toggleAllFiltered(!!v)} />
                        </TableHead>
                        <TableHead>Order#</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Channel</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-right">Items</TableHead>
                        <TableHead>Tanggal</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredOrders.map((o) => (
                        <TableRow key={o.id} className="cursor-pointer" onClick={() => toggleOne(o.id, !selectedIds.has(o.id))}>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Checkbox checked={selectedIds.has(o.id)} onCheckedChange={(v) => toggleOne(o.id, !!v)} />
                          </TableCell>
                          <TableCell className="font-mono text-xs">{o.order_number}</TableCell>
                          <TableCell>
                            <div>{o.customer_name}</div>
                            <div className="text-[10px] text-muted-foreground">{o.customer_city || '-'}</div>
                          </TableCell>
                          <TableCell className="text-xs">{o.channel?.code || '-'}</TableCell>
                          <TableCell className="text-right text-xs">Rp {Number(o.total).toLocaleString('id-ID')}</TableCell>
                          <TableCell className="text-right text-xs">{o.items_count}</TableCell>
                          <TableCell className="text-xs">{o.order_date?.slice(0, 10)}</TableCell>
                          <TableCell><Badge variant="outline" className="text-[10px]">{o.status}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button
              onClick={goToProfile}
              disabled={selectedIds.size === 0}
              className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white"
            >
              Lanjutkan ({selectedIds.size} dipilih) <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </div>
        </div>
      )}

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
                  <SelectValue placeholder={profilesLoading ? 'Loading...' : 'Pilih profile outbound'}>
                    {(value: string | null) => {
                      if (!value || value === 'none') return profilesLoading ? 'Loading...' : 'Pilih profile outbound'
                      const p = profiles.find((x) => String(x.id) === value)
                      return p ? `${p.name} (${p.code})` : value
                    }}
                  </SelectValue>
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
                Profile menentukan format file & kolom yang di-generate. Bikin/edit profile di{' '}
                <Link href="/settings/converter-profiles" className="text-violet-400 hover:underline">Settings → Converter Profiles</Link>.
              </p>
            </div>

            {selectedAggregatorGroups.length > 1 && (
              <div className="text-xs space-y-1 p-3 rounded bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400">
                <div className="font-semibold flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Mixed channels</div>
                <p>
                  Order yang dipilih mengandung {selectedChannels.length} channel dari{' '}
                  {selectedAggregatorGroups.length} group berbeda (aggregator/direct). Profile outbound
                  biasanya cocok untuk 1 aggregator (e.g. semua LINCAH) atau 1 channel direct (e.g. SPX) —
                  disarankan kembali ke Step 1 dan filter per group.
                </p>
              </div>
            )}

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep('filter')}><ArrowLeft className="w-3.5 h-3.5 mr-1" /> Kembali</Button>
              <Button
                onClick={goToPreview}
                disabled={!selectedProfileId || previewLoading}
                className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white"
              >
                {previewLoading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Eye className="w-3.5 h-3.5 mr-1" />}
                Lanjut ke Preview
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'preview' && preview && profileBundle && (
        <div className="space-y-4">
          {channelMismatch && (
            <div className="text-xs space-y-1 p-3 rounded bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400">
              <div className="font-semibold flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Channel mismatch</div>
              <p>
                Profile <span className="font-mono">{profileBundle.profile.code}</span> di-set untuk channel{' '}
                <span className="font-mono">{channelMismatch.profileChannelCode}</span>, tapi pilihan kamu juga mengandung{' '}
                <span className="font-mono">{channelMismatch.offendingCodes.filter((c) => c !== channelMismatch.profileChannelCode).join(', ')}</span>.
                File akan tetap di-generate, tapi format mungkin tidak cocok untuk channel non-target.
              </p>
            </div>
          )}

          {coverageWarn.length > 0 && (
            <div className="text-xs space-y-1.5 p-3 rounded bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400">
              <div className="font-semibold flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                {coverageWarn.length} order ke area yang TIDAK dilayani SPX
              </div>
              <p className="text-muted-foreground">
                Tujuan order ini di luar coverage SPX — besar kemungkinan ditolak / retur.
                File tetap bisa di-generate, tapi pertimbangkan kirim pakai ekspedisi lain.
              </p>
              <div className="max-h-40 overflow-y-auto space-y-0.5 pt-1 font-mono">
                {coverageWarn.map((c) => (
                  <div key={c.order_id}>
                    {c.order_number} — {c.customer_name} · {c.customer_city}, {c.customer_province}
                  </div>
                ))}
              </div>
            </div>
          )}

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
                            const display = v == null || v === '' ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
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

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep('profile')}><ArrowLeft className="w-3.5 h-3.5 mr-1" /> Kembali</Button>
            <Button
              onClick={startGenerate}
              disabled={preview.errors.length > 0 || preview.totalOrdersRequested === 0 || generating}
              className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white"
            >
              <Download className="w-3.5 h-3.5 mr-1" />
              Lanjut Generate ({preview.totalOrdersRequested} order)
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
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-4 pb-4 space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-6 h-6 text-emerald-500" />
                <h3 className="text-lg font-bold">File berhasil di-generate</h3>
              </div>
              <div className="text-sm space-y-1">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-violet-500" />
                  <span className="font-mono text-xs">{result.fileName}</span>
                  <Badge variant="outline">{profileBundle.profile.file_format}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">File otomatis terunduh — cek folder Downloads.</div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center pt-2">
                <Stat label="rows" value={result.rowsGenerated} color="emerald" />
                <Stat label="dilewat" value={result.ordersSkipped} color="amber" />
                <Stat label="warning" value={result.warnings.length} color="amber" />
                <Stat label="error" value={result.errors.length} color="red" />
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
            </CardContent>
          </Card>

          {markedCount === null ? (
            <Card>
              <CardContent className="pt-4 pb-4 space-y-3">
                <div className="text-sm font-medium">Pertanyaan</div>
                <div className="text-sm">
                  Otomatis update status <span className="font-bold">{result.ordersIncluded}</span> order dari{' '}
                  <span className="font-mono">SIAP_KIRIM</span> ke <span className="font-mono">DIKIRIM</span>?
                </div>
                <div className="text-xs text-muted-foreground">
                  Ini menandakan order sudah di-export ke ekspedisi (siap dikirim).
                  Resi belum keluar — akan terisi via <Link href="/reconciliation/upload" className="text-violet-400 hover:underline">/reconciliation/upload</Link> nanti.
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Catatan ekspor (opsional)</Label>
                  <Input
                    value={batchNote}
                    onChange={(e) => setBatchNote(e.target.value)}
                    placeholder="e.g. Batch sore Senin, handover ke kurir Mengantar"
                    maxLength={200}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Disimpan di order_status_history.note untuk audit. Maks 200 karakter.
                  </p>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button variant="outline" onClick={() => setMarkedCount(0)}>Selesai</Button>
                  <Button
                    onClick={finishWithStatusUpdate}
                    disabled={marking}
                    className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white"
                  >
                    {marking ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
                    Update Status &amp; Selesai
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-4 pb-4 space-y-3">
                {markedCount > 0 ? (
                  <div className="text-sm flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                    {markedCount} order di-set DIKIRIM
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">Status order tidak diubah.</div>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
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
    { key: 'filter', label: '1. Filter' },
    { key: 'profile', label: '2. Profile' },
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
