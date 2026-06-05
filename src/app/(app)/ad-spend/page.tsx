'use client'
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Combobox } from '@/components/ui/combobox'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { getErrorMessage } from '@/lib/errors'
import {
  Plus, Pencil, Loader2, DollarSign, Trash2, Upload, FileText,
  CheckCircle2, AlertTriangle, ArrowRight, ArrowLeft, X, Coins, MousePointer, Eye,
  Calendar, CalendarRange, CalendarDays, AlertOctagon,
} from 'lucide-react'
import { formatRupiah, formatDate, formatNumber } from '@/lib/format'
import type { AdPlatform, AdSpendSource } from '@/lib/types'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import {
  DateRangePicker, thisMonth, type DateRange,
} from '@/components/ui/date-range-picker'
import {
  listAdSpend, insertAdSpend, updateAdSpend, deleteAdSpend, bulkInsertAdSpend,
  fetchAdSpendSummary,
  type AdSpendWithCampaign, type AdSpendSummary,
} from '@/lib/supabase/queries/ad-spend'
import { listCampaigns, type CampaignWithRelations } from '@/lib/supabase/queries/campaigns'
import {
  CAMPAIGN_PLATFORMS, CAMPAIGN_PLATFORM_LABEL, CAMPAIGN_PLATFORM_COLOR,
  AD_SPEND_SOURCES, AD_SPEND_SOURCE_LABEL,
} from '@/lib/schemas/settings'
import { parseMetaAdsCsv, matchToCampaigns, type MetaAdsRow, type ParseResult, type MatchResult, type ExportMode } from '@/lib/csv/meta-ads-parser'

const supabase = createClient()

const today = () => new Date().toISOString().split('T')[0]

interface SpendForm {
  spend_date: string
  campaign_id: number
  spend: number
  ppn_rate: number  // %, default 12 (Indonesia)
  impressions: number
  reach: number
  clicks: number
  leads: number
  conversions: number
  revenue_reported: number
  notes: string
}

const emptyForm: SpendForm = {
  spend_date: today(),
  campaign_id: 0,
  spend: 0,
  ppn_rate: 0,  // Default 0 — kalau spend yg di-input udah include PPN. Set 12 manual kalau billing platform pisah PPN.
  impressions: 0,
  reach: 0,
  clicks: 0,
  leads: 0,
  conversions: 0,
  revenue_reported: 0,
  notes: '',
}

// Brief #24 — performa campaign (CPR/CPA/CPA Final) di Input Harian.
interface Perf {
  campaign_id: number; campaign_name: string; platform: string
  spend_total: number; leads: number; attributed_orders: number; delivered_orders: number
  cpr: number | null; cpa: number | null; cpa_final: number | null
}

export default function AdSpendPage() {
  const { profile, role } = useAuth()
  const isOwner = role === 'owner'
  const canWrite = role === 'owner' || role === 'admin' || role === 'advertiser'

  const [rows, setRows] = useState<AdSpendWithCampaign[]>([])
  const [campaigns, setCampaigns] = useState<CampaignWithRelations[]>([])
  const [summary, setSummary] = useState<AdSpendSummary | null>(null)
  const [perf, setPerf] = useState<Perf[]>([])
  const [loading, setLoading] = useState(true)

  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState<SpendForm>(emptyForm)

  const [csvOpen, setCsvOpen] = useState(false)

  const [range, setRange] = useState<DateRange>(thisMonth())
  const [rangeReady, setRangeReady] = useState(false)
  const [platformFilter, setPlatformFilter] = useState<'ALL' | AdPlatform>('ALL')
  const [sourceFilter, setSourceFilter] = useState<'ALL' | AdSpendSource>('ALL')
  const [tab, setTab] = useState<'spend' | 'perf'>('spend')

  // Ringkasan IKUT filter (dihitung dari rows yg udah ke-filter), bukan full-range RPC
  const live = useMemo(() => {
    let spend = 0, spendTotal = 0, conv = 0, impr = 0, clicks = 0, leads = 0
    for (const r of rows) {
      spend += Number(r.spend) || 0
      spendTotal += Number(r.spend_total ?? r.spend) || 0
      conv += Number(r.conversions) || 0
      impr += Number(r.impressions) || 0
      clicks += Number(r.clicks) || 0
      leads += Number((r as { meta_lead_count?: number | null }).meta_lead_count) || 0
    }
    return { spend, spendTotal, conv, impr, clicks, leads, ctr: impr > 0 ? (clicks / impr) * 100 : 0, cpr: leads > 0 ? spendTotal / leads : 0 }
  }, [rows])

  useEffect(() => {
    setRange(thisMonth())
    setRangeReady(true)
  }, [])

  const load = useCallback(async () => {
    if (!rangeReady) return
    setLoading(true)
    try {
      const [r, c, s, pf] = await Promise.all([
        listAdSpend(supabase, {
          from: range.from, to: range.to,
          platform: platformFilter !== 'ALL' ? platformFilter : undefined,
          source: sourceFilter !== 'ALL' ? sourceFilter : undefined,
        }),
        listCampaigns(supabase),
        fetchAdSpendSummary(supabase, range.from, range.to),
        // Brief #24 — performa per periode (filter ikut DateRangePicker di atas).
        supabase.rpc('campaign_performance', { p_from: range.from, p_to: range.to }),
      ])
      setRows(r)
      setCampaigns(c)
      setSummary(s)
      setPerf((pf.data || []) as Perf[])
    } catch (err) {
      toast.error('Gagal load ad_spend', { description: getErrorMessage(err) })
    } finally {
      setLoading(false)
    }
  }, [range.from, range.to, rangeReady, platformFilter, sourceFilter])

  useEffect(() => { void load() }, [load])

  const reset = () => { setForm(emptyForm); setEditId(null) }

  const openEdit = (r: AdSpendWithCampaign) => {
    setForm({
      spend_date: r.spend_date,
      campaign_id: r.campaign_id,
      spend: Number(r.spend),
      ppn_rate: Number(r.ppn_rate ?? 12),
      impressions: r.impressions ?? 0,
      reach: r.reach ?? 0,
      clicks: r.clicks ?? 0,
      leads: (r as { meta_lead_count?: number | null }).meta_lead_count ?? 0,
      conversions: r.conversions ?? 0,
      revenue_reported: r.revenue_reported ?? 0,
      notes: r.notes ?? '',
    })
    setEditId(r.id)
    setOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.campaign_id) return toast.error('Pilih campaign dulu')
    if (form.spend <= 0) return toast.error('Spend harus > 0')
    if (form.ppn_rate < 0 || form.ppn_rate > 100) return toast.error('PPN harus 0-100%')
    setSaving(true)
    try {
      const payload = {
        spend_date: form.spend_date,
        campaign_id: form.campaign_id,
        spend: form.spend,
        ppn_rate: form.ppn_rate,
        impressions: form.impressions || null,
        reach: form.reach || null,
        clicks: form.clicks || null,
        meta_lead_count: form.leads || null,
        conversions: form.conversions || null,
        revenue_reported: form.revenue_reported || null,
        notes: form.notes.trim() || null,
      }
      if (editId) {
        await updateAdSpend(supabase, editId, payload)
        toast.success('Spend diupdate')
      } else {
        await insertAdSpend(supabase, {
          orgId: profile?.organization_id ?? 1,
          createdBy: profile?.id ?? null,
          payload: { ...payload, source: 'MANUAL' },
        })
        toast.success('Spend ditambahkan')
      }
      setOpen(false)
      reset()
      void load()
    } catch (err) {
      const msg = getErrorMessage(err)
      toast.error('Gagal simpan', { description: msg.includes('duplicate') ? 'Sudah ada spend untuk tanggal + campaign ini. Edit row existing.' : msg })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (r: AdSpendWithCampaign) => {
    if (!confirm(`Hapus spend ${formatRupiah(r.spend)} pada ${formatDate(r.spend_date)}?`)) return
    try {
      await deleteAdSpend(supabase, r.id)
      toast.success('Spend dihapus')
      void load()
    } catch (err) {
      toast.error('Gagal hapus', { description: getErrorMessage(err) })
    }
  }

  const campaignOptions = useMemo(() => {
    return campaigns
      .filter(c => c.active)
      .map(c => ({
        value: String(c.id),
        label: c.campaign_name,
        hint: CAMPAIGN_PLATFORM_LABEL[c.platform] + (c.campaign_code ? ` • ${c.campaign_code}` : ''),
      }))
  }, [campaigns])

  return (
    <div className="space-y-6">
      <PageHeader
        icon={DollarSign}
        title="Ad Spend"
        description={`${rows.length} entry • Total ${formatRupiah(summary?.total_spend ?? 0)}`}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <DateRangePicker value={range} onChange={setRange} />
            {canWrite && (
              <>
                <Button variant="outline" onClick={() => setCsvOpen(true)}>
                  <Upload className="w-4 h-4 mr-2" />Upload CSV
                </Button>
                <Button
                  onClick={() => { reset(); setOpen(true) }}
                  className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/20"
                >
                  <Plus className="w-4 h-4 mr-2" />Tambah Manual
                </Button>
              </>
            )}
          </div>
        }
      />

      {/* Stat cards — IKUT filter periode + platform */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 flex items-center gap-3 relative">
            <div className="p-2.5 bg-violet-500/15 rounded-xl ring-1 ring-violet-500/20"><Coins className="w-5 h-5 text-violet-500" /></div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Spend</p>
              <p className="text-xl font-bold text-violet-500">{formatRupiah(live.spendTotal)}</p>
              <p className="text-[10px] text-muted-foreground">{live.spendTotal > live.spend ? `Gross ${formatRupiah(live.spend)} + PPN` : `${rows.length} entry`}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 flex items-center gap-3 relative">
            <div className="p-2.5 bg-blue-500/15 rounded-xl ring-1 ring-blue-500/20"><Eye className="w-5 h-5 text-blue-500" /></div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Lead</p>
              <p className="text-xl font-bold text-blue-600">{formatNumber(live.leads)}</p>
              <p className="text-[10px] text-muted-foreground">lead dashboard</p>
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 flex items-center gap-3 relative">
            <div className="p-2.5 bg-amber-500/15 rounded-xl ring-1 ring-amber-500/20"><DollarSign className="w-5 h-5 text-amber-500" /></div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">CPR rata-rata</p>
              <p className="text-xl font-bold text-amber-600">{live.cpr > 0 ? formatRupiah(Math.round(live.cpr)) : '—'}</p>
              <p className="text-[10px] text-muted-foreground">spend ÷ lead</p>
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 flex items-center gap-3 relative">
            <div className="p-2.5 bg-emerald-500/15 rounded-xl ring-1 ring-emerald-500/20"><CheckCircle2 className="w-5 h-5 text-emerald-500" /></div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Conversions</p>
              <p className="text-xl font-bold text-emerald-500">{formatNumber(live.conv)}</p>
              <p className="text-[10px] text-muted-foreground">CTR {live.ctr.toFixed(2)}%</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tab + filter row */}
      <Card>
        <CardContent className="pt-4 pb-4 flex flex-col sm:flex-row gap-3 sm:items-center">
          <div className="inline-flex rounded-md border p-0.5 shrink-0">
            <button onClick={() => setTab('spend')} className={`px-3 h-8 text-sm rounded ${tab === 'spend' ? 'bg-violet-500 text-white' : 'text-muted-foreground'}`}>Spend Harian</button>
            <button onClick={() => setTab('perf')} className={`px-3 h-8 text-sm rounded ${tab === 'perf' ? 'bg-violet-500 text-white' : 'text-muted-foreground'}`}>Performa Campaign</button>
          </div>
          <Select value={platformFilter} onValueChange={v => v && setPlatformFilter(v as 'ALL' | AdPlatform)}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent className="w-[240px]">
              <SelectItem value="ALL">Semua platform</SelectItem>
              {CAMPAIGN_PLATFORMS.map(p => (
                <SelectItem key={p} value={p}>{CAMPAIGN_PLATFORM_LABEL[p]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sourceFilter} onValueChange={v => v && setSourceFilter(v as 'ALL' | AdSpendSource)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent className="w-[220px]">
              <SelectItem value="ALL">Semua source</SelectItem>
              {AD_SPEND_SOURCES.map(s => (
                <SelectItem key={s} value={s}>{AD_SPEND_SOURCE_LABEL[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground self-center ml-auto">
            {rows.length} entry di periode
          </p>
        </CardContent>
      </Card>

      {/* Tab: Spend Harian */}
      {tab === 'spend' && (
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tanggal</TableHead>
                <TableHead>Campaign</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead className="text-right">Spend</TableHead>
                <TableHead className="text-right">PPN</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Impr</TableHead>
                <TableHead className="text-right">Clicks</TableHead>
                <TableHead className="text-right">Conv</TableHead>
                <TableHead className="text-center">Source</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={11} className="py-3">
                      <div className="h-4 bg-muted animate-pulse rounded w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="p-0">
                    <EmptyState
                      icon={DollarSign}
                      title="Belum ada ad spend di periode ini"
                      description="Tambah manual atau upload CSV dari Meta Ads Manager export. Default PPN 12% otomatis ditambahkan ke total."
                    />
                  </TableCell>
                </TableRow>
              ) : rows.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="text-sm whitespace-nowrap">{formatDate(r.spend_date)}</TableCell>
                  <TableCell>
                    <div className="text-sm max-w-[240px] truncate">{r.campaign?.campaign_name || `#${r.campaign_id}`}</div>
                    {r.campaign?.campaign_code && (
                      <div className="text-[10px] text-muted-foreground font-mono">{r.campaign.campaign_code}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    {r.campaign?.platform && (
                      <Badge variant="outline" className={`text-[10px] ${CAMPAIGN_PLATFORM_COLOR[r.campaign.platform]}`}>
                        {CAMPAIGN_PLATFORM_LABEL[r.campaign.platform]}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-xs whitespace-nowrap">{formatRupiah(r.spend)}</TableCell>
                  <TableCell className="text-right text-[11px] text-muted-foreground whitespace-nowrap">
                    {r.ppn_amount != null ? formatRupiah(r.ppn_amount) : '—'}
                    <div className="text-[9px]">({Number(r.ppn_rate ?? 12)}%)</div>
                  </TableCell>
                  <TableCell className="text-right font-semibold whitespace-nowrap">
                    {r.spend_total != null ? formatRupiah(r.spend_total) : formatRupiah(r.spend)}
                  </TableCell>
                  <TableCell className="text-right text-xs">{r.impressions != null ? formatNumber(r.impressions) : '—'}</TableCell>
                  <TableCell className="text-right text-xs">{r.clicks != null ? formatNumber(r.clicks) : '—'}</TableCell>
                  <TableCell className="text-right text-xs text-emerald-600 font-semibold">{r.conversions != null ? formatNumber(r.conversions) : '—'}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" className="text-[10px]">{AD_SPEND_SOURCE_LABEL[r.source || 'MANUAL']}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {canWrite && (
                        <Button variant="ghost" size="icon" title="Edit" onClick={() => openEdit(r)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {isOwner && (
                        <Button variant="ghost" size="icon" title="Hapus" onClick={() => handleDelete(r)} className="text-red-500">
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      )}

      {/* Brief #24 — Performa Campaign (ikut filter periode di atas) */}
      {tab === 'perf' && (
      <Card>
        <CardContent className="pt-4 pb-4 space-y-2">
          <div className="text-sm font-semibold">Performa Campaign — periode {range.from} s/d {range.to}</div>
          <p className="text-[11px] text-muted-foreground">CPR = spend ÷ lead · CPA = spend ÷ order ter-atribusi · <b>CPA Final</b> = spend ÷ delivered (DITERIMA).</p>
          {perf.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">Belum ada spend/atribusi di periode ini.</p>
          ) : (
            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Campaign</TableHead><TableHead className="text-right">Spend</TableHead><TableHead className="text-right">Lead</TableHead>
                  <TableHead className="text-right">Closing</TableHead><TableHead className="text-right">Delivered</TableHead>
                  <TableHead className="text-right">CPR</TableHead><TableHead className="text-right">CPA</TableHead><TableHead className="text-right">CPA Final</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {perf.map(p => (
                    <TableRow key={p.campaign_id}>
                      <TableCell className="text-xs">{p.campaign_name} <span className="text-muted-foreground">({p.platform})</span></TableCell>
                      <TableCell className="text-right text-xs tabular-nums">Rp {Number(p.spend_total).toLocaleString('id-ID')}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{p.leads}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{p.attributed_orders}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{p.delivered_orders}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{p.cpr != null && Number.isFinite(Number(p.cpr)) ? formatRupiah(Number(p.cpr)) : '—'}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{p.cpa != null && Number.isFinite(Number(p.cpa)) ? formatRupiah(Number(p.cpa)) : '—'}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums font-medium text-emerald-600">{p.cpa_final != null && Number.isFinite(Number(p.cpa_final)) ? formatRupiah(Number(p.cpa_final)) : '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {/* Manual entry Dialog */}
      <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) reset() }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editId ? 'Edit' : 'Tambah'} Ad Spend Manual</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Tanggal *</Label>
                <Input
                  type="date"
                  value={form.spend_date}
                  onChange={e => setForm({ ...form, spend_date: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Spend (Rp) *</Label>
                <Input
                  type="number"
                  value={form.spend}
                  onChange={e => setForm({ ...form, spend: Number(e.target.value) || 0 })}
                  required
                />
                <p className="text-[10px] text-muted-foreground">Total yang lo bayar (kalau udah include PPN biarin PPN 0% di bawah).</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 -mt-2">
              <div className="space-y-1">
                <Label className="text-xs">PPN (%) <span className="text-muted-foreground font-normal">— optional</span></Label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={form.ppn_rate}
                  onChange={e => setForm({ ...form, ppn_rate: Number(e.target.value) || 0 })}
                  placeholder="0"
                />
                <p className="text-[9px] text-muted-foreground">Default 0. Set 12 cuma kalau billing platform pisah PPN.</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">PPN (Rp)</Label>
                <div className="h-9 px-3 flex items-center rounded-md border bg-muted/30 text-xs">
                  {formatRupiah(Math.round(form.spend * form.ppn_rate / 100))}
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-violet-500 font-semibold">Total</Label>
                <div className="h-9 px-3 flex items-center rounded-md border bg-violet-500/5 text-sm font-semibold text-violet-600">
                  {formatRupiah(Math.round(form.spend * (1 + form.ppn_rate / 100)))}
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Campaign *</Label>
              <Combobox
                value={form.campaign_id ? String(form.campaign_id) : ''}
                onChange={v => setForm({ ...form, campaign_id: v ? Number(v) : 0 })}
                options={campaignOptions}
                placeholder="Pilih campaign"
                searchPlaceholder="Cari campaign..."
                emptyHint={{
                  message: 'Belum ada campaign aktif.',
                  actionLabel: 'Bikin campaign dulu',
                  actionHref: '/campaigns',
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>Leads <span className="text-[10px] text-violet-600 font-normal">← buat CPR (spend ÷ lead)</span></Label>
              <Input type="number" value={form.leads} onChange={e => setForm({ ...form, leads: Number(e.target.value) })} placeholder="mis. 10" />
            </div>

            <details className="rounded-md border bg-muted/20 px-3 py-2">
              <summary className="text-xs font-medium cursor-pointer select-none text-muted-foreground">Metrik tambahan (opsional) — Impressions · Reach · Clicks · Conversions · Revenue</summary>
              <div className="mt-3 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Impressions</Label>
                    <Input type="number" value={form.impressions} onChange={e => setForm({ ...form, impressions: Number(e.target.value) })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Reach</Label>
                    <Input type="number" value={form.reach} onChange={e => setForm({ ...form, reach: Number(e.target.value) })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Clicks</Label>
                    <Input type="number" value={form.clicks} onChange={e => setForm({ ...form, clicks: Number(e.target.value) })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Conversions (purchases)</Label>
                    <Input type="number" value={form.conversions} onChange={e => setForm({ ...form, conversions: Number(e.target.value) })} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Revenue Reported (Meta Pixel)</Label>
                  <Input type="number" value={form.revenue_reported} onChange={e => setForm({ ...form, revenue_reported: Number(e.target.value) })} placeholder="opsional — revenue yang dilaporkan platform" />
                </div>
              </div>
            </details>
            <div className="space-y-2">
              <Label>Catatan</Label>
              <Textarea
                value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
                placeholder="opsional"
                rows={2}
              />
            </div>
            <Button
              type="submit"
              className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white"
              disabled={saving}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Simpan
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* CSV Upload Dialog */}
      <CsvUploadDialog
        open={csvOpen}
        onClose={() => setCsvOpen(false)}
        onComplete={() => { setCsvOpen(false); void load() }}
        campaigns={campaigns}
        orgId={profile?.organization_id ?? 1}
        createdBy={profile?.id ?? null}
      />
    </div>
  )
}

// =============================================================
// CSV Upload Dialog (multi-step)
// =============================================================
function CsvUploadDialog({
  open, onClose, onComplete, campaigns, orgId, createdBy,
}: {
  open: boolean
  onClose: () => void
  onComplete: () => void
  campaigns: CampaignWithRelations[]
  orgId: number
  createdBy: string | null
}) {
  type Step = 'platform' | 'upload' | 'preview' | 'importing' | 'done'
  const [step, setStep] = useState<Step>('platform')
  const [platform, setPlatform] = useState<AdPlatform>('META')
  const [file, setFile] = useState<File | null>(null)
  const [parseResult, setParseResult] = useState<ParseResult | null>(null)
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null)
  const [importResult, setImportResult] = useState<{ inserted: number; skipped_duplicate: number; errors: string[] } | null>(null)
  const [parsing, setParsing] = useState(false)
  // 5B-fix: untuk mode SNAPSHOT_DATE_RANGE_AGGREGATE, user opt-in force import (tidak rekomen).
  const [forceImportAggregate, setForceImportAggregate] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const resetAll = () => {
    setStep('platform')
    setPlatform('META')
    setFile(null)
    setParseResult(null)
    setMatchResult(null)
    setImportResult(null)
    setForceImportAggregate(false)
  }

  const handleClose = () => { resetAll(); onClose() }

  const handleFile = async (f: File) => {
    setFile(f)
    setParsing(true)
    try {
      const result = await parseMetaAdsCsv(f)
      setParseResult(result)
      const matches = matchToCampaigns(
        result.rows,
        campaigns.map(c => ({ id: c.id, campaign_name: c.campaign_name, campaign_code: c.campaign_code }))
      )
      setMatchResult(matches)
      setStep('preview')
    } catch (err) {
      toast.error('Gagal parse CSV', { description: getErrorMessage(err) })
    } finally {
      setParsing(false)
    }
  }

  const handleExecute = async () => {
    if (!matchResult || matchResult.matched_rows.length === 0) {
      toast.error('Tidak ada row untuk di-import')
      return
    }
    setStep('importing')
    const batchId = `meta_${platform}_${Date.now()}`
    const payload = matchResult.matched_rows.map(m => ({
      spend_date: m.row.spend_date,
      campaign_id: m.campaign_id,
      spend: m.row.spend,
      impressions: m.row.impressions,
      reach: m.row.reach,
      clicks: m.row.clicks,
      conversions: m.row.conversions,
      revenue_reported: m.row.revenue_reported,
      notes: null,
    }))
    try {
      const result = await bulkInsertAdSpend(supabase, {
        orgId, createdBy, rows: payload, importBatchId: batchId,
      })
      setImportResult({
        inserted: result.inserted,
        skipped_duplicate: result.skipped_duplicate,
        errors: result.errors.map(e => `Row ${e.row}: ${e.error}`),
      })
      setStep('done')
    } catch (err) {
      toast.error('Gagal import', { description: getErrorMessage(err) })
      setStep('preview')
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose() }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5" />
            Upload CSV — Step {step === 'platform' ? '1' : step === 'upload' ? '2' : step === 'preview' ? '3' : step === 'importing' ? '4' : '5'} / 5
          </DialogTitle>
        </DialogHeader>

        {step === 'platform' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Pilih platform sumber CSV. Saat ini dukung Meta format (kolom name flexible).</p>
            <div className="grid grid-cols-2 gap-3">
              {CAMPAIGN_PLATFORMS.filter(p => p === 'META' || p === 'TIKTOK').map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPlatform(p)}
                  className={`p-4 rounded-lg border-2 transition-all text-left ${platform === p ? 'border-violet-500 bg-violet-500/5' : 'border-border hover:border-violet-500/30'}`}
                >
                  <Badge variant="outline" className={`mb-2 ${CAMPAIGN_PLATFORM_COLOR[p]}`}>{CAMPAIGN_PLATFORM_LABEL[p]}</Badge>
                  <p className="text-xs text-muted-foreground">
                    {p === 'META' ? 'Export dari Ads Manager → Reports → Daily breakdown' : 'Format CSV TikTok Ads (best-effort)'}
                  </p>
                </button>
              ))}
            </div>
            <Button onClick={() => setStep('upload')} className="w-full">
              Lanjut <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        )}

        {step === 'upload' && (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full p-8 border-2 border-dashed rounded-lg hover:border-violet-500/50 hover:bg-violet-500/5 transition-all"
            >
              <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm font-medium">Klik untuk pilih file CSV</p>
              <p className="text-xs text-muted-foreground mt-1">
                Atau drop file di sini. Max 5MB.
              </p>
              {parsing && <Loader2 className="w-5 h-5 animate-spin mx-auto mt-2" />}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0]
                if (f) void handleFile(f)
              }}
            />
            <Button variant="outline" onClick={() => setStep('platform')}>
              <ArrowLeft className="w-4 h-4 mr-2" />Kembali
            </Button>
          </div>
        )}

        {step === 'preview' && parseResult && matchResult && (
          <div className="space-y-4 max-h-[600px] overflow-y-auto">
            {/* Mode detection banner */}
            <ModeBanner
              mode={parseResult.mode}
              distinctRanges={parseResult.modeDetails.distinctDateRanges}
              rows={parseResult.rows}
              forceImport={forceImportAggregate}
              onForceImportChange={setForceImportAggregate}
            />

            <div className="grid grid-cols-4 gap-3 text-xs">
              <div className="rounded border p-2">
                <p className="text-muted-foreground">Total Rows</p>
                <p className="text-lg font-bold">{parseResult.totalRowsDetected}</p>
              </div>
              <div className="rounded border p-2 bg-emerald-500/5">
                <p className="text-muted-foreground">Matched</p>
                <p className="text-lg font-bold text-emerald-600">{matchResult.matched}</p>
              </div>
              <div className="rounded border p-2 bg-amber-500/5">
                <p className="text-muted-foreground">Unmatched</p>
                <p className="text-lg font-bold text-amber-600">{matchResult.unmatched_rows.length}</p>
              </div>
              <div className="rounded border p-2 bg-red-500/5">
                <p className="text-muted-foreground">Errors</p>
                <p className="text-lg font-bold text-red-600">{parseResult.errors.length}</p>
              </div>
            </div>

            {parseResult.warnings.length > 0 && (
              <div className="rounded border bg-amber-500/5 p-3 text-xs space-y-1">
                {parseResult.warnings.map((w, i) => (
                  <p key={i} className="flex gap-2"><AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />{w}</p>
                ))}
              </div>
            )}

            <div className="rounded border bg-muted/30 p-3 text-xs">
              <p className="font-medium mb-1">Detected columns:</p>
              <p className="text-muted-foreground font-mono break-all">{parseResult.detectedColumns.join(' | ')}</p>
              {parseResult.currencyDetected && (
                <p className="text-muted-foreground mt-1">Currency: {parseResult.currencyDetected}</p>
              )}
            </div>

            {parseResult.errors.length > 0 && (
              <div className="rounded border bg-red-500/5 p-3 text-xs space-y-1">
                <p className="font-medium text-red-600">Errors:</p>
                {parseResult.errors.slice(0, 10).map((e, i) => (
                  <p key={i} className="text-red-600">Row {e.rowIndex + 1}: {e.message}</p>
                ))}
                {parseResult.errors.length > 10 && <p className="text-muted-foreground">+ {parseResult.errors.length - 10} more...</p>}
              </div>
            )}

            {matchResult.unmatched_campaign_names.length > 0 && (
              <div className="rounded border bg-amber-500/5 p-3 text-xs space-y-1">
                <p className="font-medium text-amber-700">Campaign names tidak match (akan di-skip):</p>
                {matchResult.unmatched_campaign_names.slice(0, 8).map((n, i) => (
                  <p key={i} className="text-amber-700">• {n}</p>
                ))}
                {matchResult.unmatched_campaign_names.length > 8 && (
                  <p className="text-muted-foreground">+ {matchResult.unmatched_campaign_names.length - 8} more...</p>
                )}
                <p className="text-muted-foreground mt-2">
                  Buka /campaigns + tambah campaign dengan nama yang match (Indonesia export biasa nggak punya Campaign ID, jadi match by name persis).
                </p>
              </div>
            )}

            <div className="rounded border overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="text-left p-2">Date</th>
                    {parseResult.modeDetails.hasRangeRows && <th className="text-left p-2">End</th>}
                    <th className="text-left p-2">Campaign</th>
                    <th className="text-left p-2">Match</th>
                    <th className="text-right p-2">Spend</th>
                    <th className="text-right p-2">Conv</th>
                  </tr>
                </thead>
                <tbody>
                  {matchResult.matched_rows.slice(0, 10).map((m, i) => (
                    <tr key={i} className="border-t">
                      <td className="p-2">{m.row.report_start_date}</td>
                      {parseResult.modeDetails.hasRangeRows && (
                        <td className="p-2 text-muted-foreground">{m.row.report_end_date || '—'}</td>
                      )}
                      <td className="p-2 truncate max-w-[200px]">{m.row.campaign_name}</td>
                      <td className="p-2">
                        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 text-[10px]">
                          ✓ by {m.match_by}
                        </Badge>
                      </td>
                      <td className="text-right p-2">{formatRupiah(m.row.spend)}</td>
                      <td className="text-right p-2">{m.row.conversions ?? '—'}</td>
                    </tr>
                  ))}
                  {matchResult.matched_rows.length > 10 && (
                    <tr><td colSpan={6} className="p-2 text-center text-muted-foreground">+ {matchResult.matched_rows.length - 10} more matched rows...</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep('upload')}>
                <ArrowLeft className="w-4 h-4 mr-2" />Pilih File Lain
              </Button>
              <Button
                onClick={handleExecute}
                disabled={
                  matchResult.matched_rows.length === 0 ||
                  (parseResult.mode === 'SNAPSHOT_DATE_RANGE_AGGREGATE' && !forceImportAggregate)
                }
                className="ml-auto bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white"
              >
                {parseResult.mode === 'SNAPSHOT_DATE_RANGE_AGGREGATE' && forceImportAggregate
                  ? `Force import ${matchResult.matched_rows.length} rows`
                  : `Import ${matchResult.matched_rows.length} rows`}
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </div>
        )}

        {step === 'importing' && (
          <div className="py-12 text-center">
            <Loader2 className="w-10 h-10 animate-spin mx-auto text-violet-500" />
            <p className="text-sm mt-4">Importing ad spend...</p>
          </div>
        )}

        {step === 'done' && importResult && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg border bg-emerald-500/5 p-4">
                <CheckCircle2 className="w-6 h-6 text-emerald-500 mx-auto mb-1" />
                <p className="text-xs text-muted-foreground">Inserted</p>
                <p className="text-2xl font-bold text-emerald-600">{importResult.inserted}</p>
              </div>
              <div className="rounded-lg border bg-amber-500/5 p-4">
                <FileText className="w-6 h-6 text-amber-500 mx-auto mb-1" />
                <p className="text-xs text-muted-foreground">Skipped (duplicate)</p>
                <p className="text-2xl font-bold text-amber-600">{importResult.skipped_duplicate}</p>
              </div>
              <div className="rounded-lg border bg-red-500/5 p-4">
                <X className="w-6 h-6 text-red-500 mx-auto mb-1" />
                <p className="text-xs text-muted-foreground">Errors</p>
                <p className="text-2xl font-bold text-red-600">{importResult.errors.length}</p>
              </div>
            </div>
            {importResult.errors.length > 0 && (
              <div className="rounded border bg-red-500/5 p-3 text-xs space-y-1 max-h-40 overflow-y-auto">
                {importResult.errors.map((e, i) => <p key={i} className="text-red-600">{e}</p>)}
              </div>
            )}
            <Button onClick={onComplete} className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white">
              Selesai
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// =============================================================
// 5B-fix: Mode banner ditampilkan di top Step 3 Preview.
// =============================================================
function ModeBanner({
  mode, distinctRanges, rows, forceImport, onForceImportChange,
}: {
  mode: ExportMode | null
  distinctRanges: Array<{ start: string; end: string | null; rowCount: number }>
  rows: MetaAdsRow[]
  forceImport: boolean
  onForceImportChange: (v: boolean) => void
}) {
  if (!mode) return null

  if (mode === 'SNAPSHOT_SINGLE_DAY') {
    const date = rows[0]?.report_start_date ?? '—'
    return (
      <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 flex items-center gap-3">
        <Calendar className="w-5 h-5 text-emerald-600 shrink-0" />
        <div className="text-xs flex-1">
          <p className="font-medium text-emerald-700">Mode: Snapshot 1 Hari</p>
          <p className="text-muted-foreground mt-0.5">
            {rows.length} rows × <span className="font-mono">{date}</span>. Aman import — semua row pakai tanggal yang sama.
          </p>
        </div>
      </div>
    )
  }

  if (mode === 'DAILY_BREAKDOWN') {
    const dateCount = new Set(rows.map(r => r.report_start_date)).size
    const campaignCount = new Set(rows.map(r => r.campaign_name.toLowerCase().trim())).size
    const minDate = rows.reduce((m, r) => r.report_start_date < m ? r.report_start_date : m, rows[0].report_start_date)
    const maxDate = rows.reduce((m, r) => r.report_start_date > m ? r.report_start_date : m, rows[0].report_start_date)
    return (
      <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 flex items-center gap-3">
        <CalendarDays className="w-5 h-5 text-emerald-600 shrink-0" />
        <div className="text-xs flex-1">
          <p className="font-medium text-emerald-700">Mode: Daily Breakdown</p>
          <p className="text-muted-foreground mt-0.5">
            {rows.length} rows = {campaignCount} campaign × {dateCount} hari{' '}
            (<span className="font-mono">{minDate}</span> → <span className="font-mono">{maxDate}</span>).
            Aman import — 1 row per (campaign × hari).
          </p>
        </div>
      </div>
    )
  }

  // SNAPSHOT_DATE_RANGE_AGGREGATE — block by default, require opt-in force
  const rangeRow = distinctRanges[0]
  const rangeLabel = rangeRow
    ? `${rangeRow.start} → ${rangeRow.end}`
    : '—'
  const dayCount = rangeRow && rangeRow.end
    ? Math.round((new Date(rangeRow.end).getTime() - new Date(rangeRow.start).getTime()) / (1000 * 60 * 60 * 24)) + 1
    : 0
  return (
    <div className="rounded-lg border-2 border-red-500/50 bg-red-500/5 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <AlertOctagon className="w-6 h-6 text-red-600 shrink-0 mt-0.5" />
        <div className="flex-1 space-y-2">
          <div>
            <p className="font-semibold text-red-700 text-sm">⚠️ Mode: Snapshot Date Range Aggregate</p>
            <p className="text-xs text-red-700 mt-1">
              Data ini AGGREGATE {dayCount > 0 ? `${dayCount} hari` : 'multi-day'} (<span className="font-mono">{rangeLabel}</span>).
              <strong> Tidak bisa di-import sebagai 1 hari </strong>(akan rusak time series).
            </p>
          </div>
          <div className="rounded border bg-red-500/5 p-2 text-xs space-y-1">
            <p className="font-medium text-red-700">Saran:</p>
            <ul className="list-disc list-inside text-red-700/80 space-y-0.5">
              <li>Export ulang dengan <strong>&quot;Breakdown by Day&quot;</strong> di Ads Manager Meta</li>
              <li>Atau pilih single date di Ads Manager (Awal pelaporan = Akhir pelaporan)</li>
            </ul>
          </div>
          <label className="flex items-start gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={forceImport}
              onChange={e => onForceImportChange(e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-red-700">
              <strong>Force import sebagai tanggal Awal pelaporan</strong> (<span className="font-mono">{rangeRow?.start ?? '—'}</span>) — <em>tidak rekomen, akan distort daily analytics</em>
            </span>
          </label>
        </div>
      </div>
    </div>
  )
}
