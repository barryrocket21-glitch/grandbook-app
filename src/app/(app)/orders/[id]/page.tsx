'use client'
import { useState, useEffect, use } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, Pencil, History, FileText, Package, ShieldCheck, ChevronRight } from 'lucide-react'
import { canApproveOrders } from '@/lib/auth/permissions'
import { updateOrderStatus } from '@/lib/orders/order-number'
import { INTERNAL_STATUSES, STATUS_BADGE_COLOR, STATUS_LABEL } from '@/lib/schemas/settings'
import { OrderForm, type OrderFormDefaults } from '@/components/orders/order-form'
import { format, parseISO } from 'date-fns'
import type { OrderInputFormData, PaymentMethodEnum } from '@/lib/schemas/settings'
import type { OrderStatus } from '@/lib/types'

const supabase = createClient()

interface OrderDetail {
  id: number
  organization_id: number
  order_number: string
  external_order_id: string | null
  resi: string | null
  status: OrderStatus
  status_changed_at: string
  customer_name: string
  customer_phone: string | null
  customer_province: string | null
  customer_city: string | null
  customer_subdistrict: string | null
  customer_village: string | null
  customer_zip: string | null
  customer_address_detail: string | null
  customer_address: string | null
  wilayah_id: number | null
  channel_id: number | null
  source_profile_id: number | null
  subtotal: number
  shipping_cost: number
  shipping_cost_actual: number | null
  discount: number
  total: number
  cod_amount: number | null
  payout_amount: number | null
  payment_method: string
  cs_name: string | null
  cs_id: string | null
  advertiser_id: string | null
  admin_id: string | null
  created_by: string | null
  notes: string | null
  meta: Record<string, unknown> | null
  raw_data: Record<string, unknown> | null
  rate_snapshot: Record<string, unknown> | null
  order_date: string
  created_at: string
  updated_at: string
  channel?: { id: number; code: string; name: string }
  source_profile?: { id: number; code: string; name: string }
  cs?: { id: string; full_name: string }
  advertiser?: { id: string; full_name: string }
  creator?: { id: string; full_name: string }
}

interface OrderItem {
  id: number
  product_id: number | null
  product_name_raw: string
  variation: string | null
  qty: number
  price: number
  weight_per_unit: number | null
  notes: string | null
}

interface HistoryEntry {
  id: number
  from_status: OrderStatus | null
  to_status: OrderStatus
  changed_at: string
  changed_by: string | null
  source: string
  raw_status: string | null
  note: string | null
  changer?: { id: string; full_name: string }
}

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: paramId } = use(params)
  const orderId = Number(paramId)
  const { role } = useAuth()
  const canApprove = canApproveOrders(role)

  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [items, setItems] = useState<OrderItem[]>([])
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(true)

  const [statusOpen, setStatusOpen] = useState(false)
  const [newStatus, setNewStatus] = useState<OrderStatus>('SIAP_KIRIM')
  const [statusNote, setStatusNote] = useState('')
  const [statusRunning, setStatusRunning] = useState(false)

  const [editing, setEditing] = useState(false)
  const [savingEdit, setSavingEdit] = useState(false)

  const load = async () => {
    setLoading(true)
    const [{ data: o }, { data: itemRows }, { data: hist }] = await Promise.all([
      supabase
        .from('orders')
        .select(`
          *,
          channel:courier_channels(id, code, name),
          source_profile:converter_profiles(id, code, name),
          cs:profiles!orders_cs_id_fkey(id, full_name),
          advertiser:profiles!orders_advertiser_id_fkey(id, full_name),
          creator:profiles!orders_created_by_fkey(id, full_name)
        `)
        .eq('id', orderId)
        .single(),
      supabase.from('order_items').select('*').eq('order_id', orderId).order('id'),
      supabase
        .from('order_status_history')
        .select('*, changer:profiles!order_status_history_changed_by_fkey(id, full_name)')
        .eq('order_id', orderId)
        .order('changed_at', { ascending: false }),
    ])
    setOrder((o as any) || null)
    setItems((itemRows as any) || [])
    setHistory((hist as any) || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [orderId])

  const submitStatus = async () => {
    if (!order) return
    setStatusRunning(true)
    try {
      await updateOrderStatus(supabase, {
        orderId: order.id,
        newStatus,
        source: 'manual',
        note: statusNote.trim() || null,
      })
      toast.success(`Status berubah → ${newStatus}`)
      setStatusOpen(false)
      setStatusNote('')
      load()
    } catch (err: any) {
      toast.error('Gagal update status', { description: err.message })
    } finally {
      setStatusRunning(false)
    }
  }

  const submitEdit = async (data: OrderInputFormData) => {
    if (!order) return
    setSavingEdit(true)
    try {
      const orderUpdates = {
        customer_name: data.customer_name,
        customer_phone: data.customer_phone,
        customer_province: data.customer_province,
        customer_city: data.customer_city,
        customer_subdistrict: data.customer_subdistrict,
        customer_village: data.customer_village,
        customer_zip: data.customer_zip,
        customer_address_detail: data.customer_address_detail,
        wilayah_id: data.wilayah_id,
        channel_id: data.channel_id,
        subtotal: data.subtotal,
        shipping_cost: data.shipping_cost,
        discount: data.discount,
        total: data.total,
        payment_method: data.payment_method,
        cs_name: data.cs_name,
        cs_id: data.cs_id,
        advertiser_id: data.advertiser_id,
        notes: data.notes,
      }
      const { error: e1 } = await supabase.from('orders').update(orderUpdates).eq('id', order.id)
      if (e1) throw e1

      // Replace items: delete existing + insert new
      const { error: delErr } = await supabase.from('order_items').delete().eq('order_id', order.id)
      if (delErr) throw delErr
      const itemPayload = data.items.map((it) => ({
        organization_id: order.organization_id,
        order_id: order.id,
        product_id: it.product_id,
        product_name_raw: it.product_name_raw,
        variation: it.variation,
        qty: it.qty,
        price: it.price,
        weight_per_unit: it.weight_per_unit,
        notes: it.notes,
      }))
      const { error: insErr } = await supabase.from('order_items').insert(itemPayload)
      if (insErr) throw insErr

      toast.success('Order ter-update')
      setEditing(false)
      load()
    } catch (err: any) {
      toast.error('Gagal simpan', { description: err.message })
    } finally {
      setSavingEdit(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-10 bg-muted animate-pulse rounded w-64" />
        <Card><CardContent className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></CardContent></Card>
      </div>
    )
  }
  if (!order) {
    return (
      <div className="space-y-6">
        <Link href="/orders/list" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Kembali
        </Link>
        <Card><CardContent className="p-6 text-sm text-muted-foreground">Order tidak ditemukan.</CardContent></Card>
      </div>
    )
  }

  if (editing) {
    const defaults: OrderFormDefaults = {
      customer_name: order.customer_name,
      customer_phone: order.customer_phone || '',
      customer_province: order.customer_province || '',
      customer_city: order.customer_city || '',
      customer_subdistrict: order.customer_subdistrict || '',
      customer_village: order.customer_village || '',
      customer_zip: order.customer_zip || '',
      customer_address_detail: order.customer_address_detail || '',
      wilayah_id: order.wilayah_id,
      channel_id: order.channel_id,
      shipping_cost: Number(order.shipping_cost),
      discount: Number(order.discount),
      payment_method: (order.payment_method as PaymentMethodEnum) || 'COD',
      cs_name: order.cs_name,
      cs_id: order.cs_id,
      advertiser_id: order.advertiser_id,
      notes: order.notes || '',
      items: items.map((it) => ({
        product_id: it.product_id,
        product_name_raw: it.product_name_raw,
        variation: it.variation,
        qty: it.qty,
        price: Number(it.price),
        weight_per_unit: it.weight_per_unit ? Number(it.weight_per_unit) : null,
      })),
    }
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
            <ArrowLeft className="w-3.5 h-3.5 mr-1" />Batal Edit
          </Button>
          <h2 className="text-lg font-semibold">Edit Order {order.order_number}</h2>
        </div>
        <OrderForm
          defaults={defaults}
          onSubmit={submitEdit}
          submitting={savingEdit}
          submitLabel="Simpan Perubahan"
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/orders/list" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Kembali
        </Link>
      </div>

      <Card>
        <CardContent className="pt-4 pb-4 flex items-start justify-between flex-wrap gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold font-mono">{order.order_number}</h1>
              <Badge variant="outline" className={STATUS_BADGE_COLOR[order.status]}>
                {STATUS_LABEL[order.status]}
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground space-x-3">
              <span>Order Date: {fmt(order.order_date)}</span>
              <span>Created: {fmtFull(order.created_at)}</span>
              {order.creator?.full_name && <span>by {order.creator.full_name}</span>}
            </div>
          </div>
          {canApprove && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                <Pencil className="w-3.5 h-3.5 mr-1" />Edit Order
              </Button>
              <Button size="sm" onClick={() => setStatusOpen(true)} variant="outline">
                <History className="w-3.5 h-3.5 mr-1" />Edit Status
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="info">
        <TabsList>
          <TabsTrigger value="info"><FileText className="w-3.5 h-3.5 mr-1" />Info</TabsTrigger>
          <TabsTrigger value="items"><Package className="w-3.5 h-3.5 mr-1" />Items ({items.length})</TabsTrigger>
          <TabsTrigger value="timeline"><History className="w-3.5 h-3.5 mr-1" />Timeline ({history.length})</TabsTrigger>
          <TabsTrigger value="audit"><ShieldCheck className="w-3.5 h-3.5 mr-1" />Audit</TabsTrigger>
        </TabsList>

        <TabsContent value="info" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardContent className="pt-4 pb-4 space-y-2 text-sm">
                <h3 className="font-semibold text-base flex items-center gap-2">
                  <span className="w-1.5 h-5 bg-violet-500 rounded" />Customer
                </h3>
                <Field label="Nama" value={order.customer_name} />
                <Field label="No HP" value={order.customer_phone || '—'} />
                <Field label="Provinsi" value={order.customer_province || '—'} />
                <Field label="Kota" value={order.customer_city || '—'} />
                <Field label="Kecamatan" value={order.customer_subdistrict || '—'} />
                <Field label="Kelurahan" value={order.customer_village || '—'} />
                <Field label="Kode Pos" value={order.customer_zip || '—'} />
                <Field label="Detail" value={order.customer_address_detail || '—'} />
                {order.wilayah_id && (
                  <div className="text-xs text-muted-foreground">Wilayah ID: {order.wilayah_id}</div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4 pb-4 space-y-2 text-sm">
                <h3 className="font-semibold text-base flex items-center gap-2">
                  <span className="w-1.5 h-5 bg-indigo-500 rounded" />Pengiriman & Pembayaran
                </h3>
                <Field
                  label="Channel"
                  value={
                    order.channel
                      ? <span className="font-mono text-xs">{order.channel.code} — {order.channel.name}</span>
                      : '—'
                  }
                />
                <Field label="Resi" value={order.resi || <span className="italic text-muted-foreground">belum ada</span>} />
                <Field label="Payment Method" value={order.payment_method} />
                <Field label="Subtotal" value={`Rp ${Number(order.subtotal).toLocaleString('id-ID')}`} />
                <Field label="Ongkir" value={`Rp ${Number(order.shipping_cost).toLocaleString('id-ID')}`} />
                <Field label="Diskon" value={`Rp ${Number(order.discount).toLocaleString('id-ID')}`} />
                <Field label="Total" value={<span className="font-bold">Rp {Number(order.total).toLocaleString('id-ID')}</span>} />
                {order.cod_amount != null && (
                  <Field label="COD" value={`Rp ${Number(order.cod_amount).toLocaleString('id-ID')}`} />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4 pb-4 space-y-2 text-sm">
                <h3 className="font-semibold text-base flex items-center gap-2">
                  <span className="w-1.5 h-5 bg-emerald-500 rounded" />People
                </h3>
                <Field label="CS Name" value={order.cs_name || order.cs?.full_name || '—'} />
                <Field label="Advertiser" value={order.advertiser?.full_name || '—'} />
                <Field label="Created By" value={order.creator?.full_name || '—'} />
                <Field label="Source Profile" value={order.source_profile?.code || '—'} />
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4 pb-4 space-y-2 text-sm">
                <h3 className="font-semibold text-base flex items-center gap-2">
                  <span className="w-1.5 h-5 bg-amber-500 rounded" />Notes
                </h3>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {order.notes || '—'}
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="items">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Variation</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Subtotal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Belum ada item</TableCell></TableRow>
                  ) : items.map((it) => (
                    <TableRow key={it.id}>
                      <TableCell>{it.product_name_raw}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{it.variation || '—'}</TableCell>
                      <TableCell className="text-right">{it.qty}</TableCell>
                      <TableCell className="text-right font-mono text-xs">Rp {Number(it.price).toLocaleString('id-ID')}</TableCell>
                      <TableCell className="text-right font-mono text-xs">Rp {(it.qty * Number(it.price)).toLocaleString('id-ID')}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {items.length > 0 && (
                <div className="border-t p-3 text-right text-sm">
                  Subtotal items: <span className="font-bold">Rp {items.reduce((s, it) => s + it.qty * Number(it.price), 0).toLocaleString('id-ID')}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="timeline">
          <Card>
            <CardContent className="pt-4 pb-4">
              {history.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-8">Belum ada history</div>
              ) : (
                <div className="space-y-3">
                  {history.map((h, idx) => (
                    <div key={h.id} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className={`w-3 h-3 rounded-full ${idx === 0 ? 'bg-violet-500' : 'bg-muted-foreground/40'}`} />
                        {idx < history.length - 1 && <div className="w-px flex-1 bg-muted-foreground/20 my-1" />}
                      </div>
                      <div className="flex-1 pb-3 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          {h.from_status && (
                            <>
                              <Badge variant="outline" className={STATUS_BADGE_COLOR[h.from_status]}>{STATUS_LABEL[h.from_status]}</Badge>
                              <ChevronRight className="w-3 h-3 text-muted-foreground" />
                            </>
                          )}
                          <Badge variant="outline" className={STATUS_BADGE_COLOR[h.to_status]}>{STATUS_LABEL[h.to_status]}</Badge>
                          <Badge variant="outline" className="text-[10px]">{h.source}</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {fmtFull(h.changed_at)}
                          {h.changer?.full_name && ` · oleh ${h.changer.full_name}`}
                        </div>
                        {h.note && <div className="text-xs">{h.note}</div>}
                        {h.raw_status && <div className="text-[10px] text-muted-foreground">raw: {h.raw_status}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit">
          <Card>
            <CardContent className="pt-4 pb-4 space-y-3 text-xs">
              <div>
                <div className="text-muted-foreground mb-1">Timestamps</div>
                <div className="font-mono">created_at: {fmtFull(order.created_at)}</div>
                <div className="font-mono">updated_at: {fmtFull(order.updated_at)}</div>
                <div className="font-mono">status_changed_at: {fmtFull(order.status_changed_at)}</div>
              </div>
              {order.external_order_id && (
                <div>
                  <div className="text-muted-foreground mb-1">External ID</div>
                  <div className="font-mono">{order.external_order_id}</div>
                </div>
              )}
              {order.rate_snapshot && (
                <details>
                  <summary className="cursor-pointer text-muted-foreground">Rate Snapshot</summary>
                  <pre className="mt-2 p-2 bg-muted rounded overflow-x-auto">
                    {JSON.stringify(order.rate_snapshot, null, 2)}
                  </pre>
                </details>
              )}
              {order.meta && (
                <details>
                  <summary className="cursor-pointer text-muted-foreground">Meta</summary>
                  <pre className="mt-2 p-2 bg-muted rounded overflow-x-auto">
                    {JSON.stringify(order.meta, null, 2)}
                  </pre>
                </details>
              )}
              {order.raw_data && (
                <details>
                  <summary className="cursor-pointer text-muted-foreground">Raw Data (dari source file)</summary>
                  <pre className="mt-2 p-2 bg-muted rounded overflow-x-auto max-h-80">
                    {JSON.stringify(order.raw_data, null, 2)}
                  </pre>
                </details>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={statusOpen} onOpenChange={(v) => { setStatusOpen(v); if (!v) setStatusNote('') }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Edit Status</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              Status saat ini: <Badge variant="outline" className={STATUS_BADGE_COLOR[order.status]}>{STATUS_LABEL[order.status]}</Badge>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Status Baru *</Label>
              <Select value={newStatus} onValueChange={(v) => v && setNewStatus(v as OrderStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="w-[260px]">
                  {INTERNAL_STATUSES.filter((s) => s !== order.status).map((s) => (
                    <SelectItem key={s} value={s}>{STATUS_LABEL[s]} ({s})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Note (optional)</Label>
              <Textarea value={statusNote} onChange={(e) => setStatusNote(e.target.value)} rows={3} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStatusOpen(false)}>Batal</Button>
              <Button
                onClick={submitStatus}
                disabled={statusRunning}
                className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white"
              >
                {statusRunning && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}Update
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="col-span-2 text-sm">{value}</div>
    </div>
  )
}

function fmt(iso: string): string {
  try { return format(parseISO(iso), 'dd MMM yyyy') } catch { return iso }
}
function fmtFull(iso: string): string {
  try { return format(parseISO(iso), 'dd MMM yyyy HH:mm') } catch { return iso }
}
