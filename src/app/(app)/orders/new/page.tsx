'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent } from '@/components/ui/card'
import { toast } from 'sonner'
import { ShoppingCart } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { PageTabs } from '@/components/ui/page-tabs'
import { OrderForm } from '@/components/orders/order-form'

const INPUT_TABS = [
  { label: 'Ketik Manual', href: '/orders/new' },
  { label: 'Upload CSV', href: '/orders/bulk-upload' },
  { label: 'Tempel WA', href: '/orders/wa-paste' },
]
import { canCreateOrders, canApproveOrders } from '@/lib/auth/permissions'
import { generateOrderNumber } from '@/lib/orders/order-number'
import type { OrderInputFormData } from '@/lib/schemas/settings'

const supabase = createClient()

export default function NewOrderPage() {
  const router = useRouter()
  const { user, profile, role } = useAuth()
  const canCreate = canCreateOrders(role)
  const canApprove = canApproveOrders(role)
  const [submitting, setSubmitting] = useState(false)

  const submit = async (data: OrderInputFormData) => {
    if (!user) {
      toast.error('Belum login')
      return
    }
    setSubmitting(true)
    try {
      const orgId = profile?.organization_id || 1
      const orderNumber = await generateOrderNumber(supabase, orgId)
      // Phase 8H — Order baru selalu masuk orders_draft (workspace pre-resi).
      // Status di draft cuma BARU/SIAP_KIRIM/PROBLEM/CANCEL. Admin/owner langsung
      // SIAP_KIRIM (siap di-print resi); CS mulai dari BARU (menunggu validasi).
      const initialStatus = canApprove ? 'SIAP_KIRIM' : 'BARU'

      // Phase 8A — auto-detect origin supplier dari produk yang dipilih.
      // Kalau semua item dari supplier sama → set origin_supplier_id, is_multi_origin=FALSE
      // Kalau ada >1 supplier distinct → is_multi_origin=TRUE, origin_supplier_id=NULL
      // Kalau item tanpa product_id atau produknya nggak punya supplier_id → skip
      const productIds = Array.from(new Set(
        data.items.map(it => it.product_id).filter((id): id is number => typeof id === 'number')
      ))
      let originSupplierId: number | null = null
      let isMultiOrigin = false
      if (productIds.length > 0) {
        const { data: productRows } = await supabase
          .from('products')
          .select('id, supplier_id')
          .in('id', productIds)
        const supplierIds = Array.from(new Set(
          (productRows || [])
            .map((p: { supplier_id: number | null }) => p.supplier_id)
            .filter((s: number | null): s is number => s !== null)
        ))
        if (supplierIds.length === 1) {
          originSupplierId = supplierIds[0]
        } else if (supplierIds.length > 1) {
          isMultiOrigin = true
        }
      }

      const orderPayload = {
        organization_id: orgId,
        order_number: orderNumber,
        status: initialStatus,
        payment_method: data.payment_method,
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
        cs_name: data.cs_name || profile?.full_name || null,
        cs_id: data.cs_id || (role === 'cs' ? user.id : null),
        advertiser_id: data.advertiser_id,
        notes: data.notes,
        created_by: user.id,
        // Phase 8A
        origin_supplier_id: originSupplierId,
        is_multi_origin: isMultiOrigin,
      }
      const { data: orderRow, error } = await supabase
        .from('orders_draft')
        .insert(orderPayload)
        .select('id')
        .single()
      if (error || !orderRow) throw error || new Error('Insert order gagal')

      const itemPayload = data.items.map((it) => ({
        organization_id: orgId,
        order_id: orderRow.id,
        product_id: it.product_id,
        variant_id: it.variant_id,
        product_name_raw: it.product_name_raw,
        variation: it.variation,
        qty: it.qty,
        price: it.price,
        weight_per_unit: it.weight_per_unit,
        notes: it.notes,
      }))
      const { error: itemErr } = await supabase.from('order_items_draft').insert(itemPayload)
      if (itemErr) {
        toast.warning('Order tersimpan tapi item gagal', { description: itemErr.message })
      }

      // Phase 8H — commissions di-skip untuk draft. Compute dilakukan saat
      // order graduasi ke `orders` (via trigger promote_draft_to_orders + DB
      // trigger update_commission_on_order_status). Tidak ada compute_commissions
      // di-call dari draft path.

      toast.success(`Order ${orderNumber} masuk Antrian Kerja`)
      router.push('/orders/draft')
    } catch (err: any) {
      toast.error('Gagal simpan', { description: err.message })
    } finally {
      setSubmitting(false)
    }
  }

  if (!canCreate) {
    return (
      <div className="space-y-6">
        <PageHeader icon={ShoppingCart} title="Input Order Baru" />
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          Role kamu tidak diizinkan input order.
        </CardContent></Card>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageTabs items={INPUT_TABS} />
      <PageHeader
        icon={ShoppingCart}
        title="Input Order Baru"
        description={
          canApprove
            ? 'Order masuk ke Antrian Kerja dengan status SIAP_KIRIM (admin/owner mode). Resi diisi setelah cetak.'
            : 'Order masuk ke Antrian Kerja dengan status BARU dan menunggu approval admin.'
        }
      />
      <OrderForm
        defaults={{ cs_name: profile?.full_name || '', payment_method: 'COD' }}
        onSubmit={submit}
        submitting={submitting}
        submitLabel="Simpan Order"
      />
    </div>
  )
}
