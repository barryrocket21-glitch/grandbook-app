// =============================================================
// WA Paste Phone Duplicate Detection
// =============================================================
// Deteksi nomor HP duplikat dalam 2 scope:
//   1. batch  — HP sama dalam paste yang sama (warning)
//   2. database — HP sudah ada di orders_draft/orders (warning)
// =============================================================

export interface PhoneDupWarning {
  phone: string
  count: number       // berapa kali muncul
  scope: 'batch' | 'database'
  message: string
}

/**
 * Deteksi HP duplikat dalam batch paste + vs existing DB.
 * @param existingDbPhones — nomor HP yang sudah ada di orders_draft + orders (org ini)
 */
export function detectDuplicatePhones(args: {
  parsedPhones: string[]
  existingDbPhones: string[]
}): PhoneDupWarning[] {
  const warnings: PhoneDupWarning[] = []
  const { parsedPhones, existingDbPhones } = args

  // 1. Within-batch duplikat
  const freq = new Map<string, number>()
  for (const p of parsedPhones) {
    const key = normalizePhone(p)
    if (!key) continue
    freq.set(key, (freq.get(key) ?? 0) + 1)
  }
  for (const [phone, count] of freq) {
    if (count > 1) {
      warnings.push({
        phone,
        count,
        scope: 'batch',
        message: `${phone} muncul ${count}× dalam batch yang sama`,
      })
    }
  }

  // 2. DB duplikat
  const dbSet = new Set(existingDbPhones.map(normalizePhone).filter(Boolean))
  for (const phone of parsedPhones) {
    const key = normalizePhone(phone)
    if (!key) continue
    if (dbSet.has(key)) {
      // hindari duplikat warning (kalau HP muncul 2× batch DAN ada di DB)
      if (!warnings.some((w) => w.phone === key)) {
        warnings.push({
          phone: key,
          count: 1,
          scope: 'database',
          message: `${key} sudah diinput hari ini (WIB)`,
        })
      }
    }
  }

  return warnings
}

function normalizePhone(raw: string): string {
  let d = (raw ?? '').replace(/\D/g, '')
  if (!d) return ''
  if (d.startsWith('62')) d = d.slice(2)
  d = d.replace(/^0+/, '')
  return d.startsWith('8') ? '0' + d : d
}
