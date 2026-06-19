'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Megaphone, Loader2, Plus, Save, Wand2, Pencil, Trash2, Power, X, Check, ChevronRight, ChevronDown } from 'lucide-react'
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
  // Layout nested: akun bisa di-expand, campaign nested di dalamnya
  const [showAddAcc, setShowAddAcc] = useState(false)
  const [expandedAcc, setExpandedAcc] = useState<number | null>(null)
  const [addCampAcc, setAddCampAcc] = useState<number | null>(null)

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
          <div className="flex gap-2">
            <Button size="sm" variant={showAddAcc ? 'default' : 'outline'} onClick={() => setShowAddAcc(v => !v)} className="gap-1.5"><Plus className="w-3.5 h-3.5" /> Tambah Akun</Button>
            <Button size="sm" onClick={resolve} disabled={resolving} className="gap-1.5 bg-zinc-600 hover:bg-zinc-700 text-white">
              {resolving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />} Resolve Atribusi
            </Button>
          </div>
        } />

      {/* Tambah Akun (toggle) */}
      {showAddAcc && (
      <Card>
        <CardContent className="pt-4 pb-4 space-y-3">
          <div className="text-sm font-semibold">Tambah Akun Iklan</div>
          <p className="text-[11px] text-muted-foreground"><b>Kode Akun</b> = huruf identitas akun di kode atribusi (mis. <b>A</b> di <span className="font-mono">Luna F.<b>A</b>.1</span>), unik per platform. <b>Nama</b> = label bebas. Campaign-nya dibuat nanti dari dalam akun ini (tombol + Campaign).</p>
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
          <p className="text-[10px] text-muted-foreground">Kode Akun = huruf di kode atribusi (mis. A di Luna F.A.1). 1 akun unik per platform. Nama = label bebas.</p>
        </CardContent>
      </Card>
      )}

      {dupCodes.size > 0 && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs space-y-1">
          <div className="font-semibold text-red-600 flex items-center gap-1.5"><X className="w-3.5 h-3.5" /> {dupCodes.size} kode campaign DOBEL terdeteksi</div>
          <div className="text-red-700/80">Kode atribusi sama (produk+platform+akun+marker) → resolusi order bisa ketuker. Ganti marker / hapus salah satu:</div>
          <div className="flex flex-wrap gap-1.5">
            {[...dupCodes.entries()].map(([code, ids]) => (
              <span key={code} className="font-mono bg-red-500/15 text-red-700 px-1.5 py-0.5 rounded">{code} <b>×{ids.length}</b></span>
            ))}
          </div>
        </div>
      )}

      {/* Nested: akun -> campaign di dalamnya */}
      {loading ? <Card><CardContent className="py-10 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></CardContent></Card>
      : accounts.length === 0 ? <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Belum ada akun. Klik &quot;Tambah Akun&quot; di atas.</CardContent></Card>
      : (
        <div className="space-y-2">
          {accounts.map(a => {
            const camps = campaigns.filter(c => c.account_id === a.id)
            const open = expandedAcc === a.id
            const editing = editAccId === a.id
            return (
              <Card key={a.id} className={`overflow-hidden ${a.active ? '' : 'opacity-60'}`}>
                {editing ? (
                  <div className="flex flex-wrap items-end gap-2 p-3 bg-zinc-500/5">
                    <div className="space-y-0.5"><Label className="text-[9px]">Platform</Label>
                      <Select value={eaf.platform} onValueChange={v => v && setEaf({ ...eaf, platform: v })}>
                        <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>{PLATFORMS.map(p => <SelectItem key={p} value={p}>{platLabel(p)}</SelectItem>)}</SelectContent>
                      </Select></div>
                    <div className="space-y-0.5"><Label className="text-[9px]">Kode</Label><Input value={eaf.account_code} onChange={e => setEaf({ ...eaf, account_code: e.target.value })} className="h-8 w-16 text-xs font-mono" /></div>
                    <div className="space-y-0.5 flex-1 min-w-[120px]"><Label className="text-[9px]">Nama</Label><Input value={eaf.name} onChange={e => setEaf({ ...eaf, name: e.target.value })} className="h-8 text-xs" /></div>
                    <div className="space-y-0.5"><Label className="text-[9px]">Advertiser</Label>
                      <Select value={eaf.advertiser_id || 'none'} onValueChange={v => setEaf({ ...eaf, advertiser_id: (!v || v === 'none') ? '' : v })}>
                        <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="—">{eaf.advertiser_id ? advName(eaf.advertiser_id) : '—'}</SelectValue></SelectTrigger>
                        <SelectContent><SelectItem value="none">— belum —</SelectItem>{advs.map(x => <SelectItem key={x.id} value={x.id}>{x.full_name || x.id.slice(0, 8)}</SelectItem>)}</SelectContent>
                      </Select></div>
                    <Button size="sm" className="h-8 gap-1 text-xs text-emerald-600" variant="outline" disabled={accBusy} onClick={saveEditAcc}><Check className="w-3.5 h-3.5" /> Simpan</Button>
                    <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setEditAccId(null)}>Batal</Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2.5 p-3 cursor-pointer hover:bg-muted/30" onClick={() => setExpandedAcc(open ? null : a.id)}>
                    {open ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />}
                    <Badge variant="outline" className="font-mono text-[10px] shrink-0">{platLabel(a.platform)}</Badge>
                    <span className="font-mono text-sm font-semibold shrink-0">{a.account_code}</span>
                    <span className="text-sm truncate">{a.name || '—'}</span>
                    <span className="text-xs text-muted-foreground truncate hidden sm:inline">· {advName(a.advertiser_id)}</span>
                    <Badge variant="outline" className="text-[10px] shrink-0">{camps.length} campaign</Badge>
                    {!a.active && <Badge variant="outline" className="bg-zinc-500/10 text-zinc-500 text-[10px] shrink-0">Nonaktif</Badge>}
                    <div className="ml-auto flex items-center gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
                      <Button size="icon" variant="ghost" className="h-8 w-8" disabled={accBusy} onClick={() => startEditAcc(a)} title="Edit akun"><Pencil className="w-3.5 h-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" disabled={accBusy} onClick={() => toggleAcc(a)} title={a.active ? 'Nonaktifkan' : 'Aktifkan'}><Power className={`w-3.5 h-3.5 ${a.active ? 'text-amber-600' : 'text-emerald-600'}`} /></Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500" disabled={accBusy} onClick={() => deleteAcc(a)} title="Hapus akun"><Trash2 className="w-3.5 h-3.5" /></Button>
                    </div>
                  </div>
                )}
                {open && !editing && (
                  <div className="border-t bg-muted/10 px-3 py-2 space-y-1">
                    {camps.length === 0 && addCampAcc !== a.id && <p className="text-[11px] text-muted-foreground py-1">Belum ada campaign di akun ini. Klik + Campaign.</p>}
                    {camps.map(c => {
                      const code = c.campaign_marker ? codeFor(campProd[c.id], a, c.campaign_marker) : null
                      const isDup = code != null && dupCodes.has(code)
                      const ce = editCampId === c.id
                      return (
                        <div key={c.id} className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${isDup ? 'bg-red-500/10' : 'bg-card'} ${c.active ? '' : 'opacity-50'}`}>
                          {ce ? (
                            <>
                              <Input value={c.campaign_name} onChange={e => setCamp(c.id, { campaign_name: e.target.value })} className="h-8 flex-1 text-xs" placeholder="nama campaign" />
                              <Input value={c.campaign_marker ?? ''} onChange={e => setCamp(c.id, { campaign_marker: e.target.value })} className="h-8 w-14 text-xs font-mono" placeholder="mkr" />
                              <Button size="sm" variant="outline" className="h-8 gap-1 text-xs text-emerald-600" onClick={async () => { await saveCampaign(c); setEditCampId(null) }} disabled={savingCamp === c.id}>{savingCamp === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}</Button>
                              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { setEditCampId(null); load() }}>Batal</Button>
                            </>
                          ) : (
                            <>
                              <span className="text-xs flex-1 truncate font-medium">{c.campaign_name}</span>
                              {code ? <span className="font-mono text-[11px] bg-zinc-500/10 text-zinc-600 px-1.5 py-0.5 rounded shrink-0">{code}</span> : <span className="text-[10px] text-muted-foreground shrink-0">marker dulu</span>}
                              {isDup && <Badge variant="outline" className="bg-red-500/15 text-red-600 text-[9px] border-red-500/30 shrink-0">DOBEL</Badge>}
                              <Badge variant="outline" className={`text-[9px] shrink-0 ${c.active ? 'bg-emerald-500/10 text-emerald-600' : 'bg-zinc-500/10 text-zinc-500'}`}>{c.active ? 'Aktif' : 'Off'}</Badge>
                              <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => setEditCampId(c.id)} title="Edit" disabled={savingCamp === c.id}><Pencil className="w-3 h-3" /></Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => toggleCampaign(c)} title={c.active ? 'Nonaktifkan' : 'Aktifkan'} disabled={savingCamp === c.id}><Power className={`w-3 h-3 ${c.active ? 'text-amber-600' : 'text-emerald-600'}`} /></Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 shrink-0" onClick={() => deleteCampaignRow(c)} title="Hapus" disabled={savingCamp === c.id}><Trash2 className="w-3 h-3" /></Button>
                            </>
                          )}
                        </div>
                      )
                    })}
                    {addCampAcc === a.id ? (
                      <div className="flex flex-wrap items-end gap-2 rounded-md border border-zinc-500/30 bg-zinc-500/5 p-2 mt-1">
                        <div className="space-y-0.5"><Label className="text-[9px]">Produk *</Label>
                          <Select value={ncf.product_id || 'none'} onValueChange={v => { const pid = (!v || v === 'none') ? '' : v; setNcf({ ...ncf, account_id: String(a.id), product_id: pid, marker: pid ? nextMarker(a.id, Number(pid)) : ncf.marker }) }}>
                            <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="pilih produk">{(() => { const pp = products.find(x => String(x.id) === ncf.product_id); return pp ? pp.name : 'pilih produk' })()}</SelectValue></SelectTrigger>
                            <SelectContent><SelectItem value="none">— produk —</SelectItem>{products.map(pp => <SelectItem key={pp.id} value={String(pp.id)}>{pp.name}</SelectItem>)}</SelectContent>
                          </Select></div>
                        <div className="space-y-0.5"><Label className="text-[9px]">Marker</Label><Input value={ncf.marker} onChange={e => setNcf({ ...ncf, marker: e.target.value })} placeholder="1" className="h-8 w-14 text-xs font-mono" /></div>
                        <div className="space-y-0.5 flex-1 min-w-[120px]"><Label className="text-[9px]">Nama (opsional)</Label><Input value={ncf.name} onChange={e => setNcf({ ...ncf, name: e.target.value })} placeholder="auto: produk + kode" className="h-8 text-xs" /></div>
                        <Button size="sm" className="h-8 gap-1 text-xs" disabled={savingNew} onClick={async () => { await createCampaign(); setAddCampAcc(null) }}>{savingNew ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Buat</Button>
                        <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setAddCampAcc(null)}>Batal</Button>
                        {(() => { const pp = products.find(x => String(x.id) === ncf.product_id); if (ncf.marker.trim()) return <span className="text-[10px] w-full">Kode: <span className="font-mono bg-zinc-500/10 text-zinc-600 px-1 rounded">{codeFor(pp?.name, a, ncf.marker.trim())}</span></span>; return null })()}
                      </div>
                    ) : (
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-zinc-600 gap-1" onClick={() => { setNcf({ account_id: String(a.id), marker: '', product_id: '', name: '' }); setAddCampAcc(a.id) }}><Plus className="w-3.5 h-3.5" /> Campaign</Button>
                    )}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">Klik baris akun buat buka/tutup campaign-nya. Kode atribusi CS: <b>Produk Platform.Akun.Marker</b> (META=F · GOOGLE=G · SNACK=S · TIKTOK=T). <a href="/campaigns" className="text-zinc-500 hover:underline">Advanced campaign →</a></p>
    </div>
  )
}
