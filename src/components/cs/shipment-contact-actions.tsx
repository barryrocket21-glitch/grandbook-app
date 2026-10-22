'use client'

import { useRef, useState } from 'react'
import { MessageCircle, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { customerWhatsApp, type ShipmentContact } from '@/lib/cs-shipment-actions'

export type ContactProgress = { order_number: string; wa_opened_at: string | null; contacted_at: string | null }
const supabase = createClient()
const time = (value: string) => new Date(value).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'short', timeStyle: 'short' })

export function ShipmentContactActions({ row, progress, readFailed, onSaved }: {
  row: ShipmentContact & { id: number; source: string }
  progress?: ContactProgress
  readFailed: boolean
  onSaved: (value: ContactProgress) => void
}) {
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(false)
  async function save(action: 'wa_opened' | 'contacted' | 'clear_contacted') {
    if (inFlight.current) return
    inFlight.current = true
    setSaving(true); setError('')
    try {
      const { data, error: rpcError } = await supabase.rpc('record_my_cs_contact', { p_source: row.source, p_order_id: row.id, p_action: action })
      if (rpcError || !data?.[0]) throw new Error('Catatan belum tersimpan. Coba lagi; status pengiriman tidak berubah.')
      onSaved(data[0]); setConfirm(false)
    } catch (err) { setError(err instanceof Error ? err.message : 'Catatan belum tersimpan.') }
    finally { inFlight.current = false; setSaving(false) }
  }
  function openWa() {
    const url = customerWhatsApp(row)
    if (!url || inFlight.current) return
    // Open synchronously to preserve the browser's user-gesture permission.
    const opened = window.open('about:blank', '_blank')
    if (!opened) { setError('Browser memblokir tab WA. Izinkan pop-up lalu coba lagi.'); return }
    opened.opener = null
    opened.location.href = url
    void save('wa_opened')
  }
  return <div className="space-y-2 w-56">
    <Button size="sm" className="w-full bg-emerald-700 text-white hover:bg-emerald-800" disabled={!customerWhatsApp(row) || saving} onClick={openWa}><MessageCircle /> WhatsApp customer</Button>
    {!customerWhatsApp(row) && <p className="text-xs text-muted-foreground">Nomor WA belum valid</p>}
    <div role="status" className="text-xs">
      {progress?.contacted_at ? <p className="text-emerald-600 flex gap-1"><CheckCircle2 className="size-3.5 shrink-0" />Dikonfirmasi CS: sudah dihubungi<br />{time(progress.contacted_at)} WIB</p>
        : progress?.wa_opened_at ? <p className="text-amber-600">WA dibuka · {time(progress.wa_opened_at)} WIB<br />Belum dikonfirmasi dihubungi</p>
        : <p className="text-muted-foreground">{readFailed ? 'Riwayat kontak belum dapat dimuat' : 'Belum ada tindak lanjut tercatat'}</p>}
    </div>
    {confirm ? <div className="rounded border p-2 space-y-2 text-xs">
      <p>Sudah mengirim pesan atau menghubungi customer ini? Membuka WA saja belum berarti customer dihubungi.</p>
      <div className="flex gap-1"><Button size="xs" disabled={saving} onClick={() => void save('contacted')}>Ya, sudah dihubungi</Button><Button variant="ghost" size="xs" disabled={saving} onClick={() => setConfirm(false)}>Batal</Button></div>
    </div> : progress?.contacted_at
      ? <Button variant="ghost" size="xs" disabled={saving} onClick={() => void save('clear_contacted')}>Batalkan penanda dihubungi</Button>
      : <Button variant="outline" size="xs" disabled={saving} onClick={() => setConfirm(true)}>Tandai sudah dihubungi</Button>}
    {saving && <p className="text-xs">Menyimpan catatan…</p>}
    {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
  </div>
}
