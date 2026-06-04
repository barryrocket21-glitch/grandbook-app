'use client'
// Panel detail order (slide-in). Klik baris di list → muncul SEMUA info order itu.
// Works buat draft (orders_draft) & terminal (orders) — pilih tabel by `source`.
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Loader2 } from 'lucide-react'
import { formatRupiah, formatDateTime } from '@/lib/format'

const supabase = createClient()
const n = (v: unknown) => Number(v) || 0

interface Item { id: number; qty: number; price: number; product_name_raw: string | null; hpp_snapshot: number | null; product?: { display_name?: string | null; name?: string | null } | null }
interface OrderRow { [k: string]: unknown }

export function OrderDetailSheet({ source, id, onClose }: { source: 'draft' | 'final' | null; id: number | null; onClose: () => void }) {
  const open = source !== null && id !== null
  const [loading, setLoading] = useState(false)
  const [o, setO] = useState<OrderRow | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [names, setNames] = useState<{ adv?: string; camp?: string; ch?: string; cs?: string }>({})

  useEffect(() => {
    if (!open) return
    let cancel = false
    const run = async () => {
      setLoading(true); setO(null); setItems([])
      const tbl = source === 'draft' ? 'orders_draft' : 'orders'
      const itbl = source === 'draft' ? 'order_items_draft' : 'order_items'
      try {
        const [ord, its] = await Promise.all([
          supabase.from(tbl).select('*').eq('id', id).single(),
          supabase.from(itbl).select('*, product:products(display_name, name)').eq('order_id', id).order('id'),
        ])
        if (cancel) return
        const row = (ord.data || null) as OrderRow | null
        setO(row); setItems((its.data || []) as Item[])
        if (row) {
          const [adv, camp, ch, cs] = await Promise.all([
            row.advertiser_id ? supabase.from('profiles').select('full_name').eq('id', row.advertiser_id).single() : Promise.resolve({ data: null }),
            row.campaign_id ? supabase.from('campaigns').select('campaign_name').eq('id', row.campaign_id).single() : Promise.resolve({ data: null }),
            row.channel_id ? supabase.from('courier_channels').select('name').eq('id', row.channel_id).single() : Promise.resolve({ data: null }),
            row.cs_id ? supabase.from('profiles').select('full_name').eq('id', row.cs_id).single() : Promise.resolve({ data: null }),
          ])
          if (cancel) return
          setNames({
            adv: (adv.data as { full_name?: string } | null)?.full_name,
            camp: (camp.data as { campaign_name?: string } | null)?.campaign_name,
            ch: (ch.data as { name?: string } | null)?.name,
            cs: (cs.data as { full_name?: string } | null)?.full_name,
          })
        }
      } catch { /* silent */ } finally { if (!cancel) setLoading(false) }
    }
    void run()
    return () => { cancel = true }
  }, [open, source, id])

  const addr = o ? [o.customer_address_detail, o.customer_village, o.customer_subdistrict, o.customer_city, o.customer_province, o.customer_zip].filter(Boolean).join(', ') : ''
  const total = n(o?.total)
  const ongkir = n(o?.shipping_cost)

  return (
    <Sheet open={open} onOpenChange={x => !x && onClose()}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span className="font-mono text-sm">{o ? String(o.order_number) : '...'}</span>
            {o && <Badge variant="outline" className="text-[10px]">{String(o.status)}</Badge>}
          </SheetTitle>
        </SheetHeader>

        {loading ? <div className="py-16 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
        : !o ? <div className="py-16 text-center text-sm text-muted-foreground">Order tidak ditemukan.</div>
        : (
          <div className="space-y-4 mt-3 text-sm">
            <Section title="Pembeli">
              <Field label="Nama" value={String(o.customer_name || '—')} />
              <Field label="No HP" value={String(o.customer_phone || '—')} />
              <Field label="Alamat" value={addr || '—'} />
              <Field label="Pembayaran" value={String(o.payment_method || '—')} />
            </Section>

            <Section title="Produk">
              {items.length === 0 ? <p className="text-xs text-muted-foreground">—</p> : items.map(it => (
                <div key={it.id} className="flex justify-between text-xs py-0.5">
                  <span>{it.product?.display_name || it.product?.name || it.product_name_raw || '?'} <span className="text-muted-foreground">×{it.qty}</span></span>
                  <span className="tabular-nums">{formatRupiah(n(it.price) * n(it.qty))}</span>
                </div>
              ))}
            </Section>

            <Section title="Keuangan">
              <Field label="Harga Barang" value={formatRupiah(total)} />
              <Field label="Ongkir" value={formatRupiah(ongkir)} />
              <Field label="Total Bayar (COD)" value={formatRupiah(n(o.cod_amount) || total + ongkir)} bold />
              <Field label="Biaya Kurir (est)" value={formatRupiah(n(o.estimated_total_cost))} />
              <Field label="Gross Profit (est)" value={formatRupiah(n(o.estimated_profit))} bold />
            </Section>

            <Section title="Pengiriman">
              <Field label="Ekspedisi" value={names.ch || '—'} />
              <Field label="Resi" value={String(o.tracking_no || o.resi || '—')} mono />
              <Field label="Di-export" value={o.exported_at ? formatDateTime(String(o.exported_at)) : '—'} />
              <Field label="Sampai" value={o.delivered_at ? formatDateTime(String(o.delivered_at)) : '—'} />
            </Section>

            <Section title="Atribusi & Tim">
              <Field label="CS" value={names.cs || String(o.cs_name || '—')} />
              <Field label="Advertiser" value={names.adv || '—'} />
              <Field label="Campaign" value={names.camp || '—'} />
              <Field label="Kode" value={o.meta && (o.meta as Record<string, unknown>).atribusi_account ? `${(o.meta as Record<string, unknown>).platform}.${(o.meta as Record<string, unknown>).atribusi_account}.${(o.meta as Record<string, unknown>).atribusi_campaign}` : '—'} mono />
            </Section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-3 space-y-1">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">{title}</div>
      {children}
    </div>
  )
}
function Field({ label, value, bold, mono }: { label: string; value: string; bold?: boolean; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3 text-xs py-0.5">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className={`text-right ${bold ? 'font-semibold' : ''} ${mono ? 'font-mono text-[11px]' : ''}`}>{value}</span>
    </div>
  )
}
