/** Display stored source evidence only; never infer attribution from a product. */
export function getAttributionCode(order: Record<string, unknown> | null): string | null {
  if (!order) return null
  const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null
  const raw = text(order.attribution_code_raw)
  if (raw) return raw
  const parts = [order.attribution_platform, order.attribution_account_code, order.attribution_campaign_marker].map(text)
  if (parts.every(Boolean)) return parts.join('.')
  const meta = order.meta && typeof order.meta === 'object' && !Array.isArray(order.meta)
    ? order.meta as Record<string, unknown> : {}
  const legacyRaw = text(meta.product_code_full)
  if (legacyRaw) return legacyRaw
  const legacy = [meta.platform, meta.atribusi_account, meta.atribusi_campaign].map(text)
  return legacy.every(Boolean) ? legacy.join('.') : null
}
