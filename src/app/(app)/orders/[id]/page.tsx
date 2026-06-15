'use client'
import { useState, useEffect, use } from 'react'
import { getErrorMessage } from '@/lib/errors'
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
import { ArrowLeft, Loader2, Pencil, History, FileText, Package, ShieldCheck, ChevronRight, Coins, RefreshCw } from 'lucide-react'
import { canApproveOrders } from '@/lib/auth/permissions'
import { updateOrderStatus } from '@/lib/orders/order-number'
import { INTERNAL_STATUSES, STATUS_BADGE_COLOR, STATUS_LABEL, BILLING_MODEL_SHORT } from '@/lib/schemas/settings'
import { fetchChannelCostBundle, recomputeOrderCosts, type ChannelCostBundle } from '@/lib/supabase/queries/billing-config'
import { formatRupiah, formatDateTime } from '@/lib/format'
import { OrderForm, type OrderFormDefaults } from '@/components/orders/order-form'
import { ResiLifecycleSection } from '@/components/orders/resi-lifecycle-section'
import { ORDER_PRIORITIES } from '@/lib/types'
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
  // Phase 4C estimated cost fields
  estimated_shipping_net: number | null
  estimated_cod_fee: number | null
  estimated_ppn: number | null
  estimated_total_cost: number | null
  estimated_cash_in: number | null
  estimated_profit: number | null
  cost_computed_at: string | null
  // Phase 8A — multi-supplier
  origin_supplier_id: number | null
  is_multi_origin: boolean
  // Phase 8B — resi lifecycle
  resi_printed_at: string | null
  picked_up_at: string | null
  // Phase 8E — enrichment
  delivered_at: string | null
  returned_at: string | null
  tags: string[]
  priority: 'LOW' | 'NORMAL' | 'URGENT'
  internal_note: string | null
  customer_note: string | null
  reject_reason: string | null
  cs_attempts: number
  last_contact_at: string | null
  order_date: string
  created_at: string
  updated_at: string
  channel?: { id: number; code: string; name: string; billing_model?: string; shipping_discount_label?: string }
  source_profile?: { id: number; code: string; name: string }
  cs?: { id: string; full_name: string }
  advertiser?: { id: string; full_name: string }
  creator?: { id: string; full_name: string }
  // Phase 8A
  origin_supplier?: { id: number; code: string | null; name: string } | null
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
          channel:courier_channels(id, code, name, billing_model, shipping_discount_label),
          source_profile:converter_profiles(id, code, name),
          cs:profiles!orders_cs_id_fkey(id, full_name),
          advertiser:profiles!orders_advertiser_id_fkey(id, full_name),
          creator:profiles!orders_created_by_fkey(id, full_name),
          origin_supplier:suppliers(id, code, name)
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
      toast.error('Gagal update status', { description: getErrorMessage(err) })
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
        variant_id: it.variant_id,
        product_name_raw: it.product_name_raw,
        variation: it.variation,
        qty: it.qty,
        price: it.price,
        weight_per_unit: it.weight_per_unit,
        notes: it.notes,
      }))
      const { error: insErr } = await supabase.from('order_items').insert(itemPayload)
      if (insErr) throw insErr

      // Phase 9: recompute commissions after items changed
      try {
        const { error: commErr } = await supabase.rpc('compute_commissions', { p_order_id: order.id })
        if (commErr) console.warn('compute_commissions failed:', commErr.message)
      } catch (e) {
        console.warn('compute_commissions exception:', e)
      }

      toast.success('Order ter-update')
      setEditing(false)
      load()
    } catch (err: any) {
      toast.error('Gagal simpan', { description: getErrorMessage(err) })
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
              {/* Phase 8E — priority badge */}
              {order.priority && order.priority !== 'NORMAL' && (() => {
                const p = ORDER_PRIORITIES.find(x => x.value === order.priority)
                return p ? <Badge variant="outline" className={p.color}>{p.label}</Badge> : null
              })()}
              {/* Phase 8E — tags */}
              {order.tags && order.tags.length > 0 && order.tags.slice(0, 3).map(t => (
                <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
              ))}
              {/* Phase 8A — supplier asal / multi-origin badge */}
              {order.is_multi_origin ? (
                <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30">
                  Multi-Origin Order
                </Badge>
              ) : order.origin_supplier ? (
                <Badge variant="outline" className="bg-violet-500/10 text-violet-600 border-violet-500/30">
                  Origin: {order.origin_supplier.code || order.origin_supplier.name}
                </Badge>
              ) : null}
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
          {canApprove && (
            <TabsTrigger value="cost"><Coins className="w-3.5 h-3.5 mr-1" />Cost &amp; Profit</TabsTrigger>
          )}
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

            {/* Phase 8B — Resi Lifecycle */}
            <Card>
              <CardContent className="pt-4 pb-4">
                <ResiLifecycleSection
                  orderId={order.id}
                  status={order.status}
                  resiPrintedAt={order.resi_printed_at ?? null}
                  pickedUpAt={order.picked_up_at ?? null}
                  role={role}
                  onUpdated={load}
                />
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

            {/* Phase 8E — CS Tracking, Catatan, Tags, Reject Reason */}
            <Card className="md:col-span-2">
              <CardContent className="pt-4 pb-4 space-y-3 text-sm">
                <h3 className="font-semibold text-base flex items-center gap-2">
                  <span className="w-1.5 h-5 bg-teal-500 rounded" />CS Tracking & Catatan
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Field
                    label="Priority"
                    value={(() => {
                      const p = ORDER_PRIORITIES.find(x => x.value === order.priority)
                      return p ? <Badge variant="outline" className={p.color}>{p.label}</Badge> : '—'
                    })()}
                  />
                  <Field
                    label="CS Attempts"
                    value={<span className="tabular-nums">{order.cs_attempts ?? 0}</span>}
                  />
                  <Field
                    label="Kontak Terakhir"
                    value={order.last_contact_at ? fmtFull(order.last_contact_at) : '—'}
                  />
                  <Field
                    label="Tags"
                    value={
                      order.tags && order.tags.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {order.tags.map(t => (
                            <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
                          ))}
                        </div>
                      ) : '—'
                    }
                  />
                </div>
                <div className="space-y-2 pt-2 border-t">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Catatan Internal (tim)</p>
                    <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                      {order.internal_note || <span className="italic">—</span>}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Catatan Customer</p>
                    <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                      {order.customer_note || <span className="italic">—</span>}
                    </p>
                  </div>
                  {order.reject_reason && (
                    <div>
                      <p className="text-xs text-red-500 mb-1">Alasan Reject / Cancel</p>
                      <p className="text-sm whitespace-pre-wrap text-red-600">{order.reject_reason}</p>
                    </div>
                  )}
                </div>
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

        {canApprove && (
          <TabsContent value="cost">
            <CostProfitTab order={order} onRecomputed={load} />
          </TabsContent>
        )}
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

// =============================================================
// Phase 4C — Cost & Profit Tab Component
// Render breakdown estimasi biaya & profit untuk satu order.
// Fetch channel cost bundle untuk display rates yang dipakai.
// Recompute button trigger compute_order_costs RPC.
// =============================================================
function CostProfitTab({ order, onRecomputed }: { order: OrderDetail; onRecomputed: () => void }) {
  const [bundle, setBundle] = useState<ChannelCostBundle | null>(null)
  const [bundleLoading, setBundleLoading] = useState(false)
  const [recomputing, setRecomputing] = useState(false)
  // Brief #3 — HPP + Packing total per order (dari snapshot per item)
  const [itemCosts, setItemCosts] = useState<{ hpp: number; packing: number }>({ hpp: 0, packing: 0 })

  useEffect(() => {
    const loadBundle = async () => {
      if (!order.channel_id) return
      setBundleLoading(true)
      try {
        const b = await fetchChannelCostBundle(supabase, order.channel_id, order.order_date)
        setBundle(b)
      } finally {
        setBundleLoading(false)
      }
    }
    void loadBundle()
  }, [order.channel_id, order.order_date])

  useEffect(() => {
    supabase.from('order_items').select('qty, hpp_snapshot, packing_fee_snapshot').eq('order_id', order.id)
      .then(({ data }) => {
        const rows = (data || []) as Array<{ qty: number; hpp_snapshot: number | null; packing_fee_snapshot: number | null }>
        setItemCosts({
          hpp: rows.reduce((s, r) => s + Number(r.qty || 0) * Number(r.hpp_snapshot || 0), 0),
          packing: rows.reduce((s, r) => s + Number(r.qty || 0) * Number(r.packing_fee_snapshot || 0), 0),
        })
      })
  }, [order.id, order.cost_computed_at])

  const recompute = async () => {
    setRecomputing(true)
    try {
      await recomputeOrderCosts(supabase, order.id)
      toast.success('Cost recomputed')
      onRecomputed()
    } catch (err) {
      const msg = getErrorMessage(err)
      toast.error('Gagal recompute', { description: msg })
    } finally {
      setRecomputing(false)
    }
  }

  // Channel kosong
  if (!order.channel_id) {
    return (
      <Card>
        <CardContent className="pt-6 pb-6 text-center text-sm text-muted-foreground">
          <Coins className="w-8 h-8 mx-auto text-muted-foreground/50 mb-2" />
          Pilih channel ekspedisi untuk lihat estimasi biaya. Edit order untuk set channel.
        </CardContent>
      </Card>
    )
  }

  const billingModel = order.channel?.billing_model || 'NO_RECONCILIATION'
  const discountLabel = order.channel?.shipping_discount_label || 'Cashback Ongkir'
  const computed = order.cost_computed_at != null

  return (
    <Card>
      <CardContent className="pt-4 pb-4 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Coins className="w-4 h-4 text-violet-500" />
              Estimated Cost &amp; Profit
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Channel: <span className="font-mono">{order.channel?.code}</span> · Billing: <Badge variant="outline" className="text-[10px]">{BILLING_MODEL_SHORT[billingModel as keyof typeof BILLING_MODEL_SHORT] ?? billingModel}</Badge>
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={recompute} disabled={recomputing}>
            {recomputing ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
            Recompute
          </Button>
        </div>

        {billingModel === 'NO_RECONCILIATION' && (
          <div className="text-xs p-3 rounded bg-blue-500/10 border border-blue-500/20 text-blue-700 dark:text-blue-400">
            ℹ️ Channel ini billing model = NO_RECONCILIATION. Cash in = order total kalau COD; cost dihitung simbolis tanpa rekonsil.
          </div>
        )}

        {(order.status === 'BARU' || order.status === 'SIAP_KIRIM') && (
          <div className="text-xs p-3 rounded bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400">
            ⏳ Estimasi belum final — order masih pre-kirim. Cost akan refresh saat status update ke DITERIMA dan rekonsil masuk.
          </div>
        )}

        {!computed ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Belum di-compute. Klik <span className="font-mono">Recompute</span> untuk hitung sekarang.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Breakdown */}
            <div className="text-xs space-y-1 bg-muted/30 rounded p-3 border">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 font-semibold">Cost Breakdown</div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Order Total ({order.payment_method})</span>
                <span className="font-mono font-semibold">{formatRupiah(Number(order.total))}</span>
              </div>
              <div className="border-t my-1" />
              <div className="flex justify-between">
                <span className="text-muted-foreground">Shipping Gross</span>
                <span className="font-mono">{formatRupiah(Number(order.shipping_cost_actual ?? order.shipping_cost ?? 0))}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Shipping Net (after {discountLabel})</span>
                <span className="font-mono">{formatRupiah(Number(order.estimated_shipping_net ?? 0))}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">COD Fee</span>
                <span className="font-mono">{formatRupiah(Number(order.estimated_cod_fee ?? 0))}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">PPN</span>
                <span className="font-mono">{formatRupiah(Number(order.estimated_ppn ?? 0))}</span>
              </div>
              <div className="flex justify-between border-t pt-1 text-orange-600">
                <span className="font-semibold">Total Cost ke Ekspedisi</span>
                <span className="font-mono font-bold">{formatRupiah(Number(order.estimated_total_cost ?? 0))}</span>
              </div>
            </div>

            {/* Cash flow + profit */}
            <div className="text-xs space-y-1 bg-muted/30 rounded p-3 border">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 font-semibold">Cash Flow &amp; Profit</div>
              <div className="flex justify-between text-emerald-600">
                <span className="font-semibold">Estimated Cash In</span>
                <span className="font-mono font-bold">{formatRupiah(Number(order.estimated_cash_in ?? 0))}</span>
              </div>
              <p className="text-[10px] text-muted-foreground italic">
                {billingModel === 'MONTHLY_INVOICE' && 'COD cair full sebelum tagihan bulan depan'}
                {billingModel === 'NETT_OFF_PER_ORDER' && 'COD cair sudah dipotong cost (per order)'}
                {billingModel === 'DIRECT_TRANSFER' && 'Customer transfer langsung'}
                {billingModel === 'NO_RECONCILIATION' && 'Tidak ada rekonsil cost'}
              </p>
              <div className="border-t my-1" />
              <div className="flex justify-between">
                <span className="text-muted-foreground">HPP (modal barang)</span>
                <span className="font-mono">−{formatRupiah(itemCosts.hpp)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Packing</span>
                <span className="font-mono">−{formatRupiah(itemCosts.packing)}</span>
              </div>
              <div className={`flex justify-between border-t pt-1 ${Number(order.estimated_profit ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                <span className="font-bold">Estimated Profit</span>
                <span className="font-mono font-bold text-base">{formatRupiah(Number(order.estimated_profit ?? 0))}</span>
              </div>
              <p className="text-[10px] text-muted-foreground">
                = Cash In − HPP − Packing − Komisi
                {billingModel === 'MONTHLY_INVOICE' ? ' − Total Cost (untuk MONTHLY_INVOICE, cost akan ditagih bulan depan)' : ''}
              </p>
            </div>
          </div>
        )}

        {/* Footer meta */}
        {(computed || bundle) && (
          <div className="text-[10px] text-muted-foreground border-t pt-2 space-y-0.5">
            {order.cost_computed_at && (
              <div>ⓘ Computed at: {formatDateTime(order.cost_computed_at)}</div>
            )}
            {bundleLoading ? (
              <div>Loading rate config…</div>
            ) : bundle ? (
              <div>
                Rates: {discountLabel} {Number(bundle.shipping_discount_rate).toFixed(0)}% ·
                Fee COD {Number(bundle.cod_fee_rate).toFixed(2)}% ({bundle.cod_fee_rounding}, base={bundle.cod_fee_base}) ·
                PPN {Number(bundle.ppn_rate).toFixed(0)}% ({bundle.ppn_applied_to})
              </div>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
