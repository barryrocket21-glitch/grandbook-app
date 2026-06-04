'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getErrorMessage } from '@/lib/errors'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Truck, Loader2, Plus, Trash2, Save, Package, Calculator } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/ui/page-header'
import { canManageSettings } from '@/lib/auth/permissions'
import { INTERNAL_STATUSES, STATUS_LABEL } from '@/lib/schemas/settings'
import type { OrderStatus } from '@/lib/types'

const supabase = createClient()

// Brief #12 — rate-key yang dipakai cost engine (#4C). Barry isi % sendiri.
const RATE_FIELDS = [
  { key: 'cod_fee_rate', label: 'Fee COD', hint: '% dari nilai COD' },
  { key: 'shipping_discount_rate', label: 'Cashback Ongkir', hint: '% dari ongkir' },
  { key: 'ppn_rate', label: 'PPN', hint: '% pajak' },
  { key: 'rts_shipping_rate', label: 'Ongkir Retur (RTS)', hint: '% saat retur' },
]
// Label kanonik lifecycle (niru pola agregator) → enum internal existing.
const CANONICAL_HINT: Partial<Record<OrderStatus, string>> = {
  SIAP_KIRIM: 'Sudah Diexport / Pending Pickup', DIKIRIM: 'Dikirim (in transit)',
  DITERIMA: 'Terkirim (Delivered) → Arsip', RETUR: 'Retur / Proses Retur',
}

interface Channel { id: number; code: string; name: string; aggregator: string | null; active: boolean; courier_id: number | null; courier_name: string; courier_code: string; billing_model: string | null; shipping_discount_label: string | null }
interface BillingCfg { cod_fee_base: string | null; ppn_applied_to: string | null; cod_fee_rounding: string | null }
interface StatusRow { id?: number; channel_id: number; raw_status: string; internal_status: OrderStatus; _new?: boolean }

export default function MasterKurirPage() {
  const { role } = useAuth()
  const canManage = canManageSettings(role)
  const [channels, setChannels] = useState<Channel[]>([])
  const [rates, setRates] = useState<Record<number, Record<string, string>>>({})  // channel → key → value(str)
  const [billing, setBilling] = useState<Record<number, BillingCfg>>({})
  const [statuses, setStatuses] = useState<Record<number, StatusRow[]>>({})
  const [loading, setLoading] = useState(true)
  const [savingRates, setSavingRates] = useState<number | null>(null)
  const [savingStatus, setSavingStatus] = useState<number | null>(null)
  const [recomputing, setRecomputing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [{ data: chs }, { data: rts }, { data: sts }, { data: bcfg }] = await Promise.all([
        supabase.from('courier_channels').select('id, code, name, aggregator, active, courier_id, billing_model, shipping_discount_label, courier:couriers(name, code)').order('id'),
        supabase.from('courier_channel_rates').select('channel_id, rate_key, rate_value').is('effective_to', null),
        supabase.from('courier_channel_statuses').select('id, channel_id, raw_status, internal_status').order('raw_status'),
        supabase.from('channel_billing_config').select('channel_id, cod_fee_base, ppn_applied_to, cod_fee_rounding').is('effective_to', null),
      ])
      const chList: Channel[] = (chs || []).map((c: Record<string, unknown>) => ({
        id: c.id as number, code: c.code as string, name: c.name as string,
        aggregator: c.aggregator as string | null, active: c.active as boolean, courier_id: c.courier_id as number | null,
        billing_model: c.billing_model as string | null, shipping_discount_label: c.shipping_discount_label as string | null,
        courier_name: (c.courier as { name?: string } | null)?.name ?? '—',
        courier_code: (c.courier as { code?: string } | null)?.code ?? '',
      }))
      setChannels(chList)
      const bmap: Record<number, BillingCfg> = {}
      ;(bcfg || []).forEach((b: Record<string, unknown>) => {
        bmap[b.channel_id as number] = { cod_fee_base: b.cod_fee_base as string | null, ppn_applied_to: b.ppn_applied_to as string | null, cod_fee_rounding: b.cod_fee_rounding as string | null }
      })
      setBilling(bmap)
      const rmap: Record<number, Record<string, string>> = {}
      ;(rts || []).forEach((r: Record<string, unknown>) => {
        const cid = r.channel_id as number
        rmap[cid] = rmap[cid] || {}
        rmap[cid][r.rate_key as string] = String(Number(r.rate_value))
      })
      setRates(rmap)
      const smap: Record<number, StatusRow[]> = {}
      ;(sts || []).forEach((s: Record<string, unknown>) => {
        const cid = s.channel_id as number
        smap[cid] = smap[cid] || []
        smap[cid].push({ id: s.id as number, channel_id: cid, raw_status: s.raw_status as string, internal_status: s.internal_status as OrderStatus })
      })
      setStatuses(smap)
    } catch (err) {
      console.warn('master-kurir load failed:', err)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // Group channels per courier
  const byCourier = useMemo(() => {
    const map = new Map<string, Channel[]>()
    for (const c of channels) {
      const k = c.courier_name
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(c)
    }
    return Array.from(map.entries())
  }, [channels])

  const setRate = (cid: number, key: string, val: string) =>
    setRates(prev => ({ ...prev, [cid]: { ...(prev[cid] || {}), [key]: val } }))

  const saveRates = async (cid: number) => {
    setSavingRates(cid)
    try {
      const today = new Date().toISOString().slice(0, 10)
      for (const f of RATE_FIELDS) {
        const raw = rates[cid]?.[f.key]
        if (raw === undefined || raw === '') continue
        const val = Number(raw)
        if (!Number.isFinite(val) || val < 0) { toast.error(`Nilai ${f.label} tidak valid`); continue }
        // Effective-dating: kalau nilai berubah → TUTUP baris lama (effective_to)
        // + bikin baris baru (effective_from hari ini). Histori gak ketimpa.
        const { data: existing } = await supabase.from('courier_channel_rates')
          .select('id, rate_value').eq('channel_id', cid).eq('rate_key', f.key).is('effective_to', null).maybeSingle()
        const ex = existing as { id: number; rate_value: number } | null
        if (ex && Number(ex.rate_value) === val) continue  // gak berubah → skip
        if (ex) {
          await supabase.from('courier_channel_rates').update({ effective_to: today }).eq('id', ex.id)
        }
        await supabase.from('courier_channel_rates').insert({ channel_id: cid, rate_key: f.key, rate_value: val, effective_from: today })
      }
      toast.success('Rates kesimpen (histori lama disimpan)')
      await load()
    } catch (err) {
      toast.error('Gagal simpan rates', { description: getErrorMessage(err) })
    } finally { setSavingRates(null) }
  }

  const addStatusRow = (cid: number) =>
    setStatuses(prev => ({ ...prev, [cid]: [...(prev[cid] || []), { channel_id: cid, raw_status: '', internal_status: 'DIKIRIM', _new: true }] }))
  const setStatusRow = (cid: number, idx: number, patch: Partial<StatusRow>) =>
    setStatuses(prev => ({ ...prev, [cid]: (prev[cid] || []).map((r, i) => i === idx ? { ...r, ...patch } : r) }))
  const removeStatusRow = async (cid: number, idx: number) => {
    const row = statuses[cid]?.[idx]
    if (row?.id) { await supabase.from('courier_channel_statuses').delete().eq('id', row.id) }
    setStatuses(prev => ({ ...prev, [cid]: (prev[cid] || []).filter((_, i) => i !== idx) }))
  }
  const saveStatus = async (cid: number) => {
    setSavingStatus(cid)
    try {
      const rows = (statuses[cid] || []).filter(r => r.raw_status.trim())
      for (const r of rows) {
        await supabase.from('courier_channel_statuses')
          .upsert({ channel_id: cid, raw_status: r.raw_status.trim(), internal_status: r.internal_status }, { onConflict: 'channel_id,raw_status' })
      }
      toast.success('Status mapping kesimpen')
      await load()
    } catch (err) {
      toast.error('Gagal simpan status', { description: getErrorMessage(err) })
    } finally { setSavingStatus(null) }
  }

  // PART 3 — Recompute biaya order yang belum dihitung (estimated_* + profit).
  const recompute = async () => {
    setRecomputing(true)
    try {
      const { data, error } = await supabase.rpc('recompute_draft_costs', { p_ids: null, p_force: false })
      if (error) throw error
      toast.success(`Recompute selesai: ${data ?? 0} order dihitung biaya-nya`, {
        description: 'estimated_profit dkk keisi. Order baru otomatis ke-hitung (trigger).',
      })
    } catch (err) {
      toast.error('Gagal recompute', { description: getErrorMessage(err) })
    } finally { setRecomputing(false) }
  }

  if (!canManage) {
    return <div className="space-y-6"><PageHeader icon={Truck} title="Setup Kurir" /><Card><CardContent className="p-6 text-sm text-muted-foreground">Hanya owner/admin.</CardContent></Card></div>
  }

  return (
    <div className="space-y-5">
      <PageHeader icon={Truck} title="Setup Kurir"
        description="Satu tempat config tiap kurir: tipe, billing, rates (biaya), & status mapping. Ganti % langsung di sini."
        actions={
          <Button size="sm" onClick={recompute} disabled={recomputing} className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white">
            {recomputing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Calculator className="w-3.5 h-3.5" />}
            Recompute Biaya
          </Button>
        } />

      {loading ? (
        <div className="py-16 text-center text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
      ) : byCourier.map(([courierName, chs]) => (
        <div key={courierName} className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            <Package className="w-3.5 h-3.5" /> {courierName}
          </div>
          {chs.map(ch => (
            <Card key={ch.id} className={ch.active ? '' : 'opacity-60'}>
              <CardContent className="pt-4 pb-4 space-y-4">
                {/* Header */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold">{ch.name}</span>
                  <Badge variant="outline" className="font-mono text-[10px]">{ch.code}</Badge>
                  {ch.aggregator
                    ? <Badge variant="outline" className="bg-violet-500/10 text-violet-600 border-violet-500/30 text-[10px]">Agregator: {ch.aggregator}</Badge>
                    : <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-[10px]">Direct</Badge>}
                  {ch.billing_model && <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/30 text-[10px]">Billing: {ch.billing_model}</Badge>}
                  {!ch.active && <Badge variant="outline" className="text-[10px]">nonaktif</Badge>}
                </div>
                {/* Billing detail (channel_billing_config) */}
                {billing[ch.id] && (
                  <div className="text-[11px] text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
                    <span>Basis fee COD: <b className="text-foreground">{billing[ch.id].cod_fee_base}</b></span>
                    <span>PPN atas: <b className="text-foreground">{billing[ch.id].ppn_applied_to}</b></span>
                    <span>Pembulatan: <b className="text-foreground">{billing[ch.id].cod_fee_rounding}</b></span>
                  </div>
                )}

                {/* Rates */}
                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rates (biaya)</div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {RATE_FIELDS.map(f => (
                      <div key={f.key} className="space-y-1">
                        <Label className="text-xs">{f.key === 'shipping_discount_rate' && ch.shipping_discount_label ? ch.shipping_discount_label : f.label}</Label>
                        <div className="relative">
                          <Input type="number" step="0.1" min={0} value={rates[ch.id]?.[f.key] ?? ''}
                            onChange={e => setRate(ch.id, f.key, e.target.value)} placeholder="0" className="pr-6" />
                          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground">{f.hint}</p>
                      </div>
                    ))}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => saveRates(ch.id)} disabled={savingRates === ch.id} className="gap-1.5">
                    {savingRates === ch.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Simpan Rates
                  </Button>
                </div>

                {/* Status Mapping */}
                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status Mapping (status kurir → status seragam)</div>
                  <div className="space-y-1.5">
                    {(statuses[ch.id] || []).map((r, idx) => (
                      <div key={r.id ?? `new-${idx}`} className="flex items-center gap-2">
                        <Input value={r.raw_status} onChange={e => setStatusRow(ch.id, idx, { raw_status: e.target.value })}
                          placeholder="Status dari kurir (mis. Delivered)" className="flex-1 h-8 text-xs" />
                        <span className="text-muted-foreground text-xs">→</span>
                        <Select value={r.internal_status} onValueChange={v => v && setStatusRow(ch.id, idx, { internal_status: v as OrderStatus })}>
                          <SelectTrigger className="w-44 h-8 text-xs"><SelectValue>{(v: string | null) => v ? (STATUS_LABEL[v as OrderStatus] ?? v) : 'pilih status'}</SelectValue></SelectTrigger>
                          <SelectContent>
                            {INTERNAL_STATUSES.map(s => (
                              <SelectItem key={s} value={s}>{STATUS_LABEL[s]}{CANONICAL_HINT[s] ? ` — ${CANONICAL_HINT[s]}` : ''}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500" onClick={() => removeStatusRow(ch.id, idx)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => addStatusRow(ch.id)} className="gap-1.5 text-xs"><Plus className="w-3.5 h-3.5" /> Tambah baris</Button>
                    <Button size="sm" variant="outline" onClick={() => saveStatus(ch.id)} disabled={savingStatus === ch.id} className="gap-1.5">
                      {savingStatus === ch.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Simpan Status
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ))}
    </div>
  )
}
