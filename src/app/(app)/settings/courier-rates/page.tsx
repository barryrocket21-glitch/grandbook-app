'use client'
import { useState, useEffect, useMemo } from 'react'
import { getErrorMessage } from '@/lib/errors'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Combobox } from '@/components/ui/combobox'
import { toast } from 'sonner'
import { Plus, Pencil, Loader2, Trash2, Coins, Calculator, Settings2 } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { PermissionGuard } from '@/components/settings/permission-guard'
import { canManageSettings } from '@/lib/auth/permissions'
import {
  rateSchema, RATE_KEY_PRESETS, formatRateValue,
  BILLING_MODELS, BILLING_MODEL_LABEL,
  COD_FEE_BASE_OPTIONS, COD_FEE_BASE_LABEL,
  COD_FEE_ROUNDING_OPTIONS, COD_FEE_ROUNDING_LABEL,
  PPN_APPLIED_OPTIONS, PPN_APPLIED_LABEL,
  PHASE4C_RATE_LABEL,
} from '@/lib/schemas/settings'
import { formatDate } from '@/lib/format'
import { formatRupiah } from '@/lib/format'
import {
  fetchChannelCostBundle,
  updateChannelBillingMeta,
  upsertBillingConfig,
  type ChannelCostBundle,
} from '@/lib/supabase/queries/billing-config'
import { computeCost } from '@/lib/cost/calculator'
import type { BillingModel, CodFeeBase, CodFeeRounding, PpnAppliedTo } from '@/lib/types'

const supabase = createClient()

interface Channel { id: number; code: string; name: string; active: boolean }
interface Rate {
  id: number; channel_id: number; rate_key: string; rate_value: number;
  effective_from: string; effective_to: string | null;
  notes: string | null; created_at: string;
  channel?: Channel
}

const today = () => new Date().toISOString().split('T')[0]

export default function CourierRatesPage() {
  const { role } = useAuth()
  const canManage = canManageSettings(role)
  const [channels, setChannels] = useState<Channel[]>([])
  const [rates, setRates] = useState<Rate[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState({
    channel_id: '', rate_key: '', custom_key: '', rate_value: 0,
    effective_from: today(), effective_to: '', notes: '',
  })
  const [channelFilter, setChannelFilter] = useState('ALL')
  const [keyFilter, setKeyFilter] = useState('ALL')
  const [showExpired, setShowExpired] = useState(false)

  const load = async () => {
    setLoading(true)
    const [{ data: chs }, { data: rs }] = await Promise.all([
      supabase.from('courier_channels').select('id, code, name, active').order('code'),
      supabase.from('courier_channel_rates').select('*, channel:courier_channels(id, code, name)').order('effective_from', { ascending: false }),
    ])
    setChannels(chs || [])
    setRates(rs || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const reset = () => {
    setForm({ channel_id: '', rate_key: '', custom_key: '', rate_value: 0, effective_from: today(), effective_to: '', notes: '' })
    setEditId(null)
  }

  const openEdit = (r: Rate) => {
    const isPreset = (RATE_KEY_PRESETS as readonly string[]).includes(r.rate_key)
    setForm({
      channel_id: String(r.channel_id),
      rate_key: isPreset ? r.rate_key : '__custom__',
      custom_key: isPreset ? '' : r.rate_key,
      rate_value: Number(r.rate_value),
      effective_from: r.effective_from,
      effective_to: r.effective_to || '',
      notes: r.notes || '',
    })
    setEditId(r.id); setOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const finalKey = form.rate_key === '__custom__' ? form.custom_key.toLowerCase().trim() : form.rate_key
    const payload = {
      channel_id: Number(form.channel_id),
      rate_key: finalKey,
      rate_value: form.rate_value,
      effective_from: form.effective_from,
      effective_to: form.effective_to || null,
      notes: form.notes || null,
    }
    const parsed = rateSchema.safeParse(payload)
    if (!parsed.success) { toast.error(parsed.error.issues[0]?.message ?? 'Validasi gagal'); return }
    setSaving(true)
    try {
      // Replace logic: kalau create new dan ada rate aktif untuk pasangan (channel, key)
      if (!editId) {
        const { data: existing } = await supabase
          .from('courier_channel_rates')
          .select('id, effective_from')
          .eq('channel_id', payload.channel_id)
          .eq('rate_key', payload.rate_key)
          .is('effective_to', null)
          .limit(1)
        if (existing && existing.length > 0) {
          const ex = existing[0]
          const newFromDate = new Date(payload.effective_from)
          newFromDate.setDate(newFromDate.getDate() - 1)
          const oldEndDate = newFromDate.toISOString().split('T')[0]
          if (!confirm(`Rate "${payload.rate_key}" untuk channel ini sudah ada (aktif sejak ${ex.effective_from}). Set rate lama berakhir di ${oldEndDate}?`)) {
            setSaving(false); return
          }
          await supabase.from('courier_channel_rates').update({ effective_to: oldEndDate }).eq('id', ex.id)
        }
      }
      const { error } = editId
        ? await supabase.from('courier_channel_rates').update(parsed.data).eq('id', editId)
        : await supabase.from('courier_channel_rates').insert(parsed.data)
      if (error) {
        if (error.code === '23505') throw new Error('Rate untuk channel + key + tanggal mulai sudah ada')
        throw error
      }
      toast.success(editId ? 'Rate diupdate' : 'Rate ditambahkan')
      setOpen(false); reset(); load()
    } catch (err: any) { toast.error('Gagal simpan', { description: getErrorMessage(err) }) }
    finally { setSaving(false) }
  }

  const handleDelete = async (r: Rate) => {
    if (!confirm(`Hapus rate "${r.rate_key}" untuk channel ${r.channel?.code}?\n\nKalau rate sudah dipakai di order, hapus akan ditolak (set effective_to saja).`)) return
    const { error } = await supabase.from('courier_channel_rates').delete().eq('id', r.id)
    if (error) {
      if (error.code === '23503') {
        toast.error('Rate sudah dipakai di order. Set effective_to saja, jangan hapus.')
      } else {
        toast.error('Gagal hapus', { description: error.message })
      }
      return
    }
    toast.success('Rate dihapus'); load()
  }

  const uniqueKeys = useMemo(() => Array.from(new Set(rates.map(r => r.rate_key))).sort(), [rates])

  const filtered = useMemo(() => {
    let list = rates
    if (!showExpired) list = list.filter(r => !r.effective_to)
    if (channelFilter !== 'ALL') list = list.filter(r => String(r.channel_id) === channelFilter)
    if (keyFilter !== 'ALL') list = list.filter(r => r.rate_key === keyFilter)
    return list
  }, [rates, channelFilter, keyFilter, showExpired])

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Coins}
        title="Courier Rates"
        description="Rate-card per channel (fee COD, cashback ongkir, dll.) dengan effective period"
        actions={
          <PermissionGuard role={role} allowedRoles={['owner','admin']}>
            <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) reset() }}>
              <DialogTrigger render={<Button className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/20" />}>
                <Plus className="w-4 h-4 mr-2" />Tambah Rate
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader><DialogTitle>{editId ? 'Edit' : 'Tambah'} Rate</DialogTitle></DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Channel *</Label>
                    <Select value={form.channel_id} onValueChange={v => v && setForm({ ...form, channel_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Pilih channel">{(value: string | null) => channels.find(c => String(c.id) === value)?.name ?? 'Pilih channel'}</SelectValue></SelectTrigger>
                      <SelectContent className="w-[300px]">
                        {channels.filter(c => c.active).map(c => (
                          <SelectItem key={c.id} value={String(c.id)}>{c.code} — {c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Rate Key *</Label>
                    <Select value={form.rate_key} onValueChange={v => v && setForm({ ...form, rate_key: v })}>
                      <SelectTrigger><SelectValue placeholder="Pilih atau custom" /></SelectTrigger>
                      <SelectContent className="w-[280px]">
                        {RATE_KEY_PRESETS.map(k => <SelectItem key={k} value={k}>{k}</SelectItem>)}
                        <SelectItem value="__custom__">+ Custom...</SelectItem>
                      </SelectContent>
                    </Select>
                    {form.rate_key === '__custom__' && (
                      <Input value={form.custom_key} onChange={e => setForm({ ...form, custom_key: e.target.value })} placeholder="lowercase_with_underscore" className="mt-1.5" />
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Nilai *</Label>
                    <Input type="number" step="0.0001" value={form.rate_value} onChange={e => setForm({ ...form, rate_value: Number(e.target.value) })} required />
                    <p className="text-[10px] text-muted-foreground">Untuk percent: 3.5 = 3.5%. Untuk amount: 5000 = Rp 5.000.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Mulai *</Label>
                      <Input type="date" value={form.effective_from} onChange={e => setForm({ ...form, effective_from: e.target.value })} required />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Berakhir</Label>
                      <Input type="date" value={form.effective_to} onChange={e => setForm({ ...form, effective_to: e.target.value })} />
                      <p className="text-[10px] text-muted-foreground">Kosong = aktif</p>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Notes</Label>
                    <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} />
                  </div>
                  <Button type="submit" className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/20" disabled={saving}>
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Simpan
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </PermissionGuard>
        }
      />

      <BillingConfigPanel channels={channels} canManage={canManage} />

      <Card>
        <CardContent className="pt-4 pb-4 flex flex-col sm:flex-row gap-3 flex-wrap">
          <Select value={channelFilter} onValueChange={v => v && setChannelFilter(v)}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Channel">
              {(value: string | null) => {
                if (!value || value === 'ALL') return 'Semua channel'
                return channels.find(c => String(c.id) === value)?.code ?? value
              }}
            </SelectValue></SelectTrigger>
            <SelectContent className="w-[260px]">
              <SelectItem value="ALL">Semua channel</SelectItem>
              {channels.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.code}</SelectItem>)}
            </SelectContent>
          </Select>
          {uniqueKeys.length > 0 && (
            <Select value={keyFilter} onValueChange={v => v && setKeyFilter(v)}>
              <SelectTrigger className="w-52"><SelectValue placeholder="Rate Key" /></SelectTrigger>
              <SelectContent className="w-[280px]">
                <SelectItem value="ALL">Semua key</SelectItem>
                {uniqueKeys.map(k => <SelectItem key={k} value={k}>{k}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={showExpired} onCheckedChange={v => setShowExpired(!!v)} />
            <span>Tampilkan rate yang sudah berakhir</span>
          </label>
          <p className="text-xs text-muted-foreground self-center sm:ml-auto">{filtered.length} rate</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel</TableHead>
                <TableHead>Rate Key</TableHead>
                <TableHead className="text-right">Nilai</TableHead>
                <TableHead>Mulai</TableHead>
                <TableHead>Berakhir</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={7}><div className="h-4 bg-muted animate-pulse rounded" /></TableCell></TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="p-0">
                    <EmptyState icon={Coins} title="Belum ada rate" description="Tambahkan rate untuk channel. Untuk update rate yang berubah tiap periode, bikin entry baru — sistem auto-set effective_to rate lama." />
                  </TableCell>
                </TableRow>
              ) : filtered.map(r => (
                <TableRow key={r.id} className={r.effective_to ? 'opacity-70' : ''}>
                  <TableCell><Badge variant="outline" className="font-mono text-xs">{r.channel?.code}</Badge></TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{r.rate_key}</Badge></TableCell>
                  <TableCell className="text-right font-semibold">{formatRateValue(r.rate_key, Number(r.rate_value))}</TableCell>
                  <TableCell className="text-sm">{formatDate(r.effective_from)}</TableCell>
                  <TableCell>
                    {r.effective_to ? (
                      <Badge variant="outline" className="bg-zinc-500/10 text-zinc-600 text-xs">Berakhir {formatDate(r.effective_to)}</Badge>
                    ) : (
                      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 text-xs">Aktif</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{r.notes || '—'}</TableCell>
                  <TableCell className="text-right">
                    <PermissionGuard role={role} allowedRoles={['owner','admin']}>
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(r)}><Pencil className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(r)} className="text-red-500"><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                    </PermissionGuard>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {!canManage && (
        <Card className="border-blue-500/20 bg-blue-500/5">
          <CardContent className="pt-3 pb-3 text-xs text-muted-foreground">
            ℹ️ Mode read-only. Hanya Owner/Admin yang bisa edit rates.
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// =============================================================
// Phase 4C — Per-Channel Billing Configuration Panel
// =============================================================
interface BillingConfigPanelProps {
  channels: Channel[]
  canManage: boolean
}

interface PreviewInput {
  payment_method: 'COD' | 'TRANSFER'
  total: string
  shipping_cost: string
  subtotal: string
  hpp: string
  commission: string
}

function BillingConfigPanel({ channels, canManage }: BillingConfigPanelProps) {
  const [pickedChannelId, setPickedChannelId] = useState<string>('')
  const [bundle, setBundle] = useState<ChannelCostBundle | null>(null)
  const [bundleLoading, setBundleLoading] = useState(false)

  // Editable form fields
  const [billingModel, setBillingModel] = useState<BillingModel>('NO_RECONCILIATION')
  const [discountLabel, setDiscountLabel] = useState('Cashback Ongkir')
  const [codFeeBase, setCodFeeBase] = useState<CodFeeBase>('NOMINAL_COD')
  const [codFeeRounding, setCodFeeRounding] = useState<CodFeeRounding>('FLOOR')
  const [ppnAppliedTo, setPpnAppliedTo] = useState<PpnAppliedTo>('COD_FEE_ONLY')
  const [effectiveFrom, setEffectiveFrom] = useState<string>(today())
  const [savingMeta, setSavingMeta] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)

  // Preview state
  const [preview, setPreview] = useState<PreviewInput>({
    payment_method: 'COD',
    total: '150000',
    shipping_cost: '15000',
    subtotal: '135000',
    hpp: '50000',
    commission: '0',
  })

  const loadBundle = async (channelId: number) => {
    setBundleLoading(true)
    try {
      const b = await fetchChannelCostBundle(supabase, channelId)
      setBundle(b)
      if (b) {
        setBillingModel(b.channel.billing_model || 'NO_RECONCILIATION')
        setDiscountLabel(b.channel.shipping_discount_label || 'Cashback Ongkir')
        setCodFeeBase(b.cod_fee_base)
        setCodFeeRounding(b.cod_fee_rounding)
        setPpnAppliedTo(b.ppn_applied_to)
      }
    } finally {
      setBundleLoading(false)
    }
  }

  useEffect(() => {
    if (pickedChannelId) void loadBundle(Number(pickedChannelId))
    else setBundle(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedChannelId])

  const saveMeta = async () => {
    if (!pickedChannelId) return
    setSavingMeta(true)
    try {
      await updateChannelBillingMeta(supabase, Number(pickedChannelId), {
        billing_model: billingModel,
        shipping_discount_label: discountLabel,
      })
      toast.success('Channel billing meta tersimpan')
      await loadBundle(Number(pickedChannelId))
    } catch (err) {
      const msg = getErrorMessage(err)
      toast.error('Gagal simpan', { description: msg })
    } finally {
      setSavingMeta(false)
    }
  }

  const saveConfig = async () => {
    if (!pickedChannelId) return
    setSavingConfig(true)
    try {
      await upsertBillingConfig(supabase, {
        channel_id: Number(pickedChannelId),
        cod_fee_base: codFeeBase,
        cod_fee_rounding: codFeeRounding,
        ppn_applied_to: ppnAppliedTo,
        effective_from: effectiveFrom,
      })
      toast.success('Billing config tersimpan untuk period ' + effectiveFrom)
      await loadBundle(Number(pickedChannelId))
    } catch (err) {
      const msg = getErrorMessage(err)
      toast.error('Gagal simpan', { description: msg })
    } finally {
      setSavingConfig(false)
    }
  }

  // Compute preview using current form values + bundle rates
  const previewBreakdown = useMemo(() => {
    if (!bundle) return null
    return computeCost({
      payment_method: preview.payment_method,
      total: Number(preview.total) || 0,
      subtotal: Number(preview.subtotal) || 0,
      shipping_cost: Number(preview.shipping_cost) || 0,
      hpp: Number(preview.hpp) || 0,
      commission: Number(preview.commission) || 0,
      billing_model: billingModel,
      shipping_discount_rate: bundle.shipping_discount_rate,
      cod_fee_rate: bundle.cod_fee_rate,
      ppn_rate: bundle.ppn_rate,
      cod_fee_base: codFeeBase,
      cod_fee_rounding: codFeeRounding,
      ppn_applied_to: ppnAppliedTo,
    })
  }, [bundle, preview, billingModel, codFeeBase, codFeeRounding, ppnAppliedTo])

  return (
    <Card className="border-violet-500/30 bg-violet-500/5">
      <CardContent className="pt-4 pb-4 space-y-4">
        <div className="flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-violet-500" />
          <h3 className="text-sm font-semibold">Per-Channel Billing Configuration (Phase 4C)</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Set billing model + categorical config + preview cost calculator. Numeric rates (cashback%, fee COD%, PPN%)
          tetap dikelola di tabel Rate-Card di bawah. Defaults SPX_DIRECT sudah pre-filled saat migration.
        </p>

        <div className="space-y-1.5 max-w-md">
          <Label className="text-xs">Pilih Channel</Label>
          <Combobox
            value={pickedChannelId}
            onChange={setPickedChannelId}
            options={channels.filter((c) => c.active).map((c) => ({ value: String(c.id), label: `${c.code} — ${c.name}` }))}
            placeholder="Pilih channel untuk konfigurasi"
            searchPlaceholder="Cari channel..."
          />
        </div>

        {bundleLoading && (
          <div className="py-4 text-center text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin mx-auto" />
          </div>
        )}

        {bundle && !bundleLoading && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Channel meta + numeric rates summary */}
            <div className="space-y-3">
              <div className="text-xs font-semibold text-violet-500 border-b pb-1">Channel Meta + Numeric Rates</div>
              <div className="space-y-1.5">
                <Label className="text-xs">Billing Model *</Label>
                <Select value={billingModel} onValueChange={(v) => v && setBillingModel(v as BillingModel)}>
                  <SelectTrigger><SelectValue>
                    {(value: string | null) => BILLING_MODEL_LABEL[value as BillingModel] ?? 'Pilih model'}
                  </SelectValue></SelectTrigger>
                  <SelectContent className="w-[420px]">
                    {BILLING_MODELS.map((m) => (
                      <SelectItem key={m} value={m}>{BILLING_MODEL_LABEL[m]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Display Label Cashback / Diskon</Label>
                <Input
                  value={discountLabel}
                  onChange={(e) => setDiscountLabel(e.target.value)}
                  placeholder="Cashback Ongkir / Diskon Ongkir / dst."
                />
              </div>
              {canManage && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={saveMeta}
                  disabled={savingMeta}
                >
                  {savingMeta && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
                  Simpan Channel Meta
                </Button>
              )}

              <div className="pt-2 border-t">
                <div className="text-xs font-semibold mb-2">Numeric Rates Aktif (saat ini):</div>
                <table className="w-full text-xs">
                  <tbody>
                    <tr>
                      <td className="py-1 text-muted-foreground">{PHASE4C_RATE_LABEL.shipping_discount_rate}</td>
                      <td className="py-1 text-right font-semibold">{Number(bundle.shipping_discount_rate).toFixed(2)}%</td>
                    </tr>
                    <tr>
                      <td className="py-1 text-muted-foreground">{PHASE4C_RATE_LABEL.cod_fee_rate}</td>
                      <td className="py-1 text-right font-semibold">{Number(bundle.cod_fee_rate).toFixed(2)}%</td>
                    </tr>
                    <tr>
                      <td className="py-1 text-muted-foreground">{PHASE4C_RATE_LABEL.ppn_rate}</td>
                      <td className="py-1 text-right font-semibold">{Number(bundle.ppn_rate).toFixed(2)}%</td>
                    </tr>
                  </tbody>
                </table>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Edit rate di tabel Rate-Card di bawah (key: shipping_discount_rate / cod_fee_rate / ppn_rate)
                </p>
              </div>
            </div>

            {/* Categorical config */}
            <div className="space-y-3">
              <div className="text-xs font-semibold text-violet-500 border-b pb-1">Categorical Config (per period)</div>
              <div className="space-y-1.5">
                <Label className="text-xs">Fee COD Base *</Label>
                <Select value={codFeeBase} onValueChange={(v) => v && setCodFeeBase(v as CodFeeBase)}>
                  <SelectTrigger><SelectValue>
                    {(value: string | null) => COD_FEE_BASE_LABEL[value as CodFeeBase] ?? 'Pilih'}
                  </SelectValue></SelectTrigger>
                  <SelectContent className="w-[360px]">
                    {COD_FEE_BASE_OPTIONS.map((o) => (
                      <SelectItem key={o} value={o}>{COD_FEE_BASE_LABEL[o]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Fee COD Rounding *</Label>
                <Select value={codFeeRounding} onValueChange={(v) => v && setCodFeeRounding(v as CodFeeRounding)}>
                  <SelectTrigger><SelectValue>
                    {(value: string | null) => COD_FEE_ROUNDING_LABEL[value as CodFeeRounding] ?? 'Pilih'}
                  </SelectValue></SelectTrigger>
                  <SelectContent className="w-[260px]">
                    {COD_FEE_ROUNDING_OPTIONS.map((o) => (
                      <SelectItem key={o} value={o}>{COD_FEE_ROUNDING_LABEL[o]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">PPN Applied To *</Label>
                <Select value={ppnAppliedTo} onValueChange={(v) => v && setPpnAppliedTo(v as PpnAppliedTo)}>
                  <SelectTrigger><SelectValue>
                    {(value: string | null) => PPN_APPLIED_LABEL[value as PpnAppliedTo] ?? 'Pilih'}
                  </SelectValue></SelectTrigger>
                  <SelectContent className="w-[360px]">
                    {PPN_APPLIED_OPTIONS.map((o) => (
                      <SelectItem key={o} value={o}>{PPN_APPLIED_LABEL[o]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Effective from (period awal) *</Label>
                <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
                <p className="text-[10px] text-muted-foreground">
                  Kalau config berubah bulan depan: bikin period baru dengan tanggal awal bulan baru. Period lama auto-set effective_to.
                </p>
              </div>
              {canManage && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={saveConfig}
                  disabled={savingConfig}
                >
                  {savingConfig && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
                  Simpan Config Period
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Preview Calculator */}
        {bundle && previewBreakdown && (
          <div className="pt-4 border-t border-violet-500/20">
            <div className="flex items-center gap-2 mb-3">
              <Calculator className="w-4 h-4 text-violet-500" />
              <h4 className="text-sm font-semibold">Preview Cost Calculator</h4>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Inputs */}
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Payment Method</Label>
                    <Select value={preview.payment_method} onValueChange={(v) => v && setPreview({ ...preview, payment_method: v as 'COD' | 'TRANSFER' })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="COD">COD</SelectItem>
                        <SelectItem value="TRANSFER">TRANSFER</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Nominal Total</Label>
                    <Input type="number" value={preview.total} onChange={(e) => setPreview({ ...preview, total: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Subtotal Barang</Label>
                    <Input type="number" value={preview.subtotal} onChange={(e) => setPreview({ ...preview, subtotal: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Ongkir Gross</Label>
                    <Input type="number" value={preview.shipping_cost} onChange={(e) => setPreview({ ...preview, shipping_cost: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">HPP (opsional)</Label>
                    <Input type="number" value={preview.hpp} onChange={(e) => setPreview({ ...preview, hpp: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Komisi (opsional)</Label>
                    <Input type="number" value={preview.commission} onChange={(e) => setPreview({ ...preview, commission: e.target.value })} />
                  </div>
                </div>
              </div>

              {/* Breakdown output */}
              <div className="text-xs space-y-1 bg-background rounded p-3 border">
                <div className="flex justify-between"><span className="text-muted-foreground">Shipping Gross</span><span className="font-mono">{formatRupiah(previewBreakdown.shipping_gross)}</span></div>
                <div className="flex justify-between text-emerald-600"><span>− {discountLabel} ({Number(bundle.shipping_discount_rate).toFixed(0)}%)</span><span className="font-mono">−{formatRupiah(previewBreakdown.shipping_discount)}</span></div>
                <div className="flex justify-between border-t pt-1"><span className="text-muted-foreground">Shipping Net</span><span className="font-mono font-semibold">{formatRupiah(previewBreakdown.shipping_net)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">COD Fee Base</span><span className="font-mono">{formatRupiah(previewBreakdown.cod_fee_base_amount)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">COD Fee Raw ({Number(bundle.cod_fee_rate).toFixed(2)}% × base)</span><span className="font-mono">{formatRupiah(previewBreakdown.cod_fee_raw)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">COD Fee ({codFeeRounding})</span><span className="font-mono font-semibold">{formatRupiah(previewBreakdown.cod_fee)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">PPN ({Number(bundle.ppn_rate).toFixed(0)}%)</span><span className="font-mono font-semibold">{formatRupiah(previewBreakdown.ppn)}</span></div>
                <div className="flex justify-between border-t pt-1 text-orange-600"><span className="font-medium">Total Cost ke Ekspedisi</span><span className="font-mono font-bold">{formatRupiah(previewBreakdown.total_cost)}</span></div>
                <div className="flex justify-between border-t pt-1"><span className="text-muted-foreground">HPP</span><span className="font-mono">{formatRupiah(previewBreakdown.hpp)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Commission</span><span className="font-mono">{formatRupiah(previewBreakdown.commission)}</span></div>
                <div className="flex justify-between border-t pt-1 text-emerald-600"><span className="font-medium">Estimated Cash In ({BILLING_MODEL_LABEL[billingModel].split(' (')[0]})</span><span className="font-mono font-bold">{formatRupiah(previewBreakdown.cash_in)}</span></div>
                <div className={`flex justify-between border-t pt-1 ${previewBreakdown.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}><span className="font-bold">Estimated Profit</span><span className="font-mono font-bold">{formatRupiah(previewBreakdown.profit)}</span></div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
