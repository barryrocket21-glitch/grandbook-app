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
import { toast } from 'sonner'
import {
  Upload, Download, FileText, AlertCircle, CheckCircle2,
  ArrowLeft, Loader2, RefreshCw, Truck, Package
} from 'lucide-react'
import Link from 'next/link'
import { formatRupiah } from '@/lib/format'
import {
  UPLOAD_TEMPLATES, RESI_UPDATE_HEADERS, parseCSV, parseSPXExport,
  generateCSV, downloadCSV, generateSPXTemplate, generateMengantarTemplate,
  SPX_STATUS_MAP, type ParsedOrderRow, type ParsedResiRow, type ShippingOrder
} from '@/lib/templates'
import { RESI_STATUSES, EKSPEDISI_LIST } from '@/lib/constants'
import type { Campaign, Profile, Product } from '@/lib/types'

const supabase = createClient()

// ─────────────────────────────────────────────────────────────────
// TAB 1: IMPORT ORDER BARU
// ─────────────────────────────────────────────────────────────────
function ImportOrderTab() {
  const { profile } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)

  const [templateId, setTemplateId] = useState('orderonline')
  const [rows, setRows] = useState<ParsedOrderRow[]>([])
  const [fileName, setFileName] = useState('')
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [csUsers, setCsUsers] = useState<Profile[]>([])
  const [advUsers, setAdvUsers] = useState<Profile[]>([])
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
        if (parsed.length === 0) toast.error('Tidak ada data yang berhasil dibaca.')
        else toast.success(`${parsed.length} baris dibaca`)
      },
      error: (err) => toast.error(`Gagal membaca file: ${err.message}`),
    })
  }

  const handleImport = async () => {
    if (validRows.length === 0) return
    setImporting(true)
    let success = 0, failed = 0

    for (const row of validRows) {
      try {
        let productId: number | null = null
        let hppSnapshot = 0
        let unitPrice = row.price ?? 0

        if (row.product_sku) {
          const p = products.find(p => p.sku === row.product_sku)
          if (p) { productId = p.id; hppSnapshot = p.hpp; if (!unitPrice) unitPrice = p.price_default }
        }
        if (!productId && row.product_name) {
          const p = products.find(p => p.name.toLowerCase().includes((row.product_name || '').toLowerCase()))
          if (p) { productId = p.id; hppSnapshot = p.hpp; if (!unitPrice) unitPrice = p.price_default }
        }

        const qty = row.qty ?? 1
        const shippingCost = row.shipping_cost ?? 0
        const discount = row.discount ?? 0
        const subtotal = unitPrice * qty
        const total = subtotal + shippingCost - discount

        const resolvedCampaignId = campaignId ? Number(campaignId) : (() => {
          if (row.utm_campaign && campaigns.length > 0) {
            const c = campaigns.find(c => c.campaign_name.toLowerCase().includes((row.utm_campaign || '').toLowerCase()))
            return c?.id || null
          }
          return null
        })()

        const { data: orderNumData } = await supabase.rpc('generate_order_number')

        const notes = [row.notes, row.customer_postal_code ? `Kode Pos: ${row.customer_postal_code}` : '']
          .filter(Boolean).join(' | ') || null

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
          payment_method: row.payment_method === 'TRANSFER' ? 'TRANSFER' : 'COD',
          status: 'BARU',
          campaign_id: resolvedCampaignId,
          advertiser_id: advertiserId || null,
          cs_id: csId || null,
          admin_id: profile?.id || null,
          notes,
          resi: row.resi || null,
          ekspedisi: row.ekspedisi || null,
          resi_status: row.resi ? 'AKTIF' : null,
        }

        const { data: order, error: orderErr } = await supabase
          .from('orders').insert(orderPayload).select('id').single()
        if (orderErr) { failed++; continue }

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
      } catch (e) { console.error('Import row failed:', e); failed++ }
    }

    setImporting(false)
    setImportResult({ success, failed })
    toast.success(`Import selesai: ${success} berhasil, ${failed} gagal`)
  }

  const reset = () => {
    setRows([]); setFileName(''); setImportResult(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="space-y-6">
      {/* Step 1: Template */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Pilih Format File</CardTitle>
          <CardDescription>Sesuaikan dengan sumber data order kamu</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {UPLOAD_TEMPLATES.map(t => (
              <button key={t.id} onClick={() => { setTemplateId(t.id); reset() }}
                className={`text-left p-3 rounded-lg border-2 transition-all ${templateId === t.id ? 'border-violet-600 bg-violet-500/5' : 'border-border hover:border-violet-400'}`}>
                <div className="font-semibold text-sm">{t.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{t.description}</div>
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={handleDownloadTemplate}>
            <Download className="w-4 h-4 mr-2" />Download Template {template.label}
          </Button>
        </CardContent>
      </Card>

      {/* Step 2: Upload */}
      <Card>
        <CardHeader><CardTitle className="text-base">2. Upload File CSV</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-muted-foreground/30 rounded-lg cursor-pointer hover:border-violet-500/50 hover:bg-violet-500/5 transition-all">
            <Upload className="w-8 h-8 text-muted-foreground mb-2" />
            <span className="text-sm text-muted-foreground">{fileName || 'Klik atau drag file CSV di sini'}</span>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
          </label>
          {rows.length > 0 && (
            <div className="flex items-center gap-3 flex-wrap">
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="w-3 h-3 mr-1" />{validRows.length} valid
              </Badge>
              {errorRows.length > 0 && (
                <Badge variant="outline" className="bg-red-500/10 text-red-700 dark:text-red-400">
                  <AlertCircle className="w-3 h-3 mr-1" />{errorRows.length} error
                </Badge>
              )}
              <Button variant="ghost" size="sm" onClick={reset}><RefreshCw className="w-3 h-3 mr-1" />Reset</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step 3: Assign */}
      {validRows.length > 0 && !importResult && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">3. Assign Campaign & Tim (Opsional)</CardTitle>
            <CardDescription>
              Diterapkan ke semua {validRows.length} order.
              {rows.some(r => r.utm_campaign) && ' UTM campaign akan di-match otomatis ke campaign yang ada.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label>Campaign (override)</Label>
                <Select value={campaignId} onValueChange={v => setCampaignId(!v || v === 'none' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="Auto dari UTM / pilih..." /></SelectTrigger>
                  <SelectContent className="w-[300px]">
                    <SelectItem value="none">— Auto dari UTM —</SelectItem>
                    {campaigns.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.campaign_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Advertiser</Label>
                <Select value={advertiserId} onValueChange={v => setAdvertiserId(!v || v === 'none' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="Pilih advertiser..." /></SelectTrigger>
                  <SelectContent className="w-[260px]">
                    <SelectItem value="none">— Tanpa Advertiser —</SelectItem>
                    {advUsers.map(u => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>CS</Label>
                <Select value={csId} onValueChange={v => setCsId(!v || v === 'none' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="Pilih CS..." /></SelectTrigger>
                  <SelectContent className="w-[260px]">
                    <SelectItem value="none">— Tanpa CS —</SelectItem>
                    {csUsers.map(u => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Preview */}
      {rows.length > 0 && !importResult && (
        <Card>
          <CardHeader><CardTitle className="text-base">4. Preview</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto max-h-80">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>Tanggal</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Produk (SKU)</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Harga</TableHead>
                    <TableHead>Bayar</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, i) => (
                    <TableRow key={i} className={row._errors!.length > 0 ? 'bg-red-500/5' : ''}>
                      <TableCell className="text-xs text-muted-foreground">{row._row}</TableCell>
                      <TableCell className="text-xs">{row.order_date}</TableCell>
                      <TableCell>
                        <p className="text-sm font-medium">{row.customer_name}</p>
                        <p className="text-xs text-muted-foreground">{row.customer_city}</p>
                      </TableCell>
                      <TableCell className="text-xs font-mono">{row.product_sku || row.product_name || '—'}</TableCell>
                      <TableCell className="text-right text-xs">{row.qty}</TableCell>
                      <TableCell className="text-right text-xs">{row.price ? formatRupiah(row.price) : '—'}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{row.payment_method || 'COD'}</Badge></TableCell>
                      <TableCell>
                        {row._errors!.length > 0 ? (
                          <div className="flex items-start gap-1">
                            <AlertCircle className="w-3 h-3 text-red-500 mt-0.5 shrink-0" />
                            <span className="text-xs text-red-600">{row._errors!.join(', ')}</span>
                          </div>
                        ) : <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">OK</Badge>}
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
          <Button onClick={handleImport} disabled={importing} className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white">
            {importing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Mengimport...</> : <><Upload className="w-4 h-4 mr-2" />Import {validRows.length} Order</>}
          </Button>
          {errorRows.length > 0 && <span className="text-sm text-muted-foreground">{errorRows.length} baris error dilewati</span>}
        </div>
      )}

      {importResult && (
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="pt-6 pb-6 flex items-center gap-4">
            <CheckCircle2 className="w-8 h-8 text-emerald-500" />
            <div>
              <p className="font-semibold">Import Selesai!</p>
              <p className="text-sm text-muted-foreground">{importResult.success} order berhasil{importResult.failed > 0 && `, ${importResult.failed} gagal`}</p>
            </div>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm" onClick={reset}>Upload Lagi</Button>
              <Button size="sm" render={<Link href="/orders/list" />} className="bg-violet-600 text-white">Lihat Orders</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// TAB 2: GENERATE TEMPLATE KIRIM (GrandBook → SPX / mengantar)
// ─────────────────────────────────────────────────────────────────
function GenerateShippingTab() {
  const [ekspedisi, setEkspedisi] = useState<'spx' | 'mengantar'>('spx')
  const [dateFrom, setDateFrom] = useState(() => new Date().toISOString().split('T')[0])
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0])
  const [statusFilter, setStatusFilter] = useState('BARU')
  const [orders, setOrders] = useState<ShippingOrder[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const fetchOrders = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('orders')
      .select('order_number, customer_name, customer_phone, customer_address, customer_city, customer_province, total, payment_method, notes, order_items(qty, products(name))')
      .eq('status', statusFilter)
      .gte('order_date', dateFrom)
      .lte('order_date', dateTo)
      .order('created_at', { ascending: false })

    if (error) { toast.error(error.message); setLoading(false); return }

    const mapped: ShippingOrder[] = (data || []).map((o: any) => ({
      order_number: o.order_number,
      customer_name: o.customer_name,
      customer_phone: o.customer_phone,
      customer_address: o.customer_address,
      customer_city: o.customer_city,
      customer_province: o.customer_province,
      total: o.total,
      payment_method: o.payment_method,
      notes: o.notes,
      items: (o.order_items || []).map((i: any) => ({ product_name: i.products?.name || '', qty: i.qty })),
    }))
    setOrders(mapped)
    setSelected(new Set(mapped.map(o => o.order_number)))
    setLoading(false)
  }

  const toggleAll = () => {
    if (selected.size === orders.length) setSelected(new Set())
    else setSelected(new Set(orders.map(o => o.order_number)))
  }

  const toggleOne = (num: string) => {
    const s = new Set(selected)
    if (s.has(num)) s.delete(num); else s.add(num)
    setSelected(s)
  }

  const handleGenerate = () => {
    const sel = orders.filter(o => selected.has(o.order_number))
    if (sel.length === 0) { toast.error('Pilih minimal 1 order'); return }
    const date = new Date().toISOString().split('T')[0]
    if (ekspedisi === 'spx') {
      downloadCSV(`SPX_upload_${date}.csv`, generateSPXTemplate(sel))
      toast.success(`Template SPX untuk ${sel.length} order didownload`)
    } else {
      downloadCSV(`mengantar_upload_${date}.csv`, generateMengantarTemplate(sel))
      toast.success(`Template mengantar.com untuk ${sel.length} order didownload`)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="w-4 h-4" />Generate Template Kirim
          </CardTitle>
          <CardDescription>
            Buat file CSV siap upload ke SPX atau mengantar.com dari order di GrandBook.
            Kolom Kecamatan dan Kode Pos perlu diisi manual sebelum upload ke ekspedisi.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Target ekspedisi */}
          <div className="grid grid-cols-2 gap-3 max-w-sm">
            <button onClick={() => setEkspedisi('spx')}
              className={`p-3 rounded-lg border-2 text-center transition-all ${ekspedisi === 'spx' ? 'border-violet-600 bg-violet-500/5' : 'border-border hover:border-violet-400'}`}>
              <div className="font-semibold text-sm">SPX</div>
              <div className="text-xs text-muted-foreground">Shopee Express</div>
            </button>
            <button onClick={() => setEkspedisi('mengantar')}
              className={`p-3 rounded-lg border-2 text-center transition-all ${ekspedisi === 'mengantar' ? 'border-violet-600 bg-violet-500/5' : 'border-border hover:border-violet-400'}`}>
              <div className="font-semibold text-sm">mengantar.com</div>
              <div className="text-xs text-muted-foreground">Platform COD</div>
            </button>
          </div>

          {/* Filter */}
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={statusFilter} onValueChange={v => v && setStatusFilter(v)}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent className="w-[160px]">
                  <SelectItem value="BARU">Baru</SelectItem>
                  <SelectItem value="DIPROSES">Diproses</SelectItem>
                  <SelectItem value="DIKIRIM">Dikirim</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Dari</Label>
              <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
            </div>
            <div className="space-y-1.5">
              <Label>Sampai</Label>
              <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-40" />
            </div>
            <Button onClick={fetchOrders} disabled={loading} variant="outline">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Tampilkan Order'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {orders.length > 0 && (
        <>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{orders.length} Order Ditemukan</CardTitle>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">{selected.size} dipilih</span>
                  <Button variant="ghost" size="sm" onClick={toggleAll}>
                    {selected.size === orders.length ? 'Deselect All' : 'Select All'}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto max-h-80">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10"></TableHead>
                      <TableHead>No. Order</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Kota</TableHead>
                      <TableHead>Produk</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Bayar</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map(o => (
                      <TableRow key={o.order_number} className={selected.has(o.order_number) ? '' : 'opacity-40'}>
                        <TableCell>
                          <input type="checkbox" checked={selected.has(o.order_number)} onChange={() => toggleOne(o.order_number)} className="rounded" />
                        </TableCell>
                        <TableCell className="font-mono text-xs">{o.order_number}</TableCell>
                        <TableCell>
                          <p className="text-sm font-medium">{o.customer_name}</p>
                          <p className="text-xs text-muted-foreground">{o.customer_phone}</p>
                        </TableCell>
                        <TableCell className="text-xs">{o.customer_city}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {o.items?.map(i => `${i.product_name} x${i.qty}`).join(', ') || '—'}
                        </TableCell>
                        <TableCell className="text-right font-semibold text-sm">{formatRupiah(o.total)}</TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{o.payment_method}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center gap-3">
            <Button onClick={handleGenerate} disabled={selected.size === 0} className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white">
              <Download className="w-4 h-4 mr-2" />
              Download Template {ekspedisi === 'spx' ? 'SPX' : 'mengantar.com'} ({selected.size} order)
            </Button>
            <p className="text-xs text-muted-foreground">
              {ekspedisi === 'spx' ? 'Isi Kecamatan & Kode Pos sebelum upload ke SPX dashboard' : 'Isi Kelurahan & Kode Pos sebelum upload ke mengantar.com'}
            </p>
          </div>
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// TAB 3: UPDATE STATUS RESI
// ─────────────────────────────────────────────────────────────────
function UpdateResiTab() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<'spx-export' | 'manual'>('spx-export')
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState<ParsedResiRow[]>([])
  const [manualRows, setManualRows] = useState<any[]>([])
  const [updating, setUpdating] = useState(false)
  const [updateResult, setUpdateResult] = useState<{ success: number; failed: number } | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [dateFrom, setDateFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0] })
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0])

  const validRows = mode === 'spx-export' ? rows.filter(r => r._valid) : manualRows.filter(r => r._valid)
  const errorCount = mode === 'spx-export' ? rows.filter(r => !r._valid).length : manualRows.filter(r => !r._valid).length

  const handleDownloadManualTemplate = async () => {
    setDownloading(true)
    const { data, error } = await supabase
      .from('orders').select('order_number, customer_name, resi, ekspedisi, resi_status')
      .eq('status', 'DIKIRIM').gte('order_date', dateFrom).lte('order_date', dateTo)
      .order('order_date', { ascending: false })
    if (error) { toast.error(error.message); setDownloading(false); return }
    const csvRows = (data || []).map(o => [o.order_number, o.customer_name, o.resi || '', o.ekspedisi || '', o.resi_status || 'AKTIF', ''])
    downloadCSV(`update_resi_${dateFrom}_${dateTo}.csv`, generateCSV(RESI_UPDATE_HEADERS, csvRows))
    setDownloading(false)
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setRows([]); setManualRows([]); setUpdateResult(null)

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        if (mode === 'spx-export') {
          // Skip row 0 if it's the report timestamp row
          let data = result.data
          if (data[0] && !data[0]['Tracking No.']) data = data.slice(1)
          const parsed = parseSPXExport(data)
          setRows(parsed)
          toast.success(`${parsed.length} baris dibaca dari export SPX`)
        } else {
          const VALID_STATUS = ['AKTIF', 'DITERIMA', 'PROBLEM', 'RETUR']
          const parsed = result.data.map((row: any, idx) => {
            const orderNumber = (row[RESI_UPDATE_HEADERS[0]] || '').trim()
            const resiStatus = (row[RESI_UPDATE_HEADERS[4]] || '').trim().toUpperCase()
            const error = !orderNumber ? 'No Order kosong'
              : resiStatus && !VALID_STATUS.includes(resiStatus) ? `Status tidak valid: ${resiStatus}`
              : undefined
            return {
              order_number: orderNumber, customer_name: (row[RESI_UPDATE_HEADERS[1]] || '').trim(),
              resi: (row[RESI_UPDATE_HEADERS[2]] || '').trim(), ekspedisi: (row[RESI_UPDATE_HEADERS[3]] || '').trim().toUpperCase(),
              resi_status: resiStatus, catatan: (row[RESI_UPDATE_HEADERS[5]] || '').trim(),
              _row: idx + 2, _valid: !error, _error: error,
            }
          }).filter((r: any) => r.order_number)
          setManualRows(parsed)
          toast.success(`${parsed.length} baris dibaca`)
        }
      },
      error: (err) => toast.error(`Gagal membaca: ${err.message}`),
    })
  }

  const handleUpdate = async () => {
    setUpdating(true)
    let success = 0, failed = 0

    if (mode === 'spx-export') {
      for (const row of validRows as ParsedResiRow[]) {
        const { error } = await supabase.from('orders')
          .update({ resi: row.resi, resi_status: row.resi_status, ekspedisi: 'SPX' })
          .eq('resi', row.resi)
        if (error) failed++; else success++
      }
    } else {
      for (const row of manualRows.filter((r: any) => r._valid)) {
        const payload: Record<string, string | null> = {}
        if (row.resi) payload.resi = row.resi
        if (row.ekspedisi) payload.ekspedisi = row.ekspedisi
        if (row.resi_status) payload.resi_status = row.resi_status
        if (row.catatan) payload.notes = row.catatan
        const { error } = await supabase.from('orders').update(payload).eq('order_number', row.order_number)
        if (error) failed++; else success++
      }
    }

    setUpdating(false)
    setUpdateResult({ success, failed })
    toast.success(`Update selesai: ${success} berhasil, ${failed} gagal`)
  }

  const reset = () => { setRows([]); setManualRows([]); setFileName(''); setUpdateResult(null); if (fileRef.current) fileRef.current.value = '' }

  return (
    <div className="space-y-6">
      {/* Mode switch */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Truck className="w-4 h-4" />Update Status Resi</CardTitle>
          <CardDescription>Update no. resi dan status pengiriman secara massal</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 max-w-md">
            <button onClick={() => { setMode('spx-export'); reset() }}
              className={`p-3 rounded-lg border-2 text-left transition-all ${mode === 'spx-export' ? 'border-violet-600 bg-violet-500/5' : 'border-border hover:border-violet-400'}`}>
              <div className="font-semibold text-sm">Auto dari SPX Export</div>
              <div className="text-xs text-muted-foreground mt-0.5">Upload file export SPX — status di-map otomatis</div>
            </button>
            <button onClick={() => { setMode('manual'); reset() }}
              className={`p-3 rounded-lg border-2 text-left transition-all ${mode === 'manual' ? 'border-violet-600 bg-violet-500/5' : 'border-border hover:border-violet-400'}`}>
              <div className="font-semibold text-sm">Manual (Template CSV)</div>
              <div className="text-xs text-muted-foreground mt-0.5">Download template, isi status, upload balik</div>
            </button>
          </div>

          {mode === 'spx-export' && (
            <div className="rounded-lg bg-muted/50 p-3 text-xs space-y-1">
              <p className="font-medium">Mapping status SPX otomatis:</p>
              <div className="grid grid-cols-2 gap-1 mt-1">
                {Object.entries(SPX_STATUS_MAP).map(([from, to]) => {
                  const s = RESI_STATUSES.find(r => r.value === to)
                  return <div key={from} className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">{from} →</span>
                    <Badge variant="outline" className={`text-xs ${s?.color}`}>{to}</Badge>
                  </div>
                })}
              </div>
            </div>
          )}

          {mode === 'manual' && (
            <div className="flex flex-wrap gap-3 items-end">
              <div className="space-y-1.5">
                <Label>Dari Tanggal</Label>
                <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
              </div>
              <div className="space-y-1.5">
                <Label>Sampai Tanggal</Label>
                <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-40" />
              </div>
              <Button variant="outline" onClick={handleDownloadManualTemplate} disabled={downloading}>
                {downloading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                Download Template
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Upload */}
      <Card>
        <CardHeader><CardTitle className="text-base">Upload File CSV</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-muted-foreground/30 rounded-lg cursor-pointer hover:border-violet-500/50 hover:bg-violet-500/5 transition-all">
            <Upload className="w-6 h-6 text-muted-foreground mb-1" />
            <span className="text-sm text-muted-foreground">{fileName || 'Klik atau drag file CSV di sini'}</span>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
          </label>
          {(rows.length > 0 || manualRows.length > 0) && (
            <div className="flex items-center gap-3 flex-wrap">
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="w-3 h-3 mr-1" />{validRows.length} valid
              </Badge>
              {errorCount > 0 && <Badge variant="outline" className="bg-red-500/10 text-red-700 dark:text-red-400">
                <AlertCircle className="w-3 h-3 mr-1" />{errorCount} error
              </Badge>}
              <Button variant="ghost" size="sm" onClick={reset}><RefreshCw className="w-3 h-3 mr-1" />Reset</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Preview */}
      {(rows.length > 0 || manualRows.length > 0) && !updateResult && (
        <Card>
          <CardHeader><CardTitle className="text-base">Preview Perubahan</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto max-h-72">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    {mode === 'spx-export' ? <>
                      <TableHead>No Resi</TableHead>
                      <TableHead>Penerima</TableHead>
                      <TableHead>Status SPX</TableHead>
                      <TableHead>→ Status GrandBook</TableHead>
                    </> : <>
                      <TableHead>No Order</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>No Resi Baru</TableHead>
                      <TableHead>Ekspedisi</TableHead>
                      <TableHead>Status</TableHead>
                    </>}
                    <TableHead>Validasi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mode === 'spx-export' ? rows.map((r, i) => (
                    <TableRow key={i} className={!r._valid ? 'bg-red-500/5' : ''}>
                      <TableCell className="text-xs text-muted-foreground">{r._row}</TableCell>
                      <TableCell className="font-mono text-xs">{r.resi}</TableCell>
                      <TableCell className="text-sm">{r.recipient_name}</TableCell>
                      <TableCell className="text-xs">{r.tracking_status}</TableCell>
                      <TableCell>
                        {r.resi_status && <Badge variant="outline" className={`text-xs ${RESI_STATUSES.find(s => s.value === r.resi_status)?.color}`}>{r.resi_status}</Badge>}
                      </TableCell>
                      <TableCell>{r._error ? <span className="text-xs text-red-600 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{r._error}</span> : <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">OK</Badge>}</TableCell>
                    </TableRow>
                  )) : manualRows.map((r: any, i) => (
                    <TableRow key={i} className={!r._valid ? 'bg-red-500/5' : ''}>
                      <TableCell className="text-xs text-muted-foreground">{r._row}</TableCell>
                      <TableCell className="font-mono text-xs">{r.order_number}</TableCell>
                      <TableCell className="text-sm">{r.customer_name}</TableCell>
                      <TableCell className="font-mono text-xs">{r.resi || '—'}</TableCell>
                      <TableCell className="text-xs">{r.ekspedisi || '—'}</TableCell>
                      <TableCell>{r.resi_status && <Badge variant="outline" className={`text-xs ${RESI_STATUSES.find(s => s.value === r.resi_status)?.color}`}>{r.resi_status}</Badge>}</TableCell>
                      <TableCell>{r._error ? <span className="text-xs text-red-600 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{r._error}</span> : <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">OK</Badge>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {validRows.length > 0 && !updateResult && (
        <div className="flex items-center gap-4">
          <Button onClick={handleUpdate} disabled={updating} className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white">
            {updating ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Mengupdate...</> : <><Truck className="w-4 h-4 mr-2" />Update {validRows.length} Resi</>}
          </Button>
          {errorCount > 0 && <span className="text-sm text-muted-foreground">{errorCount} baris error dilewati</span>}
        </div>
      )}

      {updateResult && (
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="pt-6 pb-6 flex items-center gap-4">
            <CheckCircle2 className="w-8 h-8 text-emerald-500" />
            <div>
              <p className="font-semibold">Update Selesai!</p>
              <p className="text-sm text-muted-foreground">{updateResult.success} resi diupdate{updateResult.failed > 0 && `, ${updateResult.failed} gagal`}</p>
            </div>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm" onClick={reset}>Upload Lagi</Button>
              <Button size="sm" render={<Link href="/orders/list" />} className="bg-violet-600 text-white">Lihat Orders</Button>
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
        <Button variant="ghost" size="icon" render={<Link href="/orders/list" />}><ArrowLeft className="w-4 h-4" /></Button>
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-transparent">Upload Massal</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Import order · Generate template kirim · Update status resi</p>
        </div>
      </div>

      <Tabs defaultValue="import">
        <TabsList className="grid w-full grid-cols-3 max-w-lg">
          <TabsTrigger value="import" className="flex items-center gap-2">
            <FileText className="w-4 h-4" />Import Order
          </TabsTrigger>
          <TabsTrigger value="generate" className="flex items-center gap-2">
            <Package className="w-4 h-4" />Generate Kirim
          </TabsTrigger>
          <TabsTrigger value="resi" className="flex items-center gap-2">
            <Truck className="w-4 h-4" />Update Resi
          </TabsTrigger>
        </TabsList>

        <div className="mt-6">
          <TabsContent value="import"><ImportOrderTab /></TabsContent>
          <TabsContent value="generate"><GenerateShippingTab /></TabsContent>
          <TabsContent value="resi"><UpdateResiTab /></TabsContent>
        </div>
      </Tabs>
    </div>
  )
}
