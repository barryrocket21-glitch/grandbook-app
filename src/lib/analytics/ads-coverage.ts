export type Spend = { id: number; campaign_id: number; spend_total: number }
export type Allocation = { campaign_id: number; product_id: number; allocation_pct: number }
export type Campaign = { id: number; platform: string | null }
export type AdsBucket = { product_id: number | null; platform: string; amount: number }

// Every stored cent belongs to exactly one bucket; missing allocation stays visible.
export function allocateAds(spends: Spend[], campaigns: Campaign[], allocations: Allocation[]): AdsBucket[] {
  const platforms = new Map(campaigns.map(c => [c.id, c.platform?.trim().toUpperCase() || 'UNKNOWN']))
  const seen = new Set<number>()
  const buckets = new Map<string, AdsBucket>()
  function add(product_id: number | null, platform: string, cents: number) {
    const key = `${product_id ?? 'unallocated'}__${platform}`
    const row = buckets.get(key) || { product_id, platform, amount: 0 }
    row.amount += cents
    buckets.set(key, row)
  }
  for (const spend of spends) {
    const cents = Math.round(Number(spend.spend_total) * 100)
    if (seen.has(spend.id) || !Number.isSafeInteger(cents) || cents < 0 || spend.spend_total == null) throw new Error('Data ADS tidak valid atau duplikat')
    seen.add(spend.id)
    if (!platforms.has(spend.campaign_id)) throw new Error('Kampanye ADS tidak tersedia')
    const platform = platforms.get(spend.campaign_id)!
    const rows = allocations.filter(a => a.campaign_id === spend.campaign_id).sort((a,b) => a.product_id - b.product_id)
    const products = new Set<number>()
    let percent = 0
    let assigned = 0
    for (const row of rows) {
      const pct = Number(row.allocation_pct)
      if (!Number.isFinite(pct) || pct < 0 || products.has(row.product_id) || row.allocation_pct == null) throw new Error('Alokasi ADS tidak valid')
      products.add(row.product_id)
      percent += pct
      if (percent > 100 + 1e-8) throw new Error('Alokasi ADS melebihi 100%')
      // Cumulative rounding preserves the original stored amount exactly.
      const next = Math.round(cents * Math.min(100, percent) / 100)
      add(row.product_id, platform, next - assigned)
      assigned = next
    }
    if (assigned !== cents) add(null, platform, cents - assigned)
  }
  return [...buckets.values()].map(b => ({ ...b, amount: b.amount / 100 }))
}
