'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent } from '@/components/ui/card'
import { toast } from 'sonner'
import { ShoppingCart } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { OrderForm } from '@/components/orders/order-form'
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
      const initialStatus = canApprove ? 'SIAP_KIRIM' : 'BARU'

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
      }
      const { data: orderRow, error } = await supabase
        .from('orders')
        .insert(orderPayload)
        .select('id')
        .single()
      if (error || !orderRow) throw error || new Error('Insert order gagal')

      const itemPayload = data.items.map((it) => ({
        organization_id: orgId,
        order_id: orderRow.id,
        product_id: it.product_id,
        product_name_raw: it.product_name_raw,
        variation: it.variation,
        qty: it.qty,
        price: it.price,
        weight_per_unit: it.weight_per_unit,
        notes: it.notes,
      }))
      const { error: itemErr } = await supabase.from('order_items').insert(itemPayload)
      if (itemErr) {
        toast.warning('Order tersimpan tapi item gagal', { description: itemErr.message })
      }

      toast.success(`Order ${orderNumber} ter-create`)
      router.push(`/orders/${orderRow.id}`)
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
      <PageHeader
        icon={ShoppingCart}
        title="Input Order Baru"
        description={
          canApprove
            ? 'Order langsung masuk dengan status SIAP_KIRIM (admin/owner mode).'
            : 'Order masuk dengan status BARU dan menunggu approval admin.'
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
