'use client'

import { useState, useEffect, useRef } from 'react'
import Papa from 'papaparse'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import {
  Upload, Download, FileText, AlertCircle, CheckCircle2,
  ArrowLeft, Loader2, RefreshCw, Truck
} from 'lucide-react'
import Link from 'next/link'
import { formatRupiah } from '@/lib/format'
import {
  UPLOAD_TEMPLATES, RESI_UPDATE_HEADERS, parseCSV,
  generateCSV, downloadCSV, type ParsedOrderRow
} from '@/lib/templates'
import { RESI_STATUSES, EKSPEDISI_LIST } from '@/lib/constants'
import type { Campaign, Profile, Product } from '@/lib/types'

// ─────────────────────────────────────────────────────────────────
// TAB 1: UPLOAD ORDER MASSAL
// ─────────────────────────────────────────────────────────────────
function UploadOrderTab() {
  const { profile } = useAuth()
  const supabase = createClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const [templateId, setTemplateId] = useState('grandbook')
  const [rows, setRows] = useState<ParsedOrderRow[]>([])
  const [fileName, setFileName] = useState('')
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [csUsers, setCsUsers] = useState<Profile[]>([])
  const [advUsers, setAdvUsers] = useState<Profile[]>([])

  // Optional assignments for all imported rows
  const [campaignId, setCampaignId] = useState('')
  const [advertiserId, setAdvertiserId] = useState('')
  const [csId, setCsId] = useState('')

  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ success: number; failed: number } | null>(null)

  const template = UPLOAD_TEMPLATES.find(t => t.id === templateId)!
  const validRows = rows.filter(r => r._errors!.length === 0)
  const errorRows = rows.filter(r => r._errors!.length > 0)

  useEffect(() => {
    const fetch = async () => {
      const [camp, prod, cs, adv] = await Promise.all([
        supabase.from('campaigns').select('*').eq('active', true),
        supabase.from('products').select('*').eq('active', true),
        supabase.from('profiles').select('*').eq('role', 'cs').eq('active', true),
        supabase.from('profiles').select('*').eq('role', 'advertiser').eq('active', true),
      ])
      setCampaigns(camp.data || [])
      setProducts(prod.data || [])
      setCsUsers(cs.data || [])
      setAdvUsers(adv.data || [])
    }
    fetch()
  }, [])

  const handleDownloadTemplate = () => {
    const csv = generateCSV(template.downloadHeaders, [template.downloadExample])
    downloadCSV(`template_${template.id}.csv`, csv)
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setRows([])
    setImportResult(null)

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const parsed = parseCSV(template, result.data)
        setRows(parsed)
        if (parsed.length === 0) toast.error('Tidak ada data yang berhasil dibaca dari file.')
        else toast.success(`${parsed.length} baris berhasil dibaca`)
      },
      error: (err) => toast.error(`Gagal membaca file: ${err.message}`),
    })
  }

  const handleImport = async () => {
    if (validRows.length === 0) return
    setImporting(true)
    let success = 0
    let failed = 0

    for (const row of validRows) {
      try {
        // Resolve product
        let productId: number | null = null
        let hppSnapshot = 0
        let unitPrice = row.price ?? 0

        if (row.product_sku) {
          const p = products.find(p => p.sku === row.product_sku)
          if (p) { productId = p.id; hppSnapshot = p.hpp; if (!unitPrice) unitPrice = p.price_default }
        }
        if (!productId && row.product_name) {
          const p = products.find(p => p.name.toLowerCase() === row.product_name!.toLowerCase())
          if (p) { productId = p.id; hppSnapshot = p.hpp; if (!unitPrice) unitPrice = p.price_default }
        }

        const qty = row.qty ?? 1
        const shippingCost = row.shipping_cost ?? 0
        const discount = row.discount ?? 0
        const subtotal = unitPrice * qty
        const total = subtotal + shippingCost - discount

        // Generate order number
        const { data: orderNumData } = await supabase.rpc('generate_order_number')

        const orderPayload: Record<string, unknown> = {
          order_number: orderNumData,
          order_date: row.order_date || new Date().toISOString().split('T')[0],
          customer_name: row.customer_name!,
          customer_phone: row.customer_phone || null,
          customer_address: row.customer_address || null,
          customer_city: row.customer_city || null,
          customer_province: row.customer_province || null,
          subtotal,
          shipping_cost: shippingCost,
          discount,
          total,
          payment_method: (row.payment_method === 'TRANSFER' ? 'TRANSFER' : 'COD'),
          status: 'BARU',
          campaign_id: campaignId ? Number(campaignId) : null,
          advertiser_id: advertiserId || null,
          cs_id: csId || null,
          admin_id: profile?.id || null,
          notes: row.notes || null,
          resi: row.resi || null,
          ekspedisi: row.ekspedisi || null,
          resi_status: row.resi ? 'AKTIF' : null,
        }

        const { data: order, error: orderErr } = await supabase
          .from('orders')
          .insert(orderPayload)
          .select('id')
          .single()

        if (orderErr) { failed++; continue }

        // Insert order item if product resolved
        if (productId && order) {
          await supabase.from('order_items').insert({
            order_id: order.id,
            product_id: productId,
            qty,
            price: unitPrice,
            hpp_snapshot: hppSnapshot,
          })
        }
        success++
      } catch {
        failed++
      }
    }

    setImporting(false)
    setImportResult({ success, failed })
    toast.success(`Import selesai: ${success} berhasil, ${failed} gagal`)
  }

  const reset = () => {
    setRows([])
    setFileName('')
    setImportResult(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="space-y-6">
      {/* Step 1: Pilih template */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Pilih Template Platform</CardTitle>
          <CardDescription>Sesuaikan dengan sumber data order kamu</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {UPLOAD_TEMPLATES.map(t => (
              <button
                key={t.id}
                onClick={() => { setTemplateId(t.id); reset() }}
                className={`text-left p-3 rounded-lg border-2 transition-all ${
                  templateId === t.id
                    ? 'border-violet-600 bg-violet-500/5'
                    : 'border-border hover:border-violet-400'
                }`}
              >
                <div className="font-semibold text-sm">{t.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{t.description}</div>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button variant="outline" size="sm" onClick={handleDownloadTemplate}>
              <Download className="w-4 h-4 mr-2" />
              Download Template {template.label}
            </Button>
            <span className="text-xs text-muted-foreground">
              Isi template CSV lalu upload di bawah
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Step 2: Upload file */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">2. Upload File CSV</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-muted-foreground/30 rounded-lg cursor-pointer hover:border-violet-500/50 hover:bg-violet-500/5 transition-all">
            <Upload className="w-8 h-8 text-muted-foreground mb-2" />
            <span className="text-sm text-muted-foreground">
              {fileName ? fileName : 'Klik atau drag file CSV di sini'}
            </span>
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFile}
            />
          </label>

          {rows.length > 0 && (
            <div className="flex items-center gap-3 flex-wrap">
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="w-3 h-3 mr-1" />
                {validRows.length} baris valid
              </Badge>
              {errorRows.length > 0 && (
                <Badge variant="outline" className="bg-red-500/10 text-red-700 dark:text-red-400">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  {errorRows.length} baris error
                </Badge>
              )}
              <Button variant="ghost" size="sm" onClick={reset}>
                <RefreshCw className="w-3 h-3 mr-1" /> Reset
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step 3: Assign campaign/CS/advertiser */}
      {validRows.length > 0 && !importResult && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">3. Assign Campaign & Tim (Opsional)</CardTitle>
            <CardDescription>Akan diterapkan ke semua {validRows.length} order yang diimport</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label>Campaign</Label>
                <Select value={campaignId} onValueChange={v => setCampaignId(!v || v === 'none' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="Pilih campaign..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Tanpa Campaign —</SelectItem>
                    {campaigns.map(c => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.campaign_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Advertiser</Label>
                <Select value={advertiserId} onValueChange={v => setAdvertiserId(!v || v === 'none' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="Pilih advertiser..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Tanpa Advertiser —</SelectItem>
                    {advUsers.map(u => (
                      <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>CS</Label>
                <Select value={csId} onValueChange={v => setCsId(!v || v === 'none' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="Pilih CS..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Tanpa CS —</SelectItem>
                    {csUsers.map(u => (
                      <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Preview table */}
      {rows.length > 0 && !importResult && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">4. Preview Data</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto max-h-96">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>Tanggal</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Telepon</TableHead>
                    <TableHead>Produk (SKU)</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Harga</TableHead>
                    <TableHead>Ekspedisi</TableHead>
                    <TableHead>Resi</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, i) => (
                    <TableRow key={i} className={row._errors!.length > 0 ? 'bg-red-500/5' : ''}>
                      <TableCell className="text-xs text-muted-foreground">{row._row}</TableCell>
                      <TableCell className="text-xs">{row.order_date}</TableCell>
                      <TableCell className="text-sm font-medium">{row.customer_name}</TableCell>
                      <TableCell className="text-xs">{row.customer_phone}</TableCell>
                      <TableCell className="text-xs font-mono">
                        {row.product_sku || row.product_name || '—'}
                      </TableCell>
                      <TableCell className="text-right text-xs">{row.qty}</TableCell>
                      <TableCell className="text-right text-xs">{row.price ? formatRupiah(row.price) : '—'}</TableCell>
                      <TableCell className="text-xs">{row.ekspedisi || '—'}</TableCell>
                      <TableCell className="text-xs font-mono">{row.resi || '—'}</TableCell>
                      <TableCell>
                        {row._errors!.length > 0 ? (
                          <div className="flex items-start gap-1">
                            <AlertCircle className="w-3 h-3 text-red-500 mt-0.5 shrink-0" />
                            <span className="text-xs text-red-600">{row._errors!.join(', ')}</span>
                          </div>
                        ) : (
                          <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                            OK
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Import button */}
      {validRows.length > 0 && !importResult && (
        <div className="flex items-center gap-4">
          <Button
            onClick={handleImport}
            disabled={importing}
            className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white"
          >
            {importing ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Mengimport...</>
            ) : (
              <><Upload className="w-4 h-4 mr-2" />Import {validRows.length} Order</>
            )}
          </Button>
          {errorRows.length > 0 && (
            <span className="text-sm text-muted-foreground">
              {errorRows.length} baris error akan dilewati
            </span>
          )}
        </div>
      )}

      {/* Import result */}
      {importResult && (
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="pt-6 pb-6">
            <div className="flex items-center gap-4">
              <CheckCircle2 className="w-8 h-8 text-emerald-500" />
              <div>
                <p className="font-semibold">Import Selesai!</p>
                <p className="text-sm text-muted-foreground">
                  {importResult.success} order berhasil diimport
                  {importResult.failed > 0 && `, ${importResult.failed} gagal`}
                </p>
              </div>
              <div className="ml-auto flex gap-2">
                <Button variant="outline" size="sm" onClick={reset}>Upload Lagi</Button>
                <Button size="sm" render={<Link href="/orders/list" />} className="bg-violet-600 text-white">
                  Lihat Orders
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// TAB 2: UPDATE STATUS RESI
// ─────────────────────────────────────────────────────────────────
function UpdateResiTab() {
  const supabase = createClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState<ResiUpdateRow[]>([])
  const [updating, setUpdating] = useState(false)
  const [updateResult, setUpdateResult] = useState<{ success: number; failed: number } | null>(null)
  const [downloading, setDownloading] = useState(false)

  // Date filter for template download
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30)
    return d.toISOString().split('T')[0]
  })
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0])

  type ResiUpdateRow = {
    order_number: string
    customer_name: string
    resi: string
    ekspedisi: string
    resi_status: string
    catatan: string
    _row: number
    _error?: string
    _valid: boolean
  }

  const VALID_RESI_STATUS = ['AKTIF', 'DITERIMA', 'PROBLEM', 'RETUR']

  const handleDownloadTemplate = async () => {
    setDownloading(true)
    const { data, error } = await supabase
      .from('orders')
      .select('order_number, customer_name, resi, ekspedisi, resi_status')
      .eq('status', 'DIKIRIM')
      .gte('order_date', dateFrom)
      .lte('order_date', dateTo)
      .order('order_date', { ascending: false })

    if (error) { toast.error(error.message); setDownloading(false); return }

    const csvRows = (data || []).map(o => [
      o.order_number,
      o.customer_name,
      o.resi || '',
      o.ekspedisi || '',
      o.resi_status || 'AKTIF',
      '',
    ])

    const csv = generateCSV(RESI_UPDATE_HEADERS, csvRows)
    downloadCSV(`update_resi_${dateFrom}_${dateTo}.csv`, csv)
    setDownloading(false)
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setRows([])
    setUpdateResult(null)

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const parsed: ResiUpdateRow[] = result.data.map((row, idx) => {
          const orderNumber = (row[RESI_UPDATE_HEADERS[0]] || '').trim()
          const customerName = (row[RESI_UPDATE_HEADERS[1]] || '').trim()
          const resi = (row[RESI_UPDATE_HEADERS[2]] || '').trim()
          const ekspedisi = (row[RESI_UPDATE_HEADERS[3]] || '').trim().toUpperCase()
          const resiStatus = (row[RESI_UPDATE_HEADERS[4]] || '').trim().toUpperCase()
          const catatan = (row[RESI_UPDATE_HEADERS[5]] || '').trim()

          let error: string | undefined
          if (!orderNumber) error = 'No Order kosong'
          else if (resiStatus && !VALID_RESI_STATUS.includes(resiStatus)) {
            error = `Status tidak valid: ${resiStatus}. Gunakan: ${VALID_RESI_STATUS.join(' / ')}`
          }

          return {
            order_number: orderNumber,
            customer_name: customerName,
            resi,
            ekspedisi,
            resi_status: resiStatus,
            catatan,
            _row: idx + 2,
            _error: error,
            _valid: !error,
          }
        }).filter(r => r.order_number)

        setRows(parsed)
        toast.success(`${parsed.length} baris dibaca`)
      },
      error: (err) => toast.error(`Gagal membaca file: ${err.message}`),
    })
  }

  const handleUpdate = async () => {
    const validRows = rows.filter(r => r._valid)
    if (validRows.length === 0) return

    setUpdating(true)
    let success = 0
    let failed = 0

    for (const row of validRows) {
      const updatePayload: Record<string, unknown> = {}
      if (row.resi) updatePayload.resi = row.resi
      if (row.ekspedisi) updatePayload.ekspedisi = row.ekspedisi
      if (row.resi_status) updatePayload.resi_status = row.resi_status
      if (row.catatan) updatePayload.notes = row.catatan

      const { error } = await supabase
        .from('orders')
        .update(updatePayload)
        .eq('order_number', row.order_number)

      if (error) failed++
      else success++
    }

    setUpdating(false)
    setUpdateResult({ success, failed })
    toast.success(`Update selesai: ${success} berhasil, ${failed} gagal`)
  }

  const reset = () => {
    setRows([])
    setFileName('')
    setUpdateResult(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const validCount = rows.filter(r => r._valid).length
  const errorCount = rows.filter(r => !r._valid).length

  return (
    <div className="space-y-6">
      {/* Download template */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Truck className="w-4 h-4" />
            1. Download Template Status Resi
          </CardTitle>
          <CardDescription>
            Download data order status DIKIRIM, isi/update no resi dan status, lalu upload kembali
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3 items-end">
            <div className="space-y-1.5">
              <Label>Dari Tanggal</Label>
              <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
            </div>
            <div className="space-y-1.5">
              <Label>Sampai Tanggal</Label>
              <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-40" />
            </div>
            <Button variant="outline" onClick={handleDownloadTemplate} disabled={downloading}>
              {downloading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
              Download Template Resi
            </Button>
          </div>

          <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">Kolom Status Resi yang valid:</p>
            <div className="flex flex-wrap gap-2 mt-1">
              {RESI_STATUSES.map(s => (
                <Badge key={s.value} variant="outline" className={`text-xs ${s.color}`}>
                  {s.value} — {s.label}
                </Badge>
              ))}
            </div>
            <p className="mt-2">
              Kolom <code className="bg-muted px-1 rounded">No Order (jangan diubah)</code> wajib tidak berubah.
              Kolom <code className="bg-muted px-1 rounded">Catatan Update</code> akan menimpa catatan order.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Upload file */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">2. Upload File CSV yang Sudah Diisi</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-muted-foreground/30 rounded-lg cursor-pointer hover:border-violet-500/50 hover:bg-violet-500/5 transition-all">
            <Upload className="w-8 h-8 text-muted-foreground mb-2" />
            <span className="text-sm text-muted-foreground">
              {fileName ? fileName : 'Klik atau drag file CSV di sini'}
            </span>
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFile}
            />
          </label>

          {rows.length > 0 && (
            <div className="flex items-center gap-3 flex-wrap">
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="w-3 h-3 mr-1" />{validCount} baris valid
              </Badge>
              {errorCount > 0 && (
                <Badge variant="outline" className="bg-red-500/10 text-red-700 dark:text-red-400">
                  <AlertCircle className="w-3 h-3 mr-1" />{errorCount} error
                </Badge>
              )}
              <Button variant="ghost" size="sm" onClick={reset}>
                <RefreshCw className="w-3 h-3 mr-1" />Reset
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Preview */}
      {rows.length > 0 && !updateResult && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">3. Preview Perubahan</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto max-h-80">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>No Order</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>No Resi (Baru)</TableHead>
                    <TableHead>Ekspedisi</TableHead>
                    <TableHead>Status Resi</TableHead>
                    <TableHead>Catatan</TableHead>
                    <TableHead>Validasi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, i) => (
                    <TableRow key={i} className={!row._valid ? 'bg-red-500/5' : ''}>
                      <TableCell className="text-xs text-muted-foreground">{row._row}</TableCell>
                      <TableCell className="font-mono text-xs">{row.order_number}</TableCell>
                      <TableCell className="text-sm">{row.customer_name}</TableCell>
                      <TableCell className="font-mono text-xs">{row.resi || '—'}</TableCell>
                      <TableCell className="text-xs">{row.ekspedisi || '—'}</TableCell>
                      <TableCell>
                        {row.resi_status && (
                          <Badge variant="outline" className={`text-xs ${RESI_STATUSES.find(s => s.value === row.resi_status)?.color}`}>
                            {row.resi_status}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-32 truncate">{row.catatan || '—'}</TableCell>
                      <TableCell>
                        {row._error ? (
                          <div className="flex items-start gap-1">
                            <AlertCircle className="w-3 h-3 text-red-500 mt-0.5" />
                            <span className="text-xs text-red-600">{row._error}</span>
                          </div>
                        ) : (
                          <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">OK</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Update button */}
      {validCount > 0 && !updateResult && (
        <div className="flex items-center gap-4">
          <Button
            onClick={handleUpdate}
            disabled={updating}
            className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white"
          >
            {updating ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Mengupdate...</>
            ) : (
              <><Truck className="w-4 h-4 mr-2" />Update {validCount} Resi</>
            )}
          </Button>
          {errorCount > 0 && (
            <span className="text-sm text-muted-foreground">{errorCount} baris error dilewati</span>
          )}
        </div>
      )}

      {/* Result */}
      {updateResult && (
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="pt-6 pb-6">
            <div className="flex items-center gap-4">
              <CheckCircle2 className="w-8 h-8 text-emerald-500" />
              <div>
                <p className="font-semibold">Update Selesai!</p>
                <p className="text-sm text-muted-foreground">
                  {updateResult.success} resi diupdate
                  {updateResult.failed > 0 && `, ${updateResult.failed} gagal`}
                </p>
              </div>
              <div className="ml-auto flex gap-2">
                <Button variant="outline" size="sm" onClick={reset}>Upload Lagi</Button>
                <Button size="sm" render={<Link href="/orders/list" />} className="bg-violet-600 text-white">
                  Lihat Orders
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────
export default function BulkUploadPage() {
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" render={<Link href="/orders/list" />}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-transparent">
            Upload Massal
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Import order dari berbagai platform & update status resi secara massal
          </p>
        </div>
      </div>

      <Tabs defaultValue="upload-order">
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="upload-order" className="flex items-center gap-2">
            <FileText className="w-4 h-4" />
            Upload Order Baru
          </TabsTrigger>
          <TabsTrigger value="update-resi" className="flex items-center gap-2">
            <Truck className="w-4 h-4" />
            Update Status Resi
          </TabsTrigger>
        </TabsList>

        <div className="mt-6">
          <TabsContent value="upload-order">
            <UploadOrderTab />
          </TabsContent>
          <TabsContent value="update-resi">
            <UpdateResiTab />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  )
}
