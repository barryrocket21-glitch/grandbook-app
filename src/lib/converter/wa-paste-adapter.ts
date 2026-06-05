// =============================================================
// WA Paste Adapter — ParsedWaOrder → GrandBook orders_draft insert
// =============================================================
// Bridge dari konorder-style parser ke GrandBook schema:
// - Product matching: substring (case-insensitive, longest-first)
// - CS resolution: lookup profiles.full_name (case-insensitive)
// - Phone normalize: pakai existing normalize_phone_id_safe
// - Build insert payload untuk orders_draft + order_items_draft
// =============================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import { getErrorMessage } from '@/lib/errors'
import { normalize_phone_id_safe } from './transforms'
import type { ParsedWaOrder } from './wa-paste-v3'

export interface AdapterContext {
  supabase: SupabaseClient
  organizationId: number
  channelId: number  // user pick di UI per session
  createdBy: string | null
  initialStatus: 'BARU' | 'SIAP_KIRIM'  // default BARU
}

export interface AdaptedOrder {
  // Diagnostic for preview
  originalIndex: number
  parsed: ParsedWaOrder
  productId: number | null
  productMatchedName: string | null  // master product name yg di-match
  csId: string | null
  csMatched: boolean
  phoneValid: boolean
  phoneReason: string | null  // kalau invalid
  warnings: string[]
  // Insert payload (siap dimasukin ke DB)
  payload: OrderDraftPayload
}

export interface OrderDraftPayload {
  organization_id: number
  channel_id: number
  status: 'BARU' | 'SIAP_KIRIM'
  customer_name: string
  customer_phone: string | null
  customer_address_detail: string | null
  customer_village: string | null  // kelurahan
  customer_subdistrict: string | null  // kecamatan
  customer_city: string | null
  customer_province: string | null
  customer_zip: string | null
  payment_method: 'COD' | 'TRANSFER'
  cod_amount: number | null
  total: number | null
  shipping_cost: number | null
  cs_id: string | null
  cs_name: string | null
  created_by: string | null
  customer_note: string | null
  meta: Record<string, unknown> | null
  // Single-item for now (1 order = 1 product di WA paste). Future: multi-item.
  _item: {
    organization_id: number
    product_id: number | null
    product_name_raw: string  // selalu simpan raw untuk reference
    variation: string | null  // "Ukuran 6 X 3", "38-39 Cream"
    qty: number
    price: number  // = hargaTotal kalau ada (per-unit nanti compute)
    weight_per_unit: number
  }
}

interface ProductRow {
  id: number
  name: string
}

interface ProfileRow {
  id: string
  full_name: string | null
}

// ----- Product matcher (substring match, longest-first) -----
function matchProductIdSubstring(rawName: string, products: ProductRow[]): { id: number | null; matchedName: string | null } {
  if (!rawName) return { id: null, matchedName: null }
  const haystack = rawName.toLowerCase()
  // Longest-first untuk prefer specific match ("Sandal Luna Premium" > "Sandal Luna")
  const sorted = [...products].sort((a, b) => b.name.length - a.name.length)
  for (const p of sorted) {
    if (p.name && haystack.includes(p.name.toLowerCase())) {
      return { id: p.id, matchedName: p.name }
    }
  }
  return { id: null, matchedName: null }
}

// ----- CS matcher (case-insensitive full_name) -----
function matchCsId(rawName: string | null, csProfiles: ProfileRow[]): string | null {
  if (!rawName) return null
  const needle = rawName.toLowerCase().trim()
  for (const p of csProfiles) {
    if (p.full_name && p.full_name.toLowerCase().trim() === needle) return p.id
  }
  return null
}

/** Preload reference data sekali per session (products + cs profiles). */
export async function preloadAdapterData(supabase: SupabaseClient, orgId: number): Promise<{
  products: ProductRow[]
  csProfiles: ProfileRow[]
}> {
  const [{ data: prods }, { data: profs }] = await Promise.all([
    supabase.from('products').select('id, name').eq('organization_id', orgId).eq('active', true),
    supabase.from('profiles').select('id, full_name').in('role', ['cs', 'admin', 'owner']).eq('organization_id', orgId),
  ])
  return {
    products: (prods || []) as ProductRow[],
    csProfiles: (profs || []) as ProfileRow[],
  }
}

/** Adapt 1 parsed order ke insert payload + diagnostics. */
export function adaptOrder(
  parsed: ParsedWaOrder,
  index: number,
  ctx: AdapterContext,
  refData: { products: ProductRow[]; csProfiles: ProfileRow[] }
): AdaptedOrder {
  const warnings: string[] = []

  // Phone validation
  const phoneCheck = normalize_phone_id_safe(parsed.hp)
  const phoneValid = phoneCheck.isValid
  if (!phoneValid) warnings.push(`HP invalid: ${phoneCheck.reason ?? 'unknown'}`)

  // Product match
  const { id: productId, matchedName } = matchProductIdSubstring(parsed.produk, refData.products)
  if (!productId && parsed.produk) {
    warnings.push(`Produk "${parsed.produk.slice(0, 40)}" tidak match ke master`)
  }

  // CS match
  const csId = matchCsId(parsed.csName, refData.csProfiles)
  if (parsed.csName && !csId) {
    warnings.push(`CS "${parsed.csName}" tidak ada di profiles`)
  }

  // Customer name + address basic validation
  if (!parsed.nama) warnings.push('Nama customer kosong')
  if (!parsed.alamat) warnings.push('Alamat lengkap kosong')

  // Brief #8 — field masing-masing:
  //  "Total:" (hargaTotal) = yang ditagih ke customer (incl ongkir) → cod_amount.
  //  "Harga:" (hargaProduk) = harga produk (excl ongkir) → total/revenue + item price.
  //  Fallback: kalau Harga gak ada, derive dari Total - ongkir.
  const codAmount = parsed.hargaTotal
    ?? (parsed.hargaProduk != null ? parsed.hargaProduk + (parsed.ongkir ?? 0) : null)
  const total = parsed.hargaProduk
    ?? (parsed.hargaTotal != null ? Math.max(0, parsed.hargaTotal - (parsed.ongkir ?? 0)) : null)

  const meta: Record<string, unknown> = {}
  if (parsed.advKode) meta.adv_code = parsed.advKode
  if (parsed.produkKode) meta.product_code_raw = parsed.produkKode
  // Brief #14 — atribusi dari kode "Produk Platform.Akun.Campaign". Platform
  // auto-resolve; akun+campaign DIPARKIR mentah (resolve nanti pas menu ADV).
  if (parsed.platform) meta.platform = parsed.platform
  if (parsed.atribusiCodeRaw) meta.product_code_full = parsed.atribusiCodeRaw
  if (parsed.atribusiAccount) meta.atribusi_account = parsed.atribusiAccount
  if (parsed.atribusiCampaign) meta.atribusi_campaign = parsed.atribusiCampaign
  if (parsed.atribusiPending) {
    meta.atribusi_pending = true
    warnings.push(`Atribusi parkir: platform=${parsed.platform ?? '?'}, akun=${parsed.atribusiAccount}, campaign=${parsed.atribusiCampaign} (resolve di menu ADV)`)
  } else if (!parsed.atribusiAccount) {
    // Kode atribusi GAK ADA / GAK LENGKAP (cuma huruf platform mis "F", atau kosong).
    // Warning NON-BLOCKING: admin tetep bisa proses order ke ekspedisi; ADV isi
    // campaign-nya nanti manual di Distribusi Atribusi (order tampil sbg "no-code").
    meta.atribusi_missing = true
    warnings.push(`⚠️ Produk "${parsed.produk ?? '?'}" gak ada kode atribusi lengkap (format: Produk Platform.Akun.Marker, mis. "Sandal Pavio S.A.1"). Order tetep bisa diproses — ADV isi campaign-nya nanti di Distribusi Atribusi.`)
  }

  const payload: OrderDraftPayload = {
    organization_id: ctx.organizationId,
    channel_id: ctx.channelId,
    status: ctx.initialStatus,
    customer_name: parsed.nama,
    customer_phone: phoneValid ? phoneCheck.phone : null,
    customer_address_detail: parsed.alamat || null,
    customer_village: parsed.kelurahan,
    customer_subdistrict: parsed.kecamatan,
    customer_city: parsed.kota,
    customer_province: parsed.provinsi,
    customer_zip: parsed.kodePos,
    payment_method: parsed.metodeBayar,
    cod_amount: parsed.metodeBayar === 'COD' ? codAmount : null,
    total,
    shipping_cost: parsed.ongkir,
    cs_id: csId,
    cs_name: parsed.csName,
    created_by: ctx.createdBy,
    customer_note: parsed.catatan,
    meta: Object.keys(meta).length > 0 ? meta : null,
    _item: {
      organization_id: ctx.organizationId,
      product_id: productId,
      product_name_raw: parsed.produk,
      variation: parsed.variation,
      qty: parsed.qty,
      price: total ?? 0,
      weight_per_unit: parsed.beratGram / 1000,  // ke kg
    },
  }

  return {
    originalIndex: index,
    parsed,
    productId,
    productMatchedName: matchedName,
    csId,
    csMatched: !!csId,
    phoneValid,
    phoneReason: phoneValid ? null : (phoneCheck.reason ?? null),
    warnings,
    payload,
  }
}

/** Batch adapt — convenience wrapper. */
export async function adaptOrders(
  parsedList: ParsedWaOrder[],
  ctx: AdapterContext
): Promise<AdaptedOrder[]> {
  const refData = await preloadAdapterData(ctx.supabase, ctx.organizationId)
  return parsedList.map((p, i) => adaptOrder(p, i, ctx, refData))
}

// ----- Insert (transactional) -----
export interface InsertResult {
  inserted: number
  failed: number
  insertedOrderIds: number[]
  errors: Array<{ index: number; message: string }>
}

/** Insert adapted orders ke orders_draft + order_items_draft. Per-row try/catch. */
export async function insertAdaptedOrders(
  supabase: SupabaseClient,
  orgId: number,
  adapted: AdaptedOrder[]
): Promise<InsertResult> {
  const result: InsertResult = { inserted: 0, failed: 0, insertedOrderIds: [], errors: [] }

  for (const a of adapted) {
    try {
      // 1. Generate order_number via RPC (race-safe)
      const { data: orderNum, error: errNum } = await supabase.rpc('generate_order_number', { org_id: orgId })
      if (errNum) throw new Error(`generate_order_number: ${errNum.message}`)

      // 2. Insert orders_draft
      const { _item, ...orderRow } = a.payload
      const { data: orderRes, error: errOrder } = await supabase
        .from('orders_draft')
        .insert({ ...orderRow, order_number: orderNum, order_date: new Date().toISOString().slice(0, 10) })
        .select('id')
        .single()
      if (errOrder) throw new Error(`orders_draft insert: ${errOrder.message}`)
      if (!orderRes) throw new Error('orders_draft insert: no row returned')

      // 3. Insert order_items_draft
      const { error: errItem } = await supabase
        .from('order_items_draft')
        .insert({ ..._item, order_id: orderRes.id })
      if (errItem) throw new Error(`order_items_draft insert: ${errItem.message}`)

      result.inserted++
      result.insertedOrderIds.push(orderRes.id)
    } catch (err) {
      result.failed++
      result.errors.push({
        index: a.originalIndex,
        message: getErrorMessage(err),
      })
    }
  }

  return result
}
