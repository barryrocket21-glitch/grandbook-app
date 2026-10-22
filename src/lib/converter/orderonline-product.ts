import { PLATFORM_CODE_MAP } from '@/lib/constants'

/** Decode only the explicitly named OrderOnline source columns; retain the source row. */
export function normalizeOrderOnlineProduct(
  profileCode: string,
  raw: Record<string, unknown>,
  item: Record<string, unknown>,
  meta: Record<string, unknown>,
): void {
  if (profileCode !== 'orderonline_inbound') return
  if (typeof raw.product !== 'string' || !raw.product.trim()) return
  const original = raw.product.trim()
  item.product_name_raw = original
  item.product_code_raw = raw.product_code == null ? null : String(raw.product_code).trim() || null
  const match = original.match(/^(.+\S)\s+([FGST])\.([A-Za-z0-9]+)\.([A-Za-z0-9]+)\s*$/i)
  if (!match) return
  item.product_name_raw = match[1].trim()
  meta.product_code_full = original
  meta.platform = PLATFORM_CODE_MAP[match[2].toUpperCase()]
  meta.atribusi_account = match[3]
  meta.atribusi_campaign = match[4]
  meta.atribusi_pending = true
  meta.atribusi_status = 'PENDING'
}
