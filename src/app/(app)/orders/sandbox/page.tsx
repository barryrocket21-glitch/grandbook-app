'use client'

import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { createClient } from '@/lib/supabase/client'
import { formatRupiah } from '@/lib/format'
import {
  applySandboxSpxRows,
  clearSandboxOrders,
  exportSandboxOrders,
  getSandboxOrdersByBatch,
  loadSandboxBatches,
  loadSandboxOrders,
  type SandboxExportBatch,
  type SandboxOrder,
  type SandboxSpxRow,
} from '@/lib/sandbox-orders'
import { ClipboardList, Download, RefreshCw, Trash2, Upload, Wand2 } from 'lucide-react'
import { SandboxBenerinAlamatDialog } from './_components/sandbox-benerin-alamat-dialog'
import { generateOutboundFromOrders, downloadBlob } from '@/lib/converter/engine-outbound'
import type { ConverterFieldMapping, ConverterProfile, ConverterValueMapping } from '@/lib/types'
import type { OrderForOutbound } from '@/lib/converter/outbound-resolvers'
import { toast } from 'sonner'

const supabase = createClient()

type StatusFilter = 'ALL' | 'GB_NO_RESI' | 'EXPORTED' | 'FIX_ORDER'

function parseSpxSimulation(text: string): SandboxSpxRow[] {
  return text.split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [ref, trackingNo = '', trackingStatus = 'In Transit'] = line.split(/[\t,;]/).map((v) => v.trim())
      return { ref, trackingNo, trackingStatus }
    })
    .filter((r) => r.ref.startsWith('GB-'))
}

function sandboxToOutboundOrder(row: SandboxOrder, channelId: number | null): OrderForOutbound {
  const id = Number(row.id.replace(/\D/g, '').slice(-9)) || Math.floor(Math.random() * 1_000_000_000)
  return {
    id,
    organization_id: 1,
    order_number: row.orderNumber,
    external_order_id: null,
    resi: row.trackingNo,
    channel_id: channelId,
    customer_name: row.customerName,
    customer_phone: row.customerPhone,
    customer_province: row.province,
    customer_city: row.city,
    customer_subdistrict: row.subdistrict,
    customer_village: null,
    customer_zip: row.zip,
    customer_address_detail: row.customerAddress,
    customer_address: row.customerAddress,
    subtotal: row.total ?? 0,
    shipping_cost: row.shippingCost ?? 0,
    discount: 0,
    total: row.total ?? row.codAmount ?? 0,
    cod_amount: row.codAmount ?? row.total ?? 0,
    payment_method: 'COD',
    status: 'BARU',
    status_changed_at: row.createdAt,
    rate_snapshot: null,
    cs_name: row.csName,
    cs_id: null,
    advertiser_id: null,
    campaign_id: null,
    admin_id: null,
    created_by: null,
    notes: null,
    meta: {},
    raw_data: null,
    order_date: row.orderDate,
    created_at: row.createdAt,
    updated_at: row.createdAt,
    exported_at: row.exportedAt,
    exported_channel_id: channelId,
    exported_batch_id: row.exportBatchId,
    fulfillment_category: row.fulfillmentCategory === 'FIX_ORDER' ? 'FIX_ORDER' : 'GB_NO_RESI',
    spx_created_at: row.spxCreatedAt,
    channel: channelId ? { id: channelId, code: 'SPX_DIRECT', name: 'SPX Direct', aggregator: null, courier_id: null, active: true, created_at: row.createdAt, updated_at: row.createdAt } : undefined,
    items: [{
      id,
      order_id: id,
      product_id: null,
      product_name_raw: row.productName,
      variation: row.variation,
      qty: row.qty,
      weight_per_unit: null,
      price: row.total ?? 0,
      cost_price_snapshot: 0,
      created_at: row.createdAt,
      product: { display_name: row.productName, weight_kg: null, name: row.productName },
    }],
  } as unknown as OrderForOutbound
}

export default function SandboxOrdersPage() {
  const [rows, setRows] = useState<SandboxOrder[]>([])
  const [batches, setBatches] = useState<SandboxExportBatch[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchFilter, setBatchFilter] = useState<string>('ALL')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [spxText, setSpxText] = useState('')
  const [profiles, setProfiles] = useState<ConverterProfile[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState<string>('')
  const [exporting, setExporting] = useState(false)
  const [addressDialogOpen, setAddressDialogOpen] = useState(false)

  const reload = () => {
    const next = loadSandboxOrders()
    const nextBatches = loadSandboxBatches()
    setRows(next)
    setBatches(nextBatches)
    setSelected(new Set(next.map((r) => r.id)))
  }

  useEffect(() => {
    // Sandbox data lives in browser localStorage; load once after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload()
  }, [])

  useEffect(() => {
    const loadProfiles = async () => {
      const { data, error } = await supabase
        .from('converter_profiles')
        .select('*')
        .eq('active', true)
        .eq('direction', 'OUTBOUND_TO_COURIER')
        .order('code')
      if (error) {
        toast.error('Gagal load profile ekspedisi', { description: error.message })
        return
      }
      const list = (data || []) as ConverterProfile[]
      setProfiles(list)
      setSelectedProfileId((prev) => prev || String(list.find((p) => p.code === 'spx_outbound')?.id ?? list[0]?.id ?? ''))
    }
    void loadProfiles()
  }, [])

  const visibleRows = useMemo(() => rows.filter((r) => {
    const batchOk = batchFilter === 'ALL' || r.exportBatchId === batchFilter
    const statusOk = statusFilter === 'ALL' || r.fulfillmentCategory === statusFilter
    return batchOk && statusOk
  }), [batchFilter, rows, statusFilter])

  const applyStatusFilter = (filter: StatusFilter) => {
    setStatusFilter(filter)
    const nextVisible = rows.filter((r) => {
      const statusOk = filter === 'ALL' || r.fulfillmentCategory === filter
      const batchOk = batchFilter === 'ALL' || r.exportBatchId === batchFilter
      return statusOk && batchOk
    })
    setSelected(new Set(nextVisible.map((r) => r.id)))
  }

  const applyBatchFilter = (filter: string) => {
    setBatchFilter(filter)
    const nextVisible = rows.filter((r) => {
      const batchOk = filter === 'ALL' || r.exportBatchId === filter
      const statusOk = statusFilter === 'ALL' || r.fulfillmentCategory === statusFilter
      return batchOk && statusOk
    })
    setSelected(new Set(nextVisible.map((r) => r.id)))
  }

  const stats = useMemo(() => ({
    pending: rows.filter((r) => r.fulfillmentCategory === 'GB_NO_RESI').length,
    fix: rows.filter((r) => r.fulfillmentCategory === 'FIX_ORDER').length,
    noResi: rows.filter((r) => r.fulfillmentCategory === 'GB_NO_RESI').length,
    ready: rows.filter((r) => !!r.wilayahId).length,
    notReady: rows.filter((r) => !r.wilayahId).length,
  }), [rows])

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const loadProfileBundle = async (profileId: number) => {
    const [{ data: profile, error: profileError }, { data: fieldMappings, error: fieldError }, { data: valueMappings, error: valueError }] = await Promise.all([
      supabase.from('converter_profiles').select('*').eq('id', profileId).single(),
      supabase.from('converter_field_mappings').select('*').eq('profile_id', profileId).order('display_order'),
      supabase.from('converter_value_mappings').select('*').eq('profile_id', profileId),
    ])
    const err = profileError || fieldError || valueError
    if (err) throw new Error(err.message)
    return {
      profile: profile as ConverterProfile,
      fieldMappings: (fieldMappings || []) as ConverterFieldMapping[],
      valueMappings: (valueMappings || []) as ConverterValueMapping[],
    }
  }

  const handleExport = async () => {
    const selectedIds = Array.from(selected)
    if (selectedIds.length === 0) return toast.error('Pilih order dulu')
    if (!selectedProfileId) return toast.error('Pilih jenis export dulu')
    const selectedRows = rows.filter((o) => selectedIds.includes(o.id))
    const notReady = selectedRows.filter((o) => !o.wilayahId)
    if (notReady.length > 0) {
      toast.error(`${notReady.length} alamat belum dibenerin`, { description: 'Buka Benerin Alamat dulu sebelum export format ekspedisi.' })
      setAddressDialogOpen(true)
      return
    }
    setExporting(true)
    try {
      const bundle = await loadProfileBundle(Number(selectedProfileId))
      const virtualOrders = selectedRows.map((row) => sandboxToOutboundOrder(row, bundle.profile.channel_id))
      const result = await generateOutboundFromOrders({
        profile: bundle.profile,
        fieldMappings: bundle.fieldMappings,
        valueMappings: bundle.valueMappings,
        orders: virtualOrders,
        supabase,
      })
      if (result.rowsGenerated === 0) return toast.error('Tidak ada baris yang bisa diexport')
      downloadBlob(result.fileBlob, result.fileName)
      exportSandboxOrders(selectedIds)
      toast.success(`${result.fileName} terunduh (${result.rowsGenerated} baris). Format mengikuti Export Ekspedisi.`)
      reload()
    } catch (err) {
      toast.error('Gagal export sandbox', { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setExporting(false)
    }
  }

  const handleReExportBatch = async (batch: SandboxExportBatch) => {
    const batchRows = getSandboxOrdersByBatch(batch.id)
    if (batchRows.length === 0) return toast.error('Batch kosong')
    if (!selectedProfileId) return toast.error('Pilih jenis export dulu')
    setExporting(true)
    try {
      const bundle = await loadProfileBundle(Number(selectedProfileId))
      const virtualOrders = batchRows.map((row) => sandboxToOutboundOrder(row, bundle.profile.channel_id))
      const result = await generateOutboundFromOrders({
        profile: bundle.profile,
        fieldMappings: bundle.fieldMappings,
        valueMappings: bundle.valueMappings,
        orders: virtualOrders,
        supabase,
      })
      if (result.rowsGenerated === 0) return toast.error('Tidak ada baris yang bisa diexport')
      downloadBlob(result.fileBlob, result.fileName)
      toast.success(`${batch.label} diexport ulang dengan format ${bundle.profile.name}`)
    } catch (err) {
      toast.error('Gagal re-export sandbox', { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setExporting(false)
    }
  }

  const handleSync = () => {
    const parsed = parseSpxSimulation(spxText)
    if (parsed.length === 0) return toast.error('Isi simulasi SPX dulu: GB Referensi, Resi, Status')
    const res = applySandboxSpxRows(parsed)
    toast.success(`Simulasi SPX selesai: ${res.fixed} fix, ${res.nonCoverage} non coverage`)
    reload()
  }

  const fillSampleSpx = () => {
    const exported = rows.filter((r) => r.fulfillmentCategory === 'EXPORTED')
    setSpxText(exported.slice(0, Math.max(0, exported.length - 1)).map((r, i) => `${r.orderNumber},SPX-SIM-${String(i + 1).padStart(5, '0')},In Transit`).join('\n'))
  }

  return (
    <div className="space-y-4">
      <PageHeader
        icon={ClipboardList}
        title="Data Orderan Sandbox"
        description="Simulasi WA Paste → Data Orderan → Export → tarik data SPX tanpa menulis ke database live. Data tersimpan di browser ini saja."
        actions={<Button variant="outline" size="sm" onClick={reload}><RefreshCw className="w-3.5 h-3.5 mr-1" />Refresh</Button>}
      />

      <Card>
        <CardContent className="pt-4 pb-4 space-y-3">
          <div className="flex flex-wrap gap-2 text-xs">
            <Button size="sm" variant={statusFilter === 'GB_NO_RESI' ? 'default' : 'outline'} onClick={() => applyStatusFilter('GB_NO_RESI')}>GB No Resi: {stats.noResi}</Button>
            <Button size="sm" variant={statusFilter === 'EXPORTED' ? 'default' : 'outline'} onClick={() => applyStatusFilter('EXPORTED')}>Exported: {rows.filter((r) => r.exportedAt && r.fulfillmentCategory !== 'FIX_ORDER').length}</Button>
            <Button size="sm" variant={statusFilter === 'FIX_ORDER' ? 'default' : 'outline'} onClick={() => applyStatusFilter('FIX_ORDER')}>Fix Order: {stats.fix}</Button>
            <Button size="sm" variant="outline" className="gap-1.5 border-emerald-500/40 text-emerald-700">Siap Export: {stats.ready}</Button>
            <Button size="sm" variant="outline" className="gap-1.5 border-amber-500/40 text-amber-700" onClick={() => setAddressDialogOpen(true)}><Wand2 className="w-3.5 h-3.5" />Benerin Alamat: {stats.notReady}</Button>
            {statusFilter !== 'ALL' && <Button size="sm" variant="ghost" onClick={() => applyStatusFilter('ALL')}>Reset Status</Button>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={selectedProfileId} onValueChange={(value) => setSelectedProfileId(value || '')}>
              <SelectTrigger className="h-8 w-[260px] text-xs">
                <SelectValue placeholder="Pilih jenis export" />
              </SelectTrigger>
              <SelectContent>
                {profiles.map((profile) => (
                  <SelectItem key={profile.id} value={String(profile.id)}>
                    {profile.name} ({profile.file_format})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={handleExport} disabled={selected.size === 0 || exporting || !selectedProfileId}>
              <Download className="w-3.5 h-3.5 mr-1" />Export Format Ekspedisi ({selected.size})
            </Button>
            <Button size="sm" variant="outline" onClick={fillSampleSpx}>Isi Sample SPX</Button>
            <Button size="sm" variant="outline" onClick={() => { clearSandboxOrders(); reload(); toast.success('Sandbox dikosongkan') }}><Trash2 className="w-3.5 h-3.5 mr-1" />Kosongkan Sandbox</Button>
          </div>
          {batches.length > 0 && (
            <div className="space-y-2 border-t pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant={batchFilter === 'ALL' ? 'default' : 'outline'} onClick={() => applyBatchFilter('ALL')}>Semua Batch</Button>
                {batches.map((batch) => (
                  <Button key={batch.id} size="sm" variant={batchFilter === batch.id ? 'default' : 'outline'} onClick={() => applyBatchFilter(batch.id)}>
                    Export {batch.sequence}
                  </Button>
                ))}
              </div>
              <div className="grid gap-2">
                {batches.map((batch) => (
                  <div key={batch.id} className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 px-3 py-2 text-xs">
                    <span className="font-semibold">{batch.label}</span>
                    <span className="text-muted-foreground">{batch.orderCount} data</span>
                    <Button size="sm" variant="outline" className="ml-auto h-7" onClick={() => handleReExportBatch(batch)}>
                      <Download className="w-3.5 h-3.5 mr-1" />Re-export batch
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4 pb-4 space-y-3">
          <div className="text-sm font-semibold flex items-center gap-1.5"><Upload className="w-4 h-4" />Simulasi Tarik Data SPX</div>
          <div className="text-xs text-muted-foreground">Format per baris: <code>GB Referensi, Resi, Status</code>. Match hanya berdasarkan GB Referensi. Order tanpa resi menjadi GB No Resi sampai ditemukan di data SPX.</div>
          <Textarea value={spxText} onChange={(e) => setSpxText(e.target.value)} className="font-mono text-xs min-h-[120px]" placeholder="GB-SIM-20260825-000001,SPXID-SIM-001,In Transit" />
          <Button size="sm" onClick={handleSync}>Apply Simulasi SPX</Button>
        </CardContent>
      </Card>

      <div className="rounded-xl bg-card ring-1 ring-foreground/10 overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">Pilih</TableHead>
                <TableHead>Tanggal Terbit GB</TableHead>
                <TableHead>Tanggal Create SPX</TableHead>
                <TableHead>GB Referensi</TableHead>
                <TableHead>Resi</TableHead>
                <TableHead>Tracking Status</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Alamat Export</TableHead>
                <TableHead>Produk</TableHead>
                <TableHead>Varian Produk</TableHead>
                <TableHead>Kode Atribusi</TableHead>
                <TableHead>Jenis Transaksi</TableHead>
                <TableHead className="text-right">Nilai COD</TableHead>
                <TableHead>Nama CS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.length === 0 ? (
                <TableRow><TableCell colSpan={14} className="py-10 text-center text-sm text-muted-foreground">Belum ada order sandbox untuk filter ini. Submit dari WA Paste dulu.</TableCell></TableRow>
              ) : visibleRows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell><input type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)} /></TableCell>
                  <TableCell className="text-sm whitespace-nowrap">{row.orderDate || '-'}</TableCell>
                  <TableCell className="text-sm whitespace-nowrap">{row.spxCreatedAt ? row.spxCreatedAt.slice(0, 10) : '-'}</TableCell>
                  <TableCell className="font-mono text-xs whitespace-nowrap">{row.orderNumber}</TableCell>
                  <TableCell className="font-mono text-xs whitespace-nowrap">{row.trackingNo || '-'}</TableCell>
                  <TableCell className="max-w-[170px] truncate" title={row.trackingStatus || ''}>{row.trackingStatus || '-'}</TableCell>
                  <TableCell className="max-w-[180px] truncate" title={row.customerName}>{row.customerName}</TableCell>
                  <TableCell className="max-w-[220px] truncate" title={[row.subdistrict, row.city, row.province, row.zip].filter(Boolean).join(', ') || 'Benerin alamat dulu'}>
                    {row.wilayahId ? [row.subdistrict, row.city, row.province, row.zip].filter(Boolean).join(', ') : (
                      <Button size="sm" variant="outline" className="h-7 border-amber-500/40 text-amber-700" onClick={() => setAddressDialogOpen(true)}>Benerin</Button>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[180px] truncate" title={row.productName}>{row.productName}</TableCell>
                  <TableCell className="max-w-[150px] truncate" title={row.variation || ''}>{row.variation || '-'}</TableCell>
                  <TableCell className="font-mono text-xs max-w-[200px] truncate" title={row.attributionCodeRaw || ''}>{row.attributionCodeRaw || '-'}</TableCell>
                  <TableCell>COD</TableCell>
                  <TableCell className="text-right whitespace-nowrap">{formatRupiah(Number(row.codAmount || 0))}</TableCell>
                  <TableCell>{row.csName || '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
      <SandboxBenerinAlamatDialog
        open={addressDialogOpen}
        rows={rows}
        onOpenChange={setAddressDialogOpen}
        onDone={reload}
      />
    </div>
  )
}
