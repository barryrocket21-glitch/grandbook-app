// =============================================================
// Phase 8.5 — Product matcher untuk engine bulk upload + WA paste
// =============================================================
// Strategy: exact match only (case-insensitive + trimmed). Fuzzy match
// di-skip — false positive di nama produk Indonesia tinggi (e.g. "Pavio"
// vs "Pavio Premium" vs "Pavio Mata Ikan" semua mengandung "pavio").
//
// Preload semua products aktif dalam 1 query saat batch start; build
// in-memory Map untuk O(1) lookup per row. Hindari N+1 query.
//
// Yang TIDAK match → product_id=NULL + log_unmatched_product RPC fire-
// and-forget (async, gak block batch processing) untuk admin cleanup nanti.
// =============================================================
import type { SupabaseClient } from '@supabase/supabase-js'

interface ProductRow {
  id: number
  name: string
  search_aliases?: string[] | null
}

function normalize(raw: string): string {
  return raw.toLowerCase().trim()
}

export class ProductMatcher {
  private readonly byName: Map<string, number>

  constructor(products: ProductRow[]) {
    this.byName = new Map()
    for (const p of products) {
      if (!p.name) continue
      this.byName.set(normalize(p.name), p.id)
      // alias teks -> produk yg sama (mis. "Luna"/"MJO Luna" -> Sandal Luna)
      for (const a of p.search_aliases ?? []) {
        const k = normalize(a)
        if (k && !this.byName.has(k)) this.byName.set(k, p.id)
      }
    }
  }

  /** Returns matched product_id or null. Empty/null input → null silently. */
  match(rawName: string | null | undefined): number | null {
    if (!rawName) return null
    const key = normalize(rawName)
    if (key === '') return null
    return this.byName.get(key) ?? null
  }

  size(): number {
    return this.byName.size
  }
}

export async function createProductMatcher(
  supabase: SupabaseClient
): Promise<ProductMatcher> {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, search_aliases')
    .eq('active', true)
  if (error) throw new Error(`createProductMatcher: ${error.message}`)
  return new ProductMatcher((data ?? []) as ProductRow[])
}

/**
 * Fire-and-forget logging untuk unmatched product name. Tidak return
 * Promise — caller tidak boleh tergantung pada timing-nya. Error logged
 * ke console saja, tidak throw (jangan block ingest batch karena log
 * failure).
 */
export function logUnmatchedProductAsync(
  supabase: SupabaseClient,
  rawName: string,
  ctx: { sampleOrderId?: number | null; sampleBatchId?: string | null }
): void {
  const normalized = rawName.trim()
  if (!normalized) return
  void supabase
    .rpc('log_unmatched_product', {
      p_raw_name: normalized,
      p_sample_order_id: ctx.sampleOrderId ?? null,
      p_sample_batch_id: ctx.sampleBatchId ?? null,
    })
    .then(({ error }) => {
      if (error) {
        // eslint-disable-next-line no-console
        console.warn(`logUnmatchedProductAsync failed for "${rawName}":`, error.message)
      }
    })
}
