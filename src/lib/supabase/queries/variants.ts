// =============================================================
// Phase 9 — Variant model query helpers
// =============================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  Product,
  ProductAttribute,
  ProductAttributeValue,
  ProductVariant,
  ProductWithVariants,
  CommissionRule,
} from '@/lib/types'

// ---------------- Attributes ----------------

export async function listAttributes(
  supabase: SupabaseClient,
  orgId: number
): Promise<ProductAttribute[]> {
  const { data, error } = await supabase
    .from('product_attributes')
    .select('*, values:product_attribute_values(*)')
    .eq('organization_id', orgId)
    .order('display_order', { ascending: true })
  if (error) throw new Error(`listAttributes: ${error.message}`)
  return (data || []) as ProductAttribute[]
}

export async function createAttribute(
  supabase: SupabaseClient,
  orgId: number,
  name: string,
  values: string[]
): Promise<ProductAttribute> {
  const { data: attr, error: e1 } = await supabase
    .from('product_attributes')
    .insert({ organization_id: orgId, name: name.trim() })
    .select('*')
    .single()
  if (e1) throw new Error(`createAttribute: ${e1.message}`)

  if (values.length > 0) {
    const rows = values.map((v, idx) => ({
      attribute_id: attr.id,
      value: v.trim(),
      display_order: idx,
    }))
    const { error: e2 } = await supabase.from('product_attribute_values').insert(rows)
    if (e2) throw new Error(`createAttribute values: ${e2.message}`)
  }
  return attr as ProductAttribute
}

export async function addAttributeValue(
  supabase: SupabaseClient,
  attributeId: number,
  value: string,
  displayOrder: number
): Promise<ProductAttributeValue> {
  const { data, error } = await supabase
    .from('product_attribute_values')
    .insert({ attribute_id: attributeId, value: value.trim(), display_order: displayOrder })
    .select('*')
    .single()
  if (error) throw new Error(`addAttributeValue: ${error.message}`)
  return data as ProductAttributeValue
}

// ---------------- Products + variants ----------------

export async function listProductsWithCounts(
  supabase: SupabaseClient,
  orgId: number
): Promise<Array<Product & { variant_count: number; price_min: number | null; price_max: number | null; active_variants: number }>> {
  const { data: products, error } = await supabase
    .from('products')
    .select('*, variants:product_variants(id, price, active)')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) throw new Error(`listProductsWithCounts: ${error.message}`)
  return (products || []).map((p: any) => {
    const variants = (p.variants || []) as Array<{ id: number; price: number; active: boolean }>
    const prices = variants.map(v => Number(v.price))
    return {
      ...p,
      variant_count: variants.length,
      active_variants: variants.filter(v => v.active).length,
      price_min: prices.length > 0 ? Math.min(...prices) : Number(p.price_default ?? 0),
      price_max: prices.length > 0 ? Math.max(...prices) : Number(p.price_default ?? 0),
    }
  })
}

export async function getProductWithVariants(
  supabase: SupabaseClient,
  productId: number
): Promise<ProductWithVariants | null> {
  const { data: product, error } = await supabase
    .from('products')
    .select('*')
    .eq('id', productId)
    .maybeSingle()
  if (error) throw new Error(`getProductWithVariants: ${error.message}`)
  if (!product) return null

  const [{ data: variants }, { data: assignments }] = await Promise.all([
    supabase
      .from('product_variants')
      .select('*, attribute_values:variant_attribute_values(attribute_value_id, product_attribute_values(id, value, attribute_id, product_attributes(id, name)))')
      .eq('product_id', productId)
      .order('id', { ascending: true }),
    supabase
      .from('product_attributes_assignment')
      .select('attribute_id, display_order, product_attributes(*, values:product_attribute_values(*))')
      .eq('product_id', productId)
      .order('display_order', { ascending: true }),
  ])

  // Flatten variant.attribute_values into VariantAttributeValueRow[]
  const variantRows = (variants || []).map((v: any) => ({
    ...v,
    attribute_values: (v.attribute_values || []).map((av: any) => ({
      attribute_id: av.product_attribute_values?.attribute_id,
      attribute_name: av.product_attribute_values?.product_attributes?.name,
      value_id: av.attribute_value_id,
      value: av.product_attribute_values?.value,
    })),
  }))

  const attributes = (assignments || []).map((a: any) => a.product_attributes)

  return {
    ...(product as Product),
    variants: variantRows,
    attributes,
  } as ProductWithVariants
}

/**
 * Save full product with variants atomically (best-effort sequential).
 * - Insert/update parent products row
 * - Sync product_attributes_assignment
 * - Replace product_variants + variant_attribute_values
 */
export interface SaveProductPayload {
  id?: number | null
  orgId: number
  name: string
  notes?: string | null
  active: boolean
  hasVariants: boolean
  // Phase 8A — supplier link (nullable)
  supplierId?: number | null
  // Brief #3 — fee packing per produk (masuk HPP)
  packingFee?: number
  // Simple product fields
  simplePrice?: number
  simpleHpp?: number
  // For variant products
  attributeIds: number[]  // ordered, max 3
  variants: Array<{
    id?: number | null  // existing variant id (preserve) or null = create
    variant_name: string
    variation_code?: string | null
    price: number
    hpp: number
    weight_grams?: number | null
    active: boolean
    attribute_value_ids: number[]  // must match attributeIds count
  }>
}

export async function saveProduct(
  supabase: SupabaseClient,
  payload: SaveProductPayload
): Promise<{ id: number }> {
  // 1. Upsert parent product
  const parentData: Record<string, unknown> = {
    organization_id: payload.orgId,
    name: payload.name.trim(),
    notes: payload.notes ?? null,
    active: payload.active,
    has_variants: payload.hasVariants,
    price_default: payload.hasVariants
      ? (payload.variants[0]?.price ?? 0)
      : (payload.simplePrice ?? 0),
    hpp: payload.hasVariants
      ? (payload.variants[0]?.hpp ?? 0)
      : (payload.simpleHpp ?? 0),
    // Phase 8A — supplier_id (nullable). Only set kalau explicitly passed
    // (undefined = jangan touch, null = clear)
    ...(payload.supplierId !== undefined ? { supplier_id: payload.supplierId } : {}),
    // Brief #3 — packing_fee (per produk, masuk HPP per order)
    ...(payload.packingFee !== undefined ? { packing_fee: payload.packingFee } : {}),
  }

  let productId: number
  if (payload.id) {
    const { error } = await supabase
      .from('products')
      .update(parentData)
      .eq('id', payload.id)
    if (error) throw new Error(`saveProduct (update): ${error.message}`)
    productId = payload.id
  } else {
    const { data, error } = await supabase
      .from('products')
      .insert(parentData)
      .select('id')
      .single()
    if (error || !data) throw new Error(`saveProduct (insert): ${error?.message || 'no row'}`)
    productId = data.id
  }

  // 2. Sync attribute assignments (replace)
  await supabase.from('product_attributes_assignment').delete().eq('product_id', productId)
  if (payload.hasVariants && payload.attributeIds.length > 0) {
    const assignRows = payload.attributeIds.map((aid, idx) => ({
      product_id: productId,
      attribute_id: aid,
      display_order: idx,
    }))
    const { error } = await supabase.from('product_attributes_assignment').insert(assignRows)
    if (error) throw new Error(`saveProduct (attr assign): ${error.message}`)
  }

  // 3. Sync variants (delete-all + re-insert is simplest given Phase 9 fresh-start)
  await supabase.from('product_variants').delete().eq('product_id', productId)

  if (payload.hasVariants) {
    for (const v of payload.variants) {
      const { data: insertedVar, error: vErr } = await supabase
        .from('product_variants')
        .insert({
          product_id: productId,
          organization_id: payload.orgId,
          variant_name: v.variant_name.trim(),
          variation_code: v.variation_code?.trim() || null,
          price: v.price,
          hpp: v.hpp,
          weight_grams: v.weight_grams ?? null,
          active: v.active,
        })
        .select('id')
        .single()
      if (vErr || !insertedVar) throw new Error(`saveProduct (variant insert): ${vErr?.message || 'no row'}`)

      // Link variant ↔ attribute values
      if (v.attribute_value_ids.length > 0) {
        const linkRows = v.attribute_value_ids.map(avid => ({
          variant_id: insertedVar.id,
          attribute_value_id: avid,
        }))
        const { error: linkErr } = await supabase.from('variant_attribute_values').insert(linkRows)
        if (linkErr) throw new Error(`saveProduct (variant attr link): ${linkErr.message}`)
      }
    }
  } else {
    // Simple product: create 1 default variant (variant_name='default', no attribute links)
    const { error } = await supabase.from('product_variants').insert({
      product_id: productId,
      organization_id: payload.orgId,
      variant_name: 'default',
      variation_code: null,
      price: payload.simplePrice ?? 0,
      hpp: payload.simpleHpp ?? 0,
      weight_grams: null,
      active: payload.active,
    })
    if (error) throw new Error(`saveProduct (default variant): ${error.message}`)
  }

  return { id: productId }
}

export async function deleteProduct(supabase: SupabaseClient, productId: number): Promise<void> {
  const { error } = await supabase.from('products').delete().eq('id', productId)
  if (error) throw new Error(`deleteProduct: ${error.message}`)
}

// ---------------- Variant lookup (for order form) ----------------

export async function listVariantsForProduct(
  supabase: SupabaseClient,
  productId: number,
  options?: { includeInactive?: boolean }
): Promise<ProductVariant[]> {
  let q = supabase.from('product_variants').select('*').eq('product_id', productId).order('id', { ascending: true })
  if (!options?.includeInactive) q = q.eq('active', true)
  const { data, error } = await q
  if (error) throw new Error(`listVariantsForProduct: ${error.message}`)
  return (data || []) as ProductVariant[]
}

// ---------------- Commission rules (Phase 9 v3) ----------------

export async function listCommissionRules(
  supabase: SupabaseClient,
  orgId: number
): Promise<Array<CommissionRule & { product_name: string | null; user_name: string | null }>> {
  const { data, error } = await supabase
    .from('commission_rules')
    .select('*, products(name), profiles!commission_rules_user_id_fkey(full_name)')
    .eq('organization_id', orgId)
    .order('role', { ascending: true })
    .order('user_id', { ascending: true, nullsFirst: true })
    .order('product_id', { ascending: true, nullsFirst: true })
  if (error) throw new Error(`listCommissionRules: ${error.message}`)
  return (data || []).map((r: any) => ({
    ...r,
    product_name: r.products?.name ?? null,
    user_name: r.profiles?.full_name ?? null,
  }))
}

export interface SaveCommissionRulePayload {
  id?: number | null
  orgId: number
  role: 'cs' | 'advertiser'
  user_id: string | null
  product_id: number | null
  rate_type: 'FLAT_PER_ORDER' | 'PERCENT_REVENUE' | 'NONE'
  rate_value: number | null
  effective_from: string | null
  effective_to: string | null
  active: boolean
}

export async function saveCommissionRule(
  supabase: SupabaseClient,
  p: SaveCommissionRulePayload
): Promise<CommissionRule> {
  const payload = {
    organization_id: p.orgId,
    role: p.role,
    user_id: p.user_id,
    product_id: p.product_id,
    rate_type: p.rate_type,
    rate_value: p.rate_type === 'NONE' ? null : p.rate_value,
    effective_from: p.effective_from,
    effective_to: p.effective_to,
    active: p.active,
  }
  if (p.id) {
    const { data, error } = await supabase
      .from('commission_rules')
      .update(payload)
      .eq('id', p.id)
      .select('*')
      .single()
    if (error) throw new Error(`saveCommissionRule (update): ${error.message}`)
    return data as CommissionRule
  }
  const { data, error } = await supabase
    .from('commission_rules')
    .insert(payload)
    .select('*')
    .single()
  if (error) throw new Error(`saveCommissionRule (insert): ${error.message}`)
  return data as CommissionRule
}

export async function deleteCommissionRule(
  supabase: SupabaseClient,
  ruleId: number
): Promise<void> {
  const { error } = await supabase.from('commission_rules').delete().eq('id', ruleId)
  if (error) throw new Error(`deleteCommissionRule: ${error.message}`)
}

// ---------------- Compute commissions RPC wrapper ----------------

export async function computeCommissions(
  supabase: SupabaseClient,
  orderId: number
): Promise<{ order_id: number; inserted: number; skipped: number; initial_status: string }> {
  const { data, error } = await supabase.rpc('compute_commissions', { p_order_id: orderId })
  if (error) throw new Error(`computeCommissions: ${error.message}`)
  return data as { order_id: number; inserted: number; skipped: number; initial_status: string }
}
