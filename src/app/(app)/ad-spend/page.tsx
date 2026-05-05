'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Plus, Loader2, TrendingUp, DollarSign, Target, MousePointerClick } from 'lucide-react'
import { formatRupiah, formatNumber, calculateCTR, calculateCPC, calculateCPM } from '@/lib/format'
import type { Campaign, AdSpend } from '@/lib/types'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'

const supabase = createClient()

export default function AdSpendPage() {
  const { profile } = useAuth()
  const [spends, setSpends] = useState<(AdSpend & { campaigns: any })[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const [form, setForm] = useState({ spend_date: new Date().toISOString().split('T')[0], campaign_id: '' as string | null, spend: 0, impressions: 0, clicks: 0 })

  const fetch = async () => {
    setLoading(true)
    const startDate = `${month}-01`
    const endDate = `${month}-31`
    const [{ data: s }, { data: c }] = await Promise.all([
      supabase.from('ad_spend').select('*, campaigns(campaign_name, platform)').gte('spend_date', startDate).lte('spend_date', endDate).order('spend_date', { ascending: false }),
      supabase.from('campaigns').select('*').eq('active', true),
    ])
    setSpends(s || [])
    setCampaigns(c || [])
    setLoading(false)
  }
  useEffect(() => { fetch() }, [month])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.campaign_id || !form.spend) return toast.error('Campaign dan spend wajib diisi')
    setSaving(true)
    try {
      const { error } = await supabase.from('ad_spend').insert({
        spend_date: form.spend_date, campaign_id: Number(form.campaign_id),
        spend: form.spend, impressions: form.impressions || null, clicks: form.clicks || null,
        created_by: profile?.id,
      })
      if (error) throw error
      toast.success('Ad spend ditambahkan')
      setForm({ ...form, spend: 0, impressions: 0, clicks: 0 })
      setShowForm(false); fetch()
    } catch (err: any) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  const totalSpend = spends.reduce((s, x) => s + Number(x.spend), 0)
  const totalClicks = spends.reduce((s, x) => s + (x.clicks || 0), 0)
  const totalImpressions = spends.reduce((s, x) => s + (x.impressions || 0), 0)

  return (
    <div className="space-y-6">
      <PageHeader
        icon={TrendingUp}
        title="Ad Spend"
        description="Tracking pengeluaran iklan per campaign"
        actions={
          <>
            <Input type="month" value={month} onChange={e => setMonth(e.target.value)} className="w-40" />
            <Button onClick={() => setShowForm(!showForm)} className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/20"><Plus className="w-4 h-4 mr-2" />Input Spend</Button>
          </>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="overflow-hidden relative group hover:shadow-lg transition-shadow">
          <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 to-transparent opacity-50 group-hover:opacity-100 transition-opacity" />
          <CardContent className="pt-4 pb-4 flex items-center gap-3 relative">
            <div className="p-2.5 bg-red-500/15 rounded-xl ring-1 ring-red-500/20"><DollarSign className="w-5 h-5 text-red-500" /></div>
            <div className="min-w-0"><p className="text-xs text-muted-foreground uppercase tracking-wider">Total Spend</p><p className="text-lg font-bold truncate">{formatRupiah(totalSpend)}</p></div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden relative group hover:shadow-lg transition-shadow">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent opacity-50 group-hover:opacity-100 transition-opacity" />
          <CardContent className="pt-4 pb-4 flex items-center gap-3 relative">
            <div className="p-2.5 bg-blue-500/15 rounded-xl ring-1 ring-blue-500/20"><MousePointerClick className="w-5 h-5 text-blue-500" /></div>
            <div className="min-w-0"><p className="text-xs text-muted-foreground uppercase tracking-wider">Total Clicks</p><p className="text-lg font-bold">{formatNumber(totalClicks)}</p></div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden relative group hover:shadow-lg transition-shadow">
          <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 to-transparent opacity-50 group-hover:opacity-100 transition-opacity" />
          <CardContent className="pt-4 pb-4 flex items-center gap-3 relative">
            <div className="p-2.5 bg-violet-500/15 rounded-xl ring-1 ring-violet-500/20"><TrendingUp className="w-5 h-5 text-violet-500" /></div>
            <div className="min-w-0"><p className="text-xs text-muted-foreground uppercase tracking-wider">Avg CPC</p><p className="text-lg font-bold">{formatRupiah(calculateCPC(totalSpend, totalClicks))}</p></div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden relative group hover:shadow-lg transition-shadow">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent opacity-50 group-hover:opacity-100 transition-opacity" />
          <CardContent className="pt-4 pb-4 flex items-center gap-3 relative">
            <div className="p-2.5 bg-emerald-500/15 rounded-xl ring-1 ring-emerald-500/20"><Target className="w-5 h-5 text-emerald-500" /></div>
            <div className="min-w-0"><p className="text-xs text-muted-foreground uppercase tracking-wider">CTR</p><p className="text-lg font-bold">{calculateCTR(totalClicks, totalImpressions).toFixed(2)}%</p></div>
          </CardContent>
        </Card>
      </div>

      {/* Input Form */}
      {showForm && (
        <Card className="border-violet-500/20">
          <CardHeader className="pb-3"><CardTitle className="text-base">Input Ad Spend</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 items-end">
              <div className="space-y-1 flex-1"><Label className="text-xs">Tanggal</Label><Input type="date" value={form.spend_date} onChange={e => setForm({ ...form, spend_date: e.target.value })} /></div>
              <div className="space-y-1 flex-1"><Label className="text-xs">Campaign</Label><Select value={form.campaign_id} onValueChange={v => setForm({ ...form, campaign_id: v })}><SelectTrigger><SelectValue placeholder="Pilih campaign">{(value: string) => { const c = campaigns.find(c => String(c.id) === value); return c ? <span><span className="text-xs text-violet-400 mr-1">[{c.platform}]</span>{c.campaign_name}</span> : 'Pilih campaign' }}</SelectValue></SelectTrigger><SelectContent className="w-[320px]">{campaigns.length === 0 ? <div className="px-2 py-1.5 text-xs text-muted-foreground">Belum ada campaign aktif</div> : campaigns.map(c => <SelectItem key={c.id} value={String(c.id)}><span className="text-xs text-violet-400 mr-1">[{c.platform}]</span>{c.campaign_name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1 w-32"><Label className="text-xs">Spend (Rp)</Label><Input type="number" value={form.spend} onChange={e => setForm({ ...form, spend: Number(e.target.value) })} /></div>
              <div className="space-y-1 w-28"><Label className="text-xs">Impressions</Label><Input type="number" value={form.impressions} onChange={e => setForm({ ...form, impressions: Number(e.target.value) })} /></div>
              <div className="space-y-1 w-24"><Label className="text-xs">Clicks</Label><Input type="number" value={form.clicks} onChange={e => setForm({ ...form, clicks: Number(e.target.value) })} /></div>
              <Button type="submit" disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Simpan</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Tanggal</TableHead><TableHead>Campaign</TableHead><TableHead>Platform</TableHead><TableHead>Spend</TableHead><TableHead>Impressions</TableHead><TableHead>Clicks</TableHead><TableHead>CTR</TableHead><TableHead>CPC</TableHead><TableHead>CPM</TableHead></TableRow></TableHeader>
            <TableBody>
              {spends.map(s => (
                <TableRow key={s.id}>
                  <TableCell className="text-sm">{s.spend_date}</TableCell>
                  <TableCell className="font-medium text-sm">{s.campaigns?.campaign_name || '-'}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{s.campaigns?.platform}</Badge></TableCell>
                  <TableCell className="font-semibold">{formatRupiah(s.spend)}</TableCell>
                  <TableCell>{s.impressions ? formatNumber(s.impressions) : '-'}</TableCell>
                  <TableCell>{s.clicks ? formatNumber(s.clicks) : '-'}</TableCell>
                  <TableCell>{s.clicks && s.impressions ? `${calculateCTR(s.clicks, s.impressions).toFixed(2)}%` : '-'}</TableCell>
                  <TableCell>{s.clicks ? formatRupiah(calculateCPC(s.spend, s.clicks)) : '-'}</TableCell>
                  <TableCell>{s.impressions ? formatRupiah(calculateCPM(s.spend, s.impressions)) : '-'}</TableCell>
                </TableRow>
              ))}
              {spends.length === 0 && <TableRow><TableCell colSpan={9} className="p-0"><EmptyState icon={TrendingUp} title="Belum ada ad spend" description={`Klik "Input Spend" untuk mulai tracking pengeluaran iklan di bulan ${month}.`} /></TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
