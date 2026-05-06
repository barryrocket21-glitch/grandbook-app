'use client'
import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Plus, Loader2, TrendingUp, DollarSign, Target, MousePointerClick, Pencil, Trash2, Copy } from 'lucide-react'
import { formatRupiah, formatNumber, calculateCTR, calculateCPC } from '@/lib/format'
import type { Campaign } from '@/lib/types'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { DateRangePicker, defaultRange, type DateRange } from '@/components/ui/date-range-picker'

const supabase = createClient()

interface SpendRow {
  id: number
  spend_date: string
  campaign_id: number
  spend: number
  impressions: number | null
  clicks: number | null
  lead_platform: number | null
  campaigns?: { campaign_name: string; platform: string }
}

const today = () => new Date().toISOString().split('T')[0]

export default function AdSpendPage() {
  const { profile, role } = useAuth()
  const isOwner = role === 'owner'
  const [spends, setSpends] = useState<SpendRow[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [range, setRange] = useState<DateRange>(defaultRange())
  const [campaignFilter, setCampaignFilter] = useState<string>('ALL')

  // Form state (used for both add + edit)
  const [open, setOpen] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState({ spend_date: today(), campaign_id: '' as string, spend: 0, impressions: 0, clicks: 0, lead_platform: 0 })

  // Closing + revenue maps for ROAS calc
  const [closingsByKey, setClosingsByKey] = useState<Map<string, number>>(new Map())
  const [revenueByKey, setRevenueByKey] = useState<Map<string, number>>(new Map())

  const load = async () => {
    setLoading(true)
    const [{ data: s }, { data: c }, { data: ords }] = await Promise.all([
      supabase.from('ad_spend').select('*, campaigns(campaign_name, platform)').gte('spend_date', range.from).lte('spend_date', range.to).order('spend_date', { ascending: false }),
      supabase.from('campaigns').select('*'),
      supabase.from('orders').select('campaign_id, order_date, total').gte('order_date', range.from).lte('order_date', range.to).is('duplicate_of', null).not('status', 'in', '(CANCEL,FAKE)'),
    ])
    setSpends(s || [])
    setCampaigns(c || [])
    const closeMap = new Map<string, number>()
    const revMap = new Map<string, number>()
    ;(ords || []).forEach((o: any) => {
      if (!o.campaign_id) return
      const key = `${o.campaign_id}|${o.order_date}`
      closeMap.set(key, (closeMap.get(key) || 0) + 1)
      revMap.set(key, (revMap.get(key) || 0) + Number(o.total))
    })
    setClosingsByKey(closeMap)
    setRevenueByKey(revMap)
    setLoading(false)
  }
  useEffect(() => { load() }, [range])

  const resetForm = () => {
    setForm({ spend_date: today(), campaign_id: '', spend: 0, impressions: 0, clicks: 0, lead_platform: 0 })
    setEditId(null)
  }

  const openAdd = () => { resetForm(); setOpen(true) }

  const openEdit = (s: SpendRow) => {
    setForm({
      spend_date: s.spend_date,
      campaign_id: String(s.campaign_id),
      spend: Number(s.spend),
      impressions: s.impressions || 0,
      clicks: s.clicks || 0,
      lead_platform: s.lead_platform || 0,
    })
    setEditId(s.id)
    setOpen(true)
  }

  const duplicateRow = (s: SpendRow) => {
    setForm({
      spend_date: today(),
      campaign_id: String(s.campaign_id),
      spend: Number(s.spend),
      impressions: s.impressions || 0,
      clicks: s.clicks || 0,
      lead_platform: s.lead_platform || 0,
    })
    setEditId(null)
    setOpen(true)
    toast.info('Diisi dari row sebelumnya, edit angka & tanggal lalu simpan')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.campaign_id || !form.spend) return toast.error('Campaign dan spend wajib diisi')
    setSaving(true)
    try {
      const payload: any = {
        spend_date: form.spend_date,
        campaign_id: Number(form.campaign_id),
        spend: form.spend,
        impressions: form.impressions || null,
        clicks: form.clicks || null,
        lead_platform: form.lead_platform || null,
      }
      if (editId) {
        const { error } = await supabase.from('ad_spend').update(payload).eq('id', editId)
        if (error) throw error
        toast.success('Ad spend diupdate')
      } else {
        payload.created_by = profile?.id
        const { error } = await supabase.from('ad_spend').insert(payload)
        if (error) throw error
        toast.success('Ad spend ditambahkan')
      }
      setOpen(false); resetForm(); load()
    } catch (err: any) {
      toast.error('Gagal simpan', { description: err.message })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (s: SpendRow) => {
    if (!confirm(`Hapus ad spend ${formatRupiah(Number(s.spend))} di ${s.campaigns?.campaign_name} pada ${s.spend_date}?`)) return
    const { error } = await supabase.from('ad_spend').delete().eq('id', s.id)
    if (error) { toast.error('Gagal hapus', { description: error.message }); return }
    toast.success('Ad spend dihapus')
    load()
  }

  // Filter
  const filtered = useMemo(() => {
    if (campaignFilter === 'ALL') return spends
    return spends.filter(s => String(s.campaign_id) === campaignFilter)
  }, [spends, campaignFilter])

  // Stats from filtered
  const stats = useMemo(() => {
    const totalSpend = filtered.reduce((s, x) => s + Number(x.spend), 0)
    const totalLeadPlatform = filtered.reduce((s, x) => s + (x.lead_platform || 0), 0)
    const totalClicks = filtered.reduce((s, x) => s + (x.clicks || 0), 0)
    const totalImpressions = filtered.reduce((s, x) => s + (x.impressions || 0), 0)
    let totalClosingReal = 0
    let totalRevenue = 0
    filtered.forEach(s => {
      const k = `${s.campaign_id}|${s.spend_date}`
      totalClosingReal += closingsByKey.get(k) || 0
      totalRevenue += revenueByKey.get(k) || 0
    })
    const cppPlatform = totalLeadPlatform > 0 ? totalSpend / totalLeadPlatform : 0
    const cpaReal = totalClosingReal > 0 ? totalSpend / totalClosingReal : 0
    const roas = totalSpend > 0 ? totalRevenue / totalSpend : 0
    return { totalSpend, totalLeadPlatform, totalClicks, totalImpressions, totalClosingReal, totalRevenue, cppPlatform, cpaReal, roas }
  }, [filtered, closingsByKey, revenueByKey])

  return (
    <div className="space-y-6">
      <PageHeader
        icon={TrendingUp}
        title="Ad Spend"
        description="Tracking pengeluaran iklan per campaign per hari"
        actions={
          <div className="flex items-center gap-2">
            <DateRangePicker value={range} onChange={setRange} />
            <Button onClick={openAdd} className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/20">
              <Plus className="w-4 h-4 mr-2" />Input Spend
            </Button>
          </div>
        }
      />

      {/* Stats — 4 columns */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 flex items-center gap-3 relative">
            <div className="p-2.5 bg-red-500/15 rounded-xl ring-1 ring-red-500/20"><DollarSign className="w-5 h-5 text-red-500" /></div>
            <div className="min-w-0"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Spend</p><p className="text-lg font-bold truncate">{formatRupiah(stats.totalSpend)}</p></div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 flex items-center gap-3 relative">
            <div className="p-2.5 bg-amber-500/15 rounded-xl ring-1 ring-amber-500/20"><MousePointerClick className="w-5 h-5 text-amber-500" /></div>
            <div className="min-w-0"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">CPP Platform</p><p className="text-lg font-bold">{stats.cppPlatform > 0 ? formatRupiah(stats.cppPlatform) : '—'}</p><p className="text-[10px] text-muted-foreground">{stats.totalLeadPlatform} lead claim</p></div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 flex items-center gap-3 relative">
            <div className="p-2.5 bg-emerald-500/15 rounded-xl ring-1 ring-emerald-500/20"><Target className="w-5 h-5 text-emerald-500" /></div>
            <div className="min-w-0"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">CPA Real</p><p className="text-lg font-bold text-emerald-500">{stats.cpaReal > 0 ? formatRupiah(stats.cpaReal) : '—'}</p><p className="text-[10px] text-muted-foreground">{stats.totalClosingReal} closing</p></div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 flex items-center gap-3 relative">
            <div className="p-2.5 bg-violet-500/15 rounded-xl ring-1 ring-violet-500/20"><TrendingUp className="w-5 h-5 text-violet-500" /></div>
            <div className="min-w-0"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">ROAS</p><p className={`text-lg font-bold ${stats.roas >= 2 ? 'text-emerald-500' : stats.roas >= 1 ? 'text-amber-500' : 'text-red-500'}`}>{stats.roas > 0 ? `${stats.roas.toFixed(2)}x` : '—'}</p><p className="text-[10px] text-muted-foreground">{formatRupiah(stats.totalRevenue)} revenue</p></div>
          </CardContent>
        </Card>
      </div>

      {/* Filter */}
      <Card>
        <CardContent className="pt-4 pb-4 flex items-center gap-3">
          <Label className="text-sm">Filter campaign:</Label>
          <Select value={campaignFilter} onValueChange={v => v && setCampaignFilter(v)}>
            <SelectTrigger className="w-72"><SelectValue /></SelectTrigger>
            <SelectContent className="w-[320px]">
              <SelectItem value="ALL">Semua campaign</SelectItem>
              {campaigns.map(c => <SelectItem key={c.id} value={String(c.id)}><span className="text-xs text-violet-400 mr-1">[{c.platform}]</span>{c.campaign_name}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground ml-auto">{filtered.length} entry</p>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tanggal</TableHead>
                <TableHead>Campaign</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead className="text-right">Spend</TableHead>
                <TableHead className="text-center">Lead</TableHead>
                <TableHead className="text-right">CPP</TableHead>
                <TableHead className="text-center">Closing</TableHead>
                <TableHead className="text-right">CPA</TableHead>
                <TableHead className="text-right">ROAS</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={10} className="py-3"><div className="h-4 bg-muted animate-pulse rounded w-full" /></TableCell></TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="p-0">
                    <EmptyState icon={TrendingUp} title="Belum ada ad spend" description="Klik 'Input Spend' di atas untuk mulai tracking pengeluaran iklan." />
                  </TableCell>
                </TableRow>
              ) : filtered.map(s => {
                const k = `${s.campaign_id}|${s.spend_date}`
                const closingReal = closingsByKey.get(k) || 0
                const revenue = revenueByKey.get(k) || 0
                const cpp = s.lead_platform && s.lead_platform > 0 ? Number(s.spend) / s.lead_platform : null
                const cpa = closingReal > 0 ? Number(s.spend) / closingReal : null
                const roas = Number(s.spend) > 0 ? revenue / Number(s.spend) : 0
                const roasColor = roas >= 2 ? 'text-emerald-500' : roas >= 1 ? 'text-amber-500' : 'text-red-500'
                return (
                  <TableRow key={s.id}>
                    <TableCell className="text-sm font-medium whitespace-nowrap">{s.spend_date}</TableCell>
                    <TableCell className="text-sm max-w-[180px] truncate">{s.campaigns?.campaign_name || '-'}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{s.campaigns?.platform}</Badge></TableCell>
                    <TableCell className="font-semibold text-right">{formatRupiah(Number(s.spend))}</TableCell>
                    <TableCell className="text-center text-sm">{s.lead_platform || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-right">{cpp !== null ? <span className="text-amber-500">{formatRupiah(cpp)}</span> : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-center font-semibold text-emerald-500">{closingReal || <span className="text-muted-foreground font-normal">—</span>}</TableCell>
                    <TableCell className="text-right">{cpa !== null ? <span className="text-emerald-500 font-semibold">{formatRupiah(cpa)}</span> : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className={`text-right font-semibold ${roasColor}`}>{roas > 0 ? `${roas.toFixed(2)}x` : <span className="text-muted-foreground font-normal">—</span>}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" title="Duplikat ke hari ini" onClick={() => duplicateRow(s)}><Copy className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="icon" title="Edit" onClick={() => openEdit(s)}><Pencil className="w-3.5 h-3.5" /></Button>
                        {isOwner && <Button variant="ghost" size="icon" title="Hapus" onClick={() => handleDelete(s)} className="text-red-500"><Trash2 className="w-3.5 h-3.5" /></Button>}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) resetForm() }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editId ? 'Edit Ad Spend' : 'Input Ad Spend'}</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="text-xs">Tanggal *</Label><Input type="date" value={form.spend_date} onChange={e => setForm({ ...form, spend_date: e.target.value })} required /></div>
              <div className="space-y-1.5"><Label className="text-xs">Spend (Rp) *</Label><Input type="number" value={form.spend} onChange={e => setForm({ ...form, spend: Number(e.target.value) })} required /></div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Campaign *</Label>
              <Select value={form.campaign_id} onValueChange={v => v && setForm({ ...form, campaign_id: v })}>
                <SelectTrigger><SelectValue placeholder="Pilih campaign">{(value: string) => { const c = campaigns.find(c => String(c.id) === value); return c ? <span><span className="text-xs text-violet-400 mr-1">[{c.platform}]</span>{c.campaign_name}</span> : 'Pilih campaign' }}</SelectValue></SelectTrigger>
                <SelectContent className="w-[320px]">
                  {campaigns.length === 0 ? <div className="px-2 py-1.5 text-xs text-muted-foreground">Belum ada campaign</div> : campaigns.map(c => <SelectItem key={c.id} value={String(c.id)}><span className="text-xs text-violet-400 mr-1">[{c.platform}]</span>{c.campaign_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label className="text-xs">Lead dari Platform Dashboard</Label><Input type="number" value={form.lead_platform} onChange={e => setForm({ ...form, lead_platform: Number(e.target.value) })} placeholder="0" /><p className="text-[10px] text-muted-foreground">Angka yang Meta/TikTok/Google klaim — buat hitung CPP & leakage</p></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="text-xs">Impressions</Label><Input type="number" value={form.impressions} onChange={e => setForm({ ...form, impressions: Number(e.target.value) })} placeholder="0" /></div>
              <div className="space-y-1.5"><Label className="text-xs">Clicks</Label><Input type="number" value={form.clicks} onChange={e => setForm({ ...form, clicks: Number(e.target.value) })} placeholder="0" /></div>
            </div>
            {form.spend > 0 && form.lead_platform > 0 && (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">CPP estimasi</span><span className="font-semibold text-amber-500">{formatRupiah(form.spend / form.lead_platform)}</span></div>
                {form.clicks > 0 && <div className="flex justify-between"><span className="text-muted-foreground">CPC</span><span className="font-semibold">{formatRupiah(calculateCPC(form.spend, form.clicks))}</span></div>}
                {form.impressions > 0 && form.clicks > 0 && <div className="flex justify-between"><span className="text-muted-foreground">CTR</span><span className="font-semibold">{calculateCTR(form.clicks, form.impressions).toFixed(2)}%</span></div>}
              </div>
            )}
            <Button type="submit" className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/20" disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Simpan</Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Tips */}
      <Card className="border-blue-500/20 bg-blue-500/5">
        <CardContent className="pt-4 pb-4 text-sm space-y-1">
          <p>📊 <strong>Tips:</strong></p>
          <ul className="list-disc list-inside text-xs text-muted-foreground space-y-1">
            <li><strong>CPP</strong> = Spend / Lead Platform (yang Meta/TT klaim) — angka di Meta Ads Manager kamu</li>
            <li><strong>CPA Real</strong> = Spend / Closing yang masuk GrandBook — angka kebenaran</li>
            <li><strong>ROAS</strong> ≥2x bagus, 1–2x marginal, &lt;1x rugi</li>
            <li>Klik <Copy className="w-3 h-3 inline" /> untuk duplikat row sebagai entry hari ini — fast input untuk campaign yang spending-nya konsisten</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
