'use client'
import { useParams } from 'next/navigation'
import { ProductVariantForm } from '@/components/products/product-variant-form'

export default function EditProductPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id ? Number(params.id) : null
  return <ProductVariantForm productId={id} />
}
