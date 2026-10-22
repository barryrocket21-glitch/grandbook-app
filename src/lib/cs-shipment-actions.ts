export type ShipmentContact = {
  order_number: string
  tracking_no: string | null
  tracking_status: string | null
  customer_name: string | null
  customer_phone: string | null
  customer_city: string | null
  reject_reason: string | null
}

export function customerWhatsApp(row: ShipmentContact): string | null {
  const raw = (row.customer_phone || '').trim()
  if (!/^[+\d\s().-]+$/.test(raw)) return null
  let phone = raw.replace(/\D/g, '')
  if (phone.startsWith('0')) phone = `62${phone.slice(1)}`
  else if (phone.startsWith('8')) phone = `62${phone}`
  if (!/^628[1-9]\d{7,10}$/.test(phone)) return null
  const text = `Halo ${row.customer_name || 'Kak'}, saya CS terkait pesanan ${row.order_number}${row.tracking_no ? ` (resi ${row.tracking_no})` : ''}. Boleh kami konfirmasi perkembangan pengiriman pesanan Kakak?`
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
}

export function spxFollowupReport(row: ShipmentContact, note = ''): string {
  return [
    'Mohon bantuan pengecekan pengiriman SPX.',
    `Order: ${row.order_number}`,
    `Resi: ${row.tracking_no || 'Belum tersedia'}`,
    `Customer: ${row.customer_name || 'Belum tersedia'}`,
    `Kota: ${row.customer_city || 'Belum tersedia'}`,
    `Status tercatat di GrandBook: ${row.tracking_status || 'Belum tersedia'}`,
    row.reject_reason ? `Kendala tercatat: ${row.reject_reason}` : '',
    note.trim() ? `Catatan CS: ${note.trim()}` : '',
    'Mohon konfirmasi status terbaru dan tindak lanjutnya.',
  ].filter(Boolean).join('\n')
}
