'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Megaphone, Loader2, Plus, Save, Wand2, Pencil, Trash2, Power, X, Check, ChevronDown } from 'lucide-react'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { PageHeader } from '@/components/ui/page-header'
import { getErrorMessage } from '@/lib/errors'

const supabase = createClient()
// Brief #19 — vocab KANONIK (samain parser #14 + campaigns + resolver). "F" = Meta.
const PLATFORMS = ['META', 'GOOGLE', 'SNACK', 'TIKTOK']
// Brief #22 — kebalikan PLATFORM_CODE_MAP (buat tampilin kode atribusi "Luna F.A.1")
const PLATFORM_LETTER: Record<string, string> = { META: 'F', GOOGLE: 'G', SNACK: 'S', TIKTOK: 'T' }

interface Account { id: number; platform: string; account_code: string; name: string | null; advertiser_id: string | null; active: boolean }
interface Campaign { id: number; campaign_name: string; platform: string; account_id: number | null; campaign_marker: string | null; active: boolean }
interface Prof { id: string; full_name: string | null }

interface Prod { id: number; name: string }

export default function AdSetupPage() {
  const { role, profile } = useAuth()
  const canManage = role === 'owner' || role === 'admin' || role === 'advertiser'
  const [accounts, setAccounts] = useState<Account[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [advs, setAdvs] = useState<Prof[]>([])
  const [products, setProducts] = useState<Prod[]>([])
  const [campProd, setCampProd] = useState<Record<number, string>>({})
  const [campProdId, setCampProdId] = useState<Record<number, number>>({})
  const [loading, setLoading] = useState(true)
  const [resolving, setResolving] = useState(false)
  // new account form
  const [naf, setNaf] = useState({ platform: 'META', account_code: '', name: '', advertiser_id: '' })
  const [savingAcc, setSavingAcc] = useState(false)
  const [savingCamp, setSavingCamp] = useState<number | null>(null)
  // Brief #23 — buat campaign SIMPLE inline (akun + marker + produk + nama; tanpa budget)
  const [ncf, setNcf] = useState({ account_id: '', marker: '', product_id: '', name: '' })
  const [savingNew, setSavingNew] = useState(false)
  // Brief #21 — edit/hapus/toggle akun
  const [editAccId, setEditAccId] = useState<number | null>(null)
  const [editCampId, setEditCampId] = useState<number | null>(null) // campaign read-only sampai klik Edit
  const [eaf, setEaf] = useState({ platform: 'META', account_code: '', name: '', advertiser_id: '' })
  const [accBusy, setAccBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [{ data: acc }, { data: camp }, { data: pr }, { data: prod }, { data: cprod }] = await Promise.all([
        supabase.from('ad_accounts').select('id, platform, account_code, name, advertiser_id, active').order('platform').order('account_code'),
        supabase.from('campaigns').select('id, campaign_name, platform, account_id, campaign_marker, active').order('campaign_name'),
        supabase.from('profiles').select('id, full_name').in('role', ['advertiser', 'admin', 'owner']),
        supabase.from('products').select('id, name').eq('active', true).order('name'),
        supabase.from('campaign_products').select('campaign_id, product_id, products(name)'),
      ])
      setAccounts((acc || []) as Account[])
      setCampaigns((camp || []) as Campaign[])
      setAdvs((pr || []) as Prof[])
      setProducts((prod || []) as Prod[])
      // campaign_id → produk (nama buat tampilan, id buat marker per-produk)
      const cpMap: Record<number, string> = {}; const cpIdMap: Record<number, number> = {}
      for (const r of (cprod || []) as unknown as { campaign_id: number; product_id: number; products: { name: string } | { name: string }[] | null }[]) {
        const pn = Array.isArray(r.products) ? r.products[0]?.name : r.products?.name
        if (!cpMap[r.campaign_id]) { if (pn) cpMap[r.campaign_id] = pn; cpIdMap[r.campaign_id] = r.product_id }
      }
      setCampProd(cpMap); setCampProdId(cpIdMap)
    } catch (err) { console.warn('ad-setup load:', err) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const addAccount = async () => {
    if (!naf.account_code.trim()) { toast.error('Kode akun wajib (segmen "A")'); return }
    setSavingAcc(true)
    try {
      // Brief #20 — via RPC (set organization_id=current_org_id() server-side → match RLS).
      const { error } = await supabase.rpc('create_ad_account', {
        p_platform: naf.platform, p_account_code: naf.account_code.trim(),
        p_name: naf.name.trim() || null, p_advertiser_id: naf.advertiser_id || null,
      })
      if (error) throw error
      toast.success(`Akun "${naf.account_code.trim()}" (${naf.platform}) ditambah`)
      setNaf({ platform: 'META', account_code: '', name: '', advertiser_id: '' })
      await load()
    } catch (err) {
      const msg = getErrorMessage(err)
      // Brief #28 — dup kode akun: arahin ke Campaign (akun gak perlu dibikin 2x).
      if (/udah ada|already/i.test(msg)) {
        toast.error(`Akun "${naf.account_code.trim()}" udah ada — gak perlu dibikin lagi`, {
          description: '1 akun bisa banyak produk & campaign. Mau nambah produk/campaign di akun ini? Scroll ke "Buat Campaign Baru" di bawah, pilih akun ini. Mau ganti nama akun? Pakai tombol Edit (pensil) di baris akun.',
        })
      } else {
        toast.error('Gagal tambah akun', { description: msg })
      }
    }
    finally { setSavingAcc(false) }
  }

  // Brief #23 — singkatan platform (Meta=F dst) buat tampilan
  const platLabel = (pf: string) => `${pf} (${PLATFORM_LETTER[pf] ?? '?'})`
  // Brief #28 — berapa campaign di tiap akun (akun = wadah banyak campaign).
  const campCount = (accId: number) => campaigns.filter(c => c.account_id === accId).length
  // Brief #29 — marker berikutnya per (akun + PRODUK). Mis. Luna di akun A → 1,2;
  // Pavio di akun A → 1,2,3 (terpisah). Marker reset per produk.
  const nextMarker = (accountId: number, productId: number | null) => {
    const used = campaigns.filter(c => c.account_id === accountId && (productId != null && campProdId[c.id] === productId))
      .map(c => parseInt(c.campaign_marker || '0', 10)).filter(n => !isNaN(n))
    return String((used.length ? Math.max(...used) : 0) + 1)
  }
  // kode atribusi penuh ala model Barry: "Luna F.A.1" (produk + platform.akun.marker)
  const codeFor = (prodName: string | undefined, acc: Account, marker: string) =>
    `${prodName ? prodName + ' ' : ''}${PLATFORM_LETTER[acc.platform] ?? '?'}.${acc.account_code}.${marker}`

  // Kode atribusi per campaign (produk.platform.akun.marker) — null kalau belum lengkap
  const campCode = useCallback((c: Campaign): string | null => {
    const acc = accounts.find(a => a.id === c.account_id)
    return acc && c.campaign_marker ? codeFor(campProd[c.id], acc, c.campaign_marker) : null
  }, [accounts, campProd])
  // Deteksi campaign DOBEL: identitas (akun+produk+marker) sama → kode atribusi tabrakan,
  // bikin resolusi order ke-ambigu. Constraint unik udah dilepas (marker per-produk),
  // jadi deteksi pindah ke sini (warn, gak block — biar bisa dibenerin).
  const dupCodes = useMemo(() => {
    const cnt: Record<string, number[]> = {}
    for (const c of campaigns) { const k = campCode(c); if (k) (cnt[k] ||= []).push(c.id) }
    return new Map(Object.entries(cnt).filter(([, ids]) => ids.length > 1))
  }, [campaigns, campCode])

  const createCampaign = async () => {
    const acc = accounts.find(a => String(a.id) === ncf.account_id)
    if (!acc) { toast.error('Pilih akun dulu'); return }
    if (!ncf.product_id) { toast.error('Pilih produk dulu (marker per produk)'); return }
    const prodId = Number(ncf.product_id)
    const marker = (ncf.marker.trim() || nextMarker(acc.id, prodId))
    const prod = products.find(x => String(x.id) === ncf.product_id)
    // guard: (akun + produk + marker) gak boleh dobel
    const dup = campaigns.some(c => c.account_id === acc.id && campProdId[c.id] === prodId && (c.campaign_marker || '') === marker)
    if (dup) { toast.error(`Kode ${codeFor(prod?.name, acc, marker)} udah ada — pakai marker lain`); return }
    // nama auto kalau kosong (= kode penuh, unik per produk+marker)
    const name = ncf.name.trim() || codeFor(prod?.name, acc, marker)
    setSavingNew(true)
    try {
      const orgId = profile?.organization_id ?? 1
      const { data: camp, error } = await supabase.from('campaigns')
        .insert({ organization_id: orgId, campaign_name: name, platform: acc.platform,
          account_id: acc.id, campaign_marker: marker, status: 'ACTIVE', active: true })
        .select('id').single()
      if (error) throw error
      if (ncf.product_id && camp) {
        const { error: pe } = await supabase.from('campaign_products')
          .insert({ organization_id: orgId, campaign_id: camp.id, product_id: Number(ncf.product_id), allocation_pct: 100 })
        if (pe) throw pe
      }
      toast.success(`Campaign dibuat — kode: ${codeFor(prod?.name, acc, marker)}`)
      setNcf({ account_id: '', marker: '', product_id: '', name: '' })
      await load()
    } catch (err) { toast.error('Gagal buat campaign', { description: getErrorMessage(err) }) }
    finally { setSavingNew(false) }
  }

  const startEditAcc = (a: Account) => {
    setEditAccId(a.id)
    setEaf({ platform: a.platform, account_code: a.account_code, name: a.name || '', advertiser_id: a.advertiser_id || '' })
  }
  const saveEditAcc = async () => {
    if (!editAccId || !eaf.account_code.trim()) { toast.error('Kode akun wajib'); return }
    setAccBusy(true)
    try {
      const { error } = await supabase.rpc('update_ad_account', {
        p_id: editAccId, p_platform: eaf.platform, p_account_code: eaf.account_code.trim(),
        p_name: eaf.name.trim() || null, p_advertiser_id: eaf.advertiser_id || null,
      })
      if (error) throw error
      toast.success('Akun diupdate'); setEditAccId(null); await load()
    } catch (err) { toast.error('Gagal update akun', { description: getErrorMessage(err) }) }
    finally { setAccBusy(false) }
  }
  const toggleAcc = async (a: Account) => {
    setAccBusy(true)
    try {
      const { error } = await supabase.rpc('set_ad_account_active', { p_id: a.id, p_active: !a.active })
      if (error) throw error
      toast.success(!a.active ? 'Akun diaktifkan' : 'Akun dinonaktifkan'); await load()
    } catch (err) { toast.error('Gagal toggle', { description: getErrorMessage(err) }) }
    finally { setAccBusy(false) }
  }
  const deleteAcc = async (a: Account) => {
    if (!confirm(`Hapus akun "${a.account_code}" (${a.platform})? Diblok kalau ada campaign pakai akun ini — nonaktifin aja kalau gitu.`)) return
    setAccBusy(true)
    try {
      const { error } = await supabase.rpc('delete_ad_account', { p_id: a.id })
      if (error) throw error
      toast.success('Akun dihapus'); await load()
    } catch (err) { toast.error('Gagal hapus akun', { description: getErrorMessage(err) }) }
    finally { setAccBusy(false) }
  }

  const setCamp = (id: number, patch: Partial<Campaign>) =>
    setCampaigns(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c))

  const saveCampaign = async (c: Campaign) => {
    if (!c.campaign_name.trim()) { toast.error('Nama campaign wajib'); return }
    // Guard dobel: identitas (akun+produk+marker) gak boleh nabrak campaign lain
    if (c.account_id != null && c.campaign_marker?.trim()) {
      const collide = campaigns.some(o => o.id !== c.id && o.account_id === c.account_id
        && campProdId[o.id] === campProdId[c.id] && (o.campaign_marker || '') === (c.campaign_marker || ''))
      if (collide) { toast.error('Identitas campaign nabrak campaign lain (akun+produk+marker sama). Ganti marker.'); return }
    }
    setSavingCamp(c.id)
    try {
      // Brief #24 — simpan nama + akun + marker (edit penuh per baris).
      const { error } = await supabase.from('campaigns')
        .update({ campaign_name: c.campaign_name.trim(), account_id: c.account_id, campaign_marker: c.campaign_marker?.trim() || null })
        .eq('id', c.id)
      if (error) throw error
      toast.success(`Campaign "${c.campaign_name}" disimpen`); await load()
    } catch (err) { toast.error('Gagal simpan campaign', { description: getErrorMessage(err) }) }
    finally { setSavingCamp(null) }
  }
  const toggleCampaign = async (c: Campaign) => {
    setSavingCamp(c.id)
    try {
      const { error } = await supabase.from('campaigns').update({ active: !c.active }).eq('id', c.id)
      if (error) throw error
      toast.success(!c.active ? 'Campaign diaktifkan' : 'Campaign dinonaktifkan'); await load()
    } catch (err) { toast.error('Gagal toggle', { description: getErrorMessage(err) }) }
    finally { setSavingCamp(null) }
  }
  const deleteCampaignRow = async (c: Campaign) => {
    if (!confirm(`Hapus campaign "${c.campaign_name}"? Diblok kalau ada order/spend ke-link — nonaktifin aja kalau gitu.`)) return
    setSavingCamp(c.id)
    try {
      const { error } = await supabase.rpc('delete_campaign', { p_id: c.id })
      if (error) throw error
      toast.success('Campaign dihapus'); await load()
    } catch (err) { toast.error('Gagal hapus campaign', { description: getErrorMessage(err) }) }
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
    } catch (err) { toast.error('Gagal resolve', { description: getErrorMessage(err) }) }
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
          <p className="text-[11px] text-muted-foreground"><b>1 akun = wadah, dibikin SEKALI.</b> Di dalam 1 akun bisa banyak produk &amp; banyak campaign (semua dibuat di bagian <b>Campaign</b> di bawah, pilih akun ini). Jadi <b>gak perlu bikin akun kode sama 2x</b> — kode akun unik per platform (kayak KTP). <b>Kode Akun</b> = huruf identitas akun yang masuk ke kode atribusi (mis. <b>A</b> di <span className="font-mono">Luna F.<b>A</b>.1</span>). <b>Nama</b> = label bebas (gak masuk kode). Nomor campaign (1,2,3) = di <b>Campaign → Marker</b>.</p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
            <div className="space-y-1">
              <Label className="text-xs">Platform</Label>
              <Select value={naf.platform} onValueChange={v => v && setNaf({ ...naf, platform: v })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>{PLATFORMS.map(p => <SelectItem key={p} value={p}>{platLabel(p)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Kode Akun (huruf di kode atribusi)</Label>
              <Input value={naf.account_code} onChange={e => setNaf({ ...naf, account_code: e.target.value })} placeholder="A" className="h-9" title="Huruf pendek yang masuk ke kode atribusi (segmen .A.). 1 akun iklan = 1 kode, unik per platform." />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Nama akun (bebas)</Label>
              <Input value={naf.name} onChange={e => setNaf({ ...naf, name: e.target.value })} placeholder="Akun Meta Candra" className="h-9" title="Label buat manusia — gak masuk kode atribusi." />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Advertiser</Label>
              <Select value={naf.advertiser_id || 'none'} onValueChange={v => setNaf({ ...naf, advertiser_id: (!v || v === 'none') ? '' : v })}>
                <SelectTrigger className="h-9"><SelectValue placeholder="—">{naf.advertiser_id ? advName(naf.advertiser_id) : '—'}</SelectValue></SelectTrigger>
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
            <p className="text-xs text-muted-foreground">Belum ada akun. Tambah di atas (mis. META · kode A).</p>
          ) : (
            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Platform</TableHead><TableHead>Kode</TableHead><TableHead>Nama</TableHead><TableHead>Advertiser</TableHead><TableHead className="text-center">Campaign</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Aksi</TableHead></TableRow></TableHeader>
                <TableBody>
                  {accounts.map(a => editAccId === a.id ? (
                    <TableRow key={a.id} className="bg-violet-500/5">
                      <TableCell>
                        <Select value={eaf.platform} onValueChange={v => v && setEaf({ ...eaf, platform: v })}>
                          <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>{PLATFORMS.map(p => <SelectItem key={p} value={p}>{platLabel(p)}</SelectItem>)}</SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell><Input value={eaf.account_code} onChange={e => setEaf({ ...eaf, account_code: e.target.value })} className="h-8 w-20 text-xs font-mono" /></TableCell>
                      <TableCell><Input value={eaf.name} onChange={e => setEaf({ ...eaf, name: e.target.value })} className="h-8 text-xs" /></TableCell>
                      <TableCell>
                        <Select value={eaf.advertiser_id || 'none'} onValueChange={v => setEaf({ ...eaf, advertiser_id: (!v || v === 'none') ? '' : v })}>
                          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="—">{eaf.advertiser_id ? advName(eaf.advertiser_id) : '—'}</SelectValue></SelectTrigger>
                          <SelectContent><SelectItem value="none">— belum —</SelectItem>{advs.map(x => <SelectItem key={x.id} value={x.id}>{x.full_name || x.id.slice(0, 8)}</SelectItem>)}</SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell />
                      <TableCell />
                      <TableCell className="text-right whitespace-nowrap">
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-emerald-600" disabled={accBusy} onClick={saveEditAcc} title="Simpan"><Check className="w-4 h-4" /></Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditAccId(null)} title="Batal"><X className="w-4 h-4" /></Button>
                      </TableCell>
                    </TableRow>
                  ) : (
                    <TableRow key={a.id} className={a.active ? '' : 'opacity-50'}>
                      <TableCell className="text-xs">{a.platform}</TableCell>
                      <TableCell className="font-mono text-xs">{a.account_code}</TableCell>
                      <TableCell className="text-xs">{a.name || '—'}</TableCell>
                      <TableCell className="text-xs">{advName(a.advertiser_id)}</TableCell>
                      <TableCell className="text-center text-xs tabular-nums">{campCount(a.id) > 0 ? <span className="font-medium">{campCount(a.id)}</span> : <span className="text-muted-foreground">0</span>}</TableCell>
                      <TableCell><Badge variant="outline" className={a.active ? 'bg-emerald-500/10 text-emerald-600 text-[10px]' : 'bg-zinc-500/10 text-zinc-500 text-[10px]'}>{a.active ? 'Aktif' : 'Nonaktif'}</Badge></TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<Button size="sm" variant="outline" className="h-8 gap-1 text-xs" disabled={accBusy}>Kelola <ChevronDown className="w-3 h-3" /></Button>} />
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => startEditAcc(a)}><Pencil className="w-3.5 h-3.5 mr-2" /> Edit</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => toggleAcc(a)}><Power className="w-3.5 h-3.5 mr-2" /> {a.active ? 'Nonaktifkan' : 'Aktifkan'}</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => deleteAcc(a)} className="text-red-500"><Trash2 className="w-3.5 h-3.5 mr-2" /> Hapus</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
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
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">Campaign</div>
            <a href="/campaigns" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border text-xs hover:bg-muted text-muted-foreground">Advanced (budget/tanggal) →</a>
          </div>
          <p className="text-xs text-muted-foreground">Kode atribusi yang dipakai CS = <b>Produk Platform.Akun.Marker</b> (mis. <b>Luna F.A.1</b>). Singkatan platform: META=F · GOOGLE=G · SNACK=S · TIKTOK=T.</p>

          {dupCodes.size > 0 && (
            <div className="rounded-md border border-rose-500/40 bg-rose-500/10 p-3 text-xs space-y-1">
              <div className="font-semibold text-rose-600 flex items-center gap-1.5"><X className="w-3.5 h-3.5" /> {dupCodes.size} kode campaign DOBEL terdeteksi</div>
              <div className="text-rose-700/80">Kode atribusi sama (produk+platform+akun+marker) → resolusi order bisa ketuker. Ganti marker / hapus salah satu:</div>
              <div className="flex flex-wrap gap-1.5">
                {[...dupCodes.entries()].map(([code, ids]) => (
                  <span key={code} className="font-mono bg-rose-500/15 text-rose-700 px-1.5 py-0.5 rounded">{code} <b>×{ids.length}</b></span>
                ))}
              </div>
            </div>
          )}

          {/* Brief #23 — Buat Campaign SIMPEL (akun + marker + produk + nama; tanpa budget) */}
          <div className="rounded-md border bg-violet-500/5 p-3 space-y-2">
            <div className="text-xs font-medium">+ Buat Campaign Baru</div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
              <div className="space-y-1">
                <Label className="text-[10px]">Nama</Label>
                <Input value={ncf.name} onChange={e => setNcf({ ...ncf, name: e.target.value })} placeholder="auto: produk + kode" className="h-9 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Akun (platform)</Label>
                <Select value={ncf.account_id || 'none'} onValueChange={v => { const id = (!v || v === 'none') ? '' : v; const pid = ncf.product_id ? Number(ncf.product_id) : null; setNcf({ ...ncf, account_id: id, marker: (id && pid != null) ? nextMarker(Number(id), pid) : ncf.marker }) }}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="pilih akun">{(() => { const a = accounts.find(x => String(x.id) === ncf.account_id); return a ? `${platLabel(a.platform)} · ${a.account_code}` : 'pilih akun' })()}</SelectValue></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— pilih akun —</SelectItem>
                    {accounts.filter(a => a.active).map(a => <SelectItem key={a.id} value={String(a.id)}>{platLabel(a.platform)} · {a.account_code}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Marker (no. urut, auto-isi)</Label>
                <Input value={ncf.marker} onChange={e => setNcf({ ...ncf, marker: e.target.value })} placeholder="1" className="h-9 text-xs" title="Nomor campaign per produk (1,2,3...). Otomatis keisi pas pilih akun+produk; bisa diganti manual." />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Produk (wajib)</Label>
                <Select value={ncf.product_id || 'none'} onValueChange={v => { const pid = (!v || v === 'none') ? '' : v; const accId = ncf.account_id ? Number(ncf.account_id) : null; setNcf({ ...ncf, product_id: pid, marker: (accId != null && pid) ? nextMarker(accId, Number(pid)) : ncf.marker }) }}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="pilih produk">{(() => { const pp = products.find(x => String(x.id) === ncf.product_id); return pp ? pp.name : 'pilih produk' })()}</SelectValue></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— pilih produk —</SelectItem>
                    {products.map(pp => <SelectItem key={pp.id} value={String(pp.id)}>{pp.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={createCampaign} disabled={savingNew} className="h-9 gap-1.5">{savingNew ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Buat</Button>
            </div>
            {(() => {
              const a = accounts.find(x => String(x.id) === ncf.account_id)
              const pp = products.find(x => String(x.id) === ncf.product_id)
              if (a && ncf.marker.trim()) {
                return <div className="text-[11px]">Kode atribusi CS: <span className="font-mono bg-violet-500/10 text-violet-600 px-1.5 py-0.5 rounded">{codeFor(pp?.name, a, ncf.marker.trim())}</span></div>
              }
              return null
            })()}
          </div>

          <div className="border rounded-md overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Campaign</TableHead><TableHead>Akun</TableHead><TableHead>Marker</TableHead><TableHead>Kode Atribusi</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Aksi</TableHead></TableRow></TableHeader>
              <TableBody>
                {campaigns.map(c => {
                  const acc = accounts.find(a => a.id === c.account_id)
                  const code = acc && c.campaign_marker ? codeFor(campProd[c.id], acc, c.campaign_marker) : null
                  const isDup = code != null && dupCodes.has(code)
                  return (
                  <TableRow key={c.id} className={`${c.active ? '' : 'opacity-50'} ${isDup ? 'bg-rose-500/10' : ''} ${editCampId === c.id ? 'bg-violet-500/5' : ''}`}>
                    <TableCell>{editCampId === c.id
                      ? <Input value={c.campaign_name} onChange={e => setCamp(c.id, { campaign_name: e.target.value })} className="h-8 w-48 text-xs" />
                      : <span className="text-xs font-medium">{c.campaign_name}</span>}</TableCell>
                    <TableCell>{editCampId === c.id ? (
                      <Select value={c.account_id ? String(c.account_id) : 'none'} onValueChange={v => setCamp(c.id, { account_id: (!v || v === 'none') ? null : Number(v) })}>
                        <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="—">{acc ? `${platLabel(acc.platform)} · ${acc.account_code}` : '—'}</SelectValue></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">— belum —</SelectItem>
                          {accounts.filter(a => a.active).map(a => <SelectItem key={a.id} value={String(a.id)}>{platLabel(a.platform)} · {a.account_code}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : <span className="text-xs">{acc ? `${platLabel(acc.platform)} · ${acc.account_code}` : '—'}</span>}</TableCell>
                    <TableCell>{editCampId === c.id
                      ? <Input value={c.campaign_marker ?? ''} onChange={e => setCamp(c.id, { campaign_marker: e.target.value })} placeholder="1" className="h-8 w-16 text-xs" />
                      : <span className="text-xs font-mono">{c.campaign_marker ?? '—'}</span>}</TableCell>
                    <TableCell>{code ? <span className="font-mono text-xs bg-violet-500/10 text-violet-600 px-1.5 py-0.5 rounded">{code}</span> : <span className="text-[10px] text-muted-foreground">akun+marker dulu</span>}{isDup && <Badge variant="outline" className="ml-1 bg-rose-500/15 text-rose-600 text-[9px] border-rose-500/30">DOBEL</Badge>}</TableCell>
                    <TableCell><Badge variant="outline" className={c.active ? 'bg-emerald-500/10 text-emerald-600 text-[10px]' : 'bg-zinc-500/10 text-zinc-500 text-[10px]'}>{c.active ? 'Aktif' : 'Nonaktif'}</Badge></TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {editCampId === c.id ? (
                        <>
                          <Button size="sm" variant="outline" className="h-8 gap-1 text-xs text-emerald-600" onClick={async () => { await saveCampaign(c); setEditCampId(null) }} disabled={savingCamp === c.id} title="Simpan">{savingCamp === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Simpan</Button>
                          <Button size="sm" variant="ghost" className="h-8 text-xs ml-1" onClick={() => { setEditCampId(null); load() }}>Batal</Button>
                        </>
                      ) : (
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<Button size="sm" variant="outline" className="h-8 gap-1 text-xs" disabled={savingCamp === c.id}>Kelola <ChevronDown className="w-3 h-3" /></Button>} />
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setEditCampId(c.id)}><Pencil className="w-3.5 h-3.5 mr-2" /> Edit</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => toggleCampaign(c)}><Power className="w-3.5 h-3.5 mr-2" /> {c.active ? 'Nonaktifkan' : 'Aktifkan'}</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => deleteCampaignRow(c)} className="text-red-500"><Trash2 className="w-3.5 h-3.5 mr-2" /> Hapus</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                )})}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
