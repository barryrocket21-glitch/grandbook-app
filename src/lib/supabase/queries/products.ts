// =============================================================
// Products + Product Categories query helpers (Phase 5A)
// Thin wrappers around Supabase calls. Pages call these instead of
// inline queries for consistency.
// =============================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Product, ProductCategory } from '@/lib/types'
import { slugifyCategory } from '@/lib/schemas/settings'

export async function listProducts(
  supabase: SupabaseClient
): Promise<(Product & { category_ref?: ProductCategory | null })[]> {
  const { data, error } = await supabase
    .from('products')
    .select('*, category_ref:product_categories!products_category_id_fkey(id, name, slug, active)')
    .order('name')
  if (error) throw new Error(`listProducts: ${error.message}`)
  return (data || []) as (Product & { category_ref?: ProductCategory | null })[]
}

export async function listCategories(
  supabase: SupabaseClient
): Promise<ProductCategory[]> {
  const { data, error } = await supabase
    .from('product_categories')
    .select('*')
    .order('display_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw new Error(`listCategories: ${error.message}`)
  return (data || []) as ProductCategory[]
}

interface ProductPayload {
  sku: string | null
  name: string
  category_id: number | null
  variation: string | null
  price_default: number
  hpp: number
  notes: string | null
  active: boolean
}

export async function insertProduct(
  supabase: SupabaseClient,
  orgId: number,
  payload: ProductPayload
): Promise<Product> {
  const { data, error } = await supabase
    .from('products')
    .insert({ ...payload, organization_id: orgId })
    .select('*')
    .single()
  if (error) throw new Error(`insertProduct: ${error.message}`)
  return data as Product
}

export async function updateProduct(
  supabase: SupabaseClient,
  id: number,
  payload: Partial<ProductPayload> & { active?: boolean }
): Promise<Product> {
  const { data, error } = await supabase
    .from('products')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw new Error(`updateProduct: ${error.message}`)
  return data as Product
}

export async function deleteProduct(supabase: SupabaseClient, id: number): Promise<void> {
  const { error } = await supabase.from('products').delete().eq('id', id)
  if (error) throw new Error(`deleteProduct: ${error.message}`)
}

interface CategoryPayload {
  name: string
  slug?: string
  description: string | null
  display_order: number
  active: boolean
}

export async function insertCategory(
  supabase: SupabaseClient,
  orgId: number,
  payload: CategoryPayload
): Promise<ProductCategory> {
  const slug = (payload.slug && payload.slug.trim()) || slugifyCategory(payload.name)
  const { data, error } = await supabase
    .from('product_categories')
    .insert({ ...payload, slug, organization_id: orgId })
    .select('*')
    .single()
  if (error) throw new Error(`insertCategory: ${error.message}`)
  return data as ProductCategory
}

export async function updateCategory(
  supabase: SupabaseClient,
  id: number,
  payload: Partial<CategoryPayload>
): Promise<ProductCategory> {
  const next = { ...payload }
  if (next.name && !next.slug) next.slug = slugifyCategory(next.name)
  const { data, error } = await supabase
    .from('product_categories')
    .update(next)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw new Error(`updateCategory: ${error.message}`)
  return data as ProductCategory
}

export async function deleteCategory(supabase: SupabaseClient, id: number): Promise<void> {
  const { error } = await supabase.from('product_categories').delete().eq('id', id)
  if (error) throw new Error(`deleteCategory: ${error.message}`)
}

/**
 * Count produk yang masih reference kategori. Dipakai sebelum delete
 * untuk warn user.
 */
export async function countProductsInCategory(
  supabase: SupabaseClient,
  categoryId: number
): Promise<number> {
  const { count, error } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true })
    .eq('category_id', categoryId)
  if (error) throw new Error(`countProductsInCategory: ${error.message}`)
  return count || 0
}

/**
 * Count order_items yang reference product (untuk warning delete product).
 */
export async function countOrderItemsForProduct(
  supabase: SupabaseClient,
  productId: number
): Promise<number> {
  const { count, error } = await supabase
    .from('order_items')
    .select('*', { count: 'exact', head: true })
    .eq('product_id', productId)
  if (error) throw new Error(`countOrderItemsForProduct: ${error.message}`)
  return count || 0
}
