import type { SupabaseClient } from '@supabase/supabase-js'
import { normalize_phone_id_safe } from '@/lib/converter/transforms'
import type { SyncRow } from '@/lib/recon/spx-status-sync'

interface ProductRow {
  id: number
  name: string
  search_aliases?: string[] | null
}

interface RefData {
  products: ProductRow[]
}

export interface SpxShipmentDetailRow extends SyncRow {
  recipient_name?: string | null
  recipient_phone?: string | null
  recipient_province?: string | null
  recipient_city?: string | null
  recipient_district?: string | null
  recipient_detail_address?: string | null
  recipient_postal_code?: string | null
  sender_name?: string | null
  item_in_parcel?: string | null
  item_list?: string | null
  item_count?: number | null
  parcel_value?: number | null
  basic_shipping_fee?: number | null
  cod_service_fee?: number | null
}

function matchProductIdSubstring(rawName: string, products: ProductRow[]): { id: number | null; matchedName: string | null } {
  if (!rawName) return { id: null, matchedName: null }
  const haystack = rawName.toLowerCase()
  const terms: { term: string; id: number; name: string }[] = []
  for (const p of products) {
    if (p.name) terms.push({ term: p.name.toLowerCase(), id: p.id, name: p.name })
    for (const a of p.search_aliases ?? []) {
      if (a) terms.push({ term: a.toLowerCase(), id: p.id, name: p.name })
    }
  }
  terms.sort((a, b) => b.term.length - a.term.length)
  for (const t of terms) {
    if (t.term && haystack.includes(t.term)) return { id: t.id, matchedName: t.name }
  }
  return { id: null, matchedName: null }
}

function cleanText(v: string | null | undefined): string | null {
  const s = String(v || '').trim()
  return s === '' || s === '-' ? null : s
}

function parseItemDetail(raw: string | null | undefined): { productName: string; variation: string | null; qty: number } {
  const text = cleanText(raw) || ''
  if (!text) return { productName: '', variation: null, qty: 1 }
  const first = text.split('\n').map((x) => x.trim()).filter(Boolean)[0] || text
  const parts = first.split(',').map((x) => x.trim()).filter(Boolean)
  let productName = parts[0] || text
  let variation: string | null = null
  let qty = 1
  for (const p of parts.slice(1)) {
    const mQty = p.match(/^(\d+)$/)
    if (mQty) { qty = Number(mQty[1]) || 1; continue }
    if (/^warna\s*:/i.test(p) || /^ukuran\s*:/i.test(p)) {
      variation = variation ? `${variation}, ${p}` : p
      continue
    }
    if (/kg$/i.test(p) || /^0+(?:\.0+)?$/i.test(p)) continue
    if (!variation && /\d/.test(p)) { variation = p; continue }
  }
  return { productName, variation, qty }
}

function extractAttribution(ref: string | null | undefined, senderName: string | null | undefined, itemName: string): {
  raw: string | null
  platform: string | null
  account: string | null
  campaign: string | null
} {
  const refText = cleanText(ref)
  const item = cleanText(itemName)
  const sender = cleanText(senderName)
  const candidate = refText && /[A-Z]\.[A-Z]\.\d+$/i.test(refText)
    ? refText
    : sender && /\s[A-Z]\.[A-Z]\.\d+$/i.test(sender)
      ? sender.split(/\s+/).slice(-3).join(' ')
      : null
  if (!candidate || !item) return { raw: null, platform: null, account: null, campaign: null }
  const m = candidate.match(/^(.+?)\s+([A-Z]+)\.([A-Z])\.(\d+)$/i)
  if (!m) return { raw: null, platform: null, account: null, campaign: null }
  const [, , platform, account, campaign] = m
  return { raw: `${item} ${platform}.${account}.${campaign}`, platform: platform.toUpperCase(), account: account.toUpperCase(), campaign }
}

export async function buildMissingSpxDraftPayloads(
  supabase: SupabaseClient,
  organizationId: number,
  channelId: number,
  createdBy: string | null,
  rows: SpxShipmentDetailRow[]
): Promise<Array<Record<string, unknown>>> {
  // A failed reference lookup must not silently turn known products into unknowns.
  const { data, error } = await supabase.from('products')
    .select('id, name, search_aliases').eq('organization_id', organizationId).eq('active', true)
  if (error) throw new Error('Referensi produk belum dapat dimuat.')
  const refData: RefData = { products: data ?? [] }
  return rows.map((row) => {
    const item = parseItemDetail(row.item_in_parcel || row.item_list)
    const productBase = cleanText(item.productName) || cleanText(row.sender_name) || cleanText(row.item_in_parcel) || 'Produk SPX'
    const productMatch = matchProductIdSubstring(productBase, refData.products)
    const phone = normalize_phone_id_safe(row.recipient_phone)
    const attribution = extractAttribution(row.ref, row.sender_name, productBase)
    const codAmount = row.cod_amount ?? 0
    const shippingCost = row.basic_shipping_fee ?? row.actual_fee ?? 0
    const meta: Record<string, unknown> = {
      source: 'spx_status_missing_persist',
      spx_tracking_status: row.tracking_status,
      spx_actual_fee: row.actual_fee,
      spx_return_fee: row.return_fee,
      spx_cod_service_fee: row.cod_service_fee ?? null,
      spx_sender_name: row.sender_name ?? null,
      spx_customer_reference_no: row.ref,
      product_code_full: attribution.raw,
    }
    if (attribution.platform) meta.platform = attribution.platform
    if (attribution.account) meta.atribusi_account = attribution.account
    if (attribution.campaign) meta.atribusi_campaign = attribution.campaign
    return {
      external_order_id: cleanText(row.ref)?.toUpperCase() ?? null,
      tracking_no: cleanText(row.tracking_no)?.toUpperCase() ?? null,
      payment_method: codAmount > 0 ? 'COD' : 'TRANSFER',
      customer_name: cleanText(row.recipient_name) || 'Unknown Recipient',
      customer_phone: phone.isValid ? phone.phone : cleanText(row.recipient_phone),
      customer_province: cleanText(row.recipient_province),
      customer_city: cleanText(row.recipient_city),
      customer_subdistrict: cleanText(row.recipient_district),
      customer_village: null,
      customer_zip: cleanText(row.recipient_postal_code),
      customer_address_detail: cleanText(row.recipient_detail_address),
      customer_address: cleanText(row.recipient_detail_address),
      subtotal: Math.max(0, (row.parcel_value ?? codAmount) - shippingCost),
      shipping_cost: shippingCost,
      discount: 0,
      total: Math.max(0, (row.parcel_value ?? codAmount) - shippingCost),
      cod_amount: codAmount > 0 ? codAmount : null,
      cs_name: null,
      notes: null,
      customer_note: null,
      priority: row.tracking_status && /on hold|failed|return/i.test(row.tracking_status.toLowerCase()) ? 'URGENT' : 'NORMAL',
      meta,
      raw_data: row,
      order_date: row.create_time ? row.create_time.slice(0, 10) : undefined,
      attribution_code_raw: attribution.raw,
      attribution_platform: attribution.platform,
      attribution_account_code: attribution.account,
      attribution_campaign_marker: attribution.campaign,
      attribution_status: attribution.raw ? 'PENDING' : 'UNKNOWN',
      _item: {
        product_id: productMatch.id,
        product_name_raw: productBase,
        variation: item.variation,
        qty: item.qty || row.item_count || 1,
        price: Math.max(0, (row.parcel_value ?? codAmount) - shippingCost),
        weight_per_unit: null,
      },
    }
  })
}
