import { detectDuplicatePhones } from '@/lib/converter/wa-paste-phone-dup'

/** Operator warning for manual / file input; WA also checks atomically at submit. */
export async function confirmSameDayPhones(phones: string[]): Promise<boolean> {
  const requested = [...new Set(phones.map(phone => phone.trim()).filter(Boolean))]
  const existing: string[] = []
  for (let offset = 0; offset < requested.length; offset += 1000) {
    const response = await fetch('/api/orders/wa-paste/existing-phones', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phones: requested.slice(offset, offset + 1000) }),
    })
    if (!response.ok) throw new Error('Pemeriksaan nomor HP belum tersedia. Coba lagi sebelum menyimpan.')
    existing.push(...(await response.json()).phones)
  }
  const warnings = detectDuplicatePhones({ parsedPhones: phones, existingDbPhones: existing })
  if (!warnings.length) return true
  return window.confirm(`Nomor HP sama pada input hari ini (WIB):\n${warnings.slice(0,20).map(w => w.message).join('\n')}${warnings.length > 20 ? `\nDan ${warnings.length - 20} nomor lainnya.` : ''}\n\nTetap simpan sebagai order baru?`)
}
