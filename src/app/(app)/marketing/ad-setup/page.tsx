'use client'
import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Megaphone, Loader2, Plus, Save, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/ui/page-header'

const supabase = createClient()
// Konvensi platform #14 (meta.platform) — ad_accounts simpan ini biar resolusi match.
const PLATFORMS = ['Facebook', 'Google', 'Snack', 'Tiktok']

interface Account { id: number; platform: string; account_code: string; name: string | null; advertiser_id: string | null; active: boolean }
interface Campaign { id: number; campaign_name: string; platform: string; account_id: number | null; campaign_marker: string | null }
interface Prof { id: string; full_name: string | null }
interface Perf { campaign_id: number; campaign_name: string; platform: string; spend_total: number; leads: number; attributed_orders: number; cpr: number | null; cpa: number | null }

export default function AdSetupPage() {
  const { role } = useAuth()
  const canManage = role === 'owner' || role === 'admin' || role === 'advertiser'
  const [accounts, setAccounts] = useState<Account[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [advs, setAdvs] = useState<Prof[]>([])
  const [perf, setPerf] = useState<Perf[]>([])
  const [loading, setLoading] = useState(true)
  const [resolving, setResolving] = useState(false)
  // new account form
  const [naf, setNaf] = useState({ platform: 'Facebook', account_code: '', name: '', advertiser_id: '' })
  const [savingAcc, setSavingAcc] = useState(false)
  const [savingCamp, setSavingCamp] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [{ data: acc }, { data: camp }, { data: pr }, { data: pf }] = await Promise.all([
        supabase.from('ad_accounts').select('id, platform, account_code, name, advertiser_id, active').order('platform').order('account_code'),
        supabase.from('campaigns').select('id, campaign_name, platform, account_id, campaign_marker').order('campaign_name'),
        supabase.from('profiles').select('id, full_name').in('role', ['advertiser', 'admin', 'owner']),
        supabase.rpc('campaign_performance', { p_from: null, p_to: null }),
      ])
      setAccounts((acc || []) as Account[])
      setCampaigns((camp || []) as Campaign[])
      setAdvs((pr || []) as Prof[])
      setPerf((pf || []) as Perf[])
    } catch (err) { console.warn('ad-setup load:', err) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const addAccount = async () => {
    if (!naf.account_code.trim()) { toast.error('Kode akun wajib (segmen "A")'); return }
    setSavingAcc(true)
    try {
      const { error } = await supabase.from('ad_accounts').insert({
        platform: naf.platform, account_code: naf.account_code.trim(), name: naf.name.trim() || null,
        advertiser_id: naf.advertiser_id || null, active: true,
      })
      if (error) throw error
      toast.success('Akun ditambah')
      setNaf({ platform: 'Facebook', account_code: '', name: '', advertiser_id: '' })
      await load()
    } catch (err) { toast.error('Gagal tambah akun', { description: err instanceof Error ? err.message : String(err) }) }
    finally { setSavingAcc(false) }
  }

  const setCamp = (id: number, patch: Partial<Campaign>) =>
    setCampaigns(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c))

  const saveCampaign = async (c: Campaign) => {
    setSavingCamp(c.id)
    try {
      const { error } = await supabase.from('campaigns')
        .update({ account_id: c.account_id, campaign_marker: c.campaign_marker?.trim() || null })
        .eq('id', c.id)
      if (error) throw error
      toast.success(`Campaign "${c.campaign_name}" disimpen`)
    } catch (err) { toast.error('Gagal simpan campaign', { description: err instanceof Error ? err.message : String(err) }) }
    finally { setSavingCamp(null) }
  }

  const resolve = async () => {
    setResolving(true)
    try {
      const { data, error } = await supabase.rpc('resolve_order_attribution', { p_ids: null })
      if (error) throw error
      const d = (data || {}) as { resolved?: number; still_pending?: number }
      toast.success(`Resolusi atribusi: ${d.resolved ?? 0} order ke-resolve, ${d.still_pending ?? 0} masih pending`, {
        description: 'Order ber-token yang akun+campaign-nya udah terdaftar → ke-set campaign_id.',
      })
    } catch (err) { toast.error('Gagal resolve', { description: err instanceof Error ? err.message : String(err) }) }
    finally { setResolving(false) }
  }

  const advName = (id: string | null) => id ? (advs.find(a => a.id === id)?.full_name ?? '—') : '—'

  if (!canManage) {
    return <div className="space-y-6"><PageHeader icon={Megaphone} title="Akun & Atribusi" /><Card><CardContent className="p-6 text-sm text-muted-foreground">Hanya owner/admin/advertiser.</CardContent></Card></div>
  }

  return (
    <div className="space-y-5">
      <PageHeader icon={Megaphone} title="Akun & Atribusi Iklan"
        description="Daftar Akun iklan + tandai Campaign (akun + marker) buat resolusi kode 'Platform.Akun.Campaign'."
        actions={
          <Button size="sm" onClick={resolve} disabled={resolving} className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white">
            {resolving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />} Resolve Atribusi
          </Button>
        } />

      {/* Master Akun */}
      <Card>
        <CardContent className="pt-4 pb-4 space-y-3">
          <div className="text-sm font-semibold">Master Akun Iklan</div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
            <div className="space-y-1">
              <Label className="text-xs">Platform</Label>
              <Select value={naf.platform} onValueChange={v => v && setNaf({ ...naf, platform: v })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>{PLATFORMS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Kode Akun (&quot;A&quot;)</Label>
              <Input value={naf.account_code} onChange={e => setNaf({ ...naf, account_code: e.target.value })} placeholder="A" className="h-9" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Nama</Label>
              <Input value={naf.name} onChange={e => setNaf({ ...naf, name: e.target.value })} placeholder="Akun Candra 1" className="h-9" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Advertiser</Label>
              <Select value={naf.advertiser_id || 'none'} onValueChange={v => setNaf({ ...naf, advertiser_id: (!v || v === 'none') ? '' : v })}>
                <SelectTrigger className="h-9"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— belum —</SelectItem>
                  {advs.map(a => <SelectItem key={a.id} value={a.id}>{a.full_name || a.id.slice(0, 8)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={addAccount} disabled={savingAcc} className="h-9 gap-1.5">
              {savingAcc ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Tambah
            </Button>
          </div>
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : accounts.length === 0 ? (
            <p className="text-xs text-muted-foreground">Belum ada akun. Tambah di atas (mis. Facebook · kode A).</p>
          ) : (
            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Platform</TableHead><TableHead>Kode</TableHead><TableHead>Nama</TableHead><TableHead>Advertiser</TableHead></TableRow></TableHeader>
                <TableBody>
                  {accounts.map(a => (
                    <TableRow key={a.id}>
                      <TableCell className="text-xs">{a.platform}</TableCell>
                      <TableCell className="font-mono text-xs">{a.account_code}</TableCell>
                      <TableCell className="text-xs">{a.name || '—'}</TableCell>
                      <TableCell className="text-xs">{advName(a.advertiser_id)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Campaign account + marker */}
      <Card>
        <CardContent className="pt-4 pb-4 space-y-3">
          <div className="text-sm font-semibold">Tandai Campaign (Akun + Marker)</div>
          <p className="text-xs text-muted-foreground">Kunci resolusi = (platform akun, kode akun, marker campaign). Mis. kode <b>F.A.1</b> → akun <b>A</b> + marker <b>1</b>.</p>
          <div className="border rounded-md overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Campaign</TableHead><TableHead>Akun</TableHead><TableHead>Marker</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {campaigns.map(c => (
                  <TableRow key={c.id}>
                    <TableCell className="text-xs">{c.campaign_name} <span className="text-muted-foreground">({c.platform})</span></TableCell>
                    <TableCell>
                      <Select value={c.account_id ? String(c.account_id) : 'none'} onValueChange={v => setCamp(c.id, { account_id: (!v || v === 'none') ? null : Number(v) })}>
                        <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">— belum —</SelectItem>
                          {accounts.map(a => <SelectItem key={a.id} value={String(a.id)}>{a.platform} · {a.account_code}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell><Input value={c.campaign_marker ?? ''} onChange={e => setCamp(c.id, { campaign_marker: e.target.value })} placeholder="1" className="h-8 w-20 text-xs" /></TableCell>
                    <TableCell><Button size="sm" variant="outline" onClick={() => saveCampaign(c)} disabled={savingCamp === c.id} className="h-8 gap-1.5">{savingCamp === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* PART 4 — Performa CPR/CPA per campaign */}
      <Card>
        <CardContent className="pt-4 pb-4 space-y-2">
          <div className="text-sm font-semibold">Performa Campaign (CPR / CPA)</div>
          <p className="text-[11px] text-muted-foreground">CPR = spend ÷ leads · CPA = spend ÷ order ter-atribusi (gross). <b>CPA final</b> (per order delivered) nunggu sync SPX (#13).</p>
          {perf.length === 0 ? (
            <p className="text-xs text-muted-foreground">Belum ada spend/atribusi. Input di <a href="/ad-spend" className="text-violet-500 hover:underline">Ad Spend</a> + resolve atribusi dulu.</p>
          ) : (
            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Campaign</TableHead><TableHead className="text-right">Spend</TableHead><TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">Order</TableHead><TableHead className="text-right">CPR</TableHead><TableHead className="text-right">CPA</TableHead><TableHead className="text-right">CPA final</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {perf.map(p => (
                    <TableRow key={p.campaign_id}>
                      <TableCell className="text-xs">{p.campaign_name} <span className="text-muted-foreground">({p.platform})</span></TableCell>
                      <TableCell className="text-right text-xs tabular-nums">Rp {Number(p.spend_total).toLocaleString('id-ID')}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{p.leads}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{p.attributed_orders}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{p.cpr != null ? 'Rp ' + Number(p.cpr).toLocaleString('id-ID') : '—'}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{p.cpa != null ? 'Rp ' + Number(p.cpa).toLocaleString('id-ID') : '—'}</TableCell>
                      <TableCell className="text-right text-[10px] text-muted-foreground italic">pending #13</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
