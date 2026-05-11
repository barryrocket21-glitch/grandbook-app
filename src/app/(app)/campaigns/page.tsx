'use client'
import { useState, useEffect, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
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
import {
  Plus, Pencil, Loader2, Megaphone, Trash2, Search, Link2, Power,
} from 'lucide-react'
import { formatRupiah } from '@/lib/format'
import type { AdPlatform, CampaignStatus, Product, Profile } from '@/lib/types'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import {
  listCampaigns, insertCampaign, updateCampaign, deleteCampaign,
  insertCampaignProduct, updateCampaignProduct, deleteCampaignProduct,
  type CampaignWithRelations, type CampaignProductWithProduct,
} from '@/lib/supabase/queries/campaigns'
import { listProducts } from '@/lib/supabase/queries/products'
import {
  CAMPAIGN_PLATFORMS, CAMPAIGN_PLATFORM_LABEL, CAMPAIGN_PLATFORM_COLOR,
  CAMPAIGN_STATUSES, CAMPAIGN_STATUS_LABEL, CAMPAIGN_STATUS_COLOR,
  CAMPAIGN_OBJECTIVES, CAMPAIGN_OBJECTIVE_LABEL,
} from '@/lib/schemas/settings'

const supabase = createClient()

interface CampaignForm {
  campaign_name: string
  campaign_code: string
  platform: AdPlatform
  advertiser_id: string
  status: CampaignStatus
  start_date: string
  end_date: string
  daily_budget: number
  objective: string
  notes: string
  active: boolean
}

const emptyForm: CampaignForm = {
  campaign_name: '', campaign_code: '', platform: 'META', advertiser_id: '',
  status: 'ACTIVE', start_date: '', end_date: '',
  daily_budget: 0, objective: '', notes: '', active: true,
}

export default function CampaignsPage() {
  const { role } = useAuth()
  const isOwner = role === 'owner'
  const canWrite = role === 'owner' || role === 'admin' || role === 'advertiser'

  const [campaigns, setCampaigns] = useState<CampaignWithRelations[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [advertisers, setAdvertisers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)

  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState<CampaignForm>(emptyForm)

  // Linked products dialog state
  const [linkedOpen, setLinkedOpen] = useState(false)
  const [linkedCampaignId, setLinkedCampaignId] = useState<number | null>(null)
  const [allocOpen, setAllocOpen] = useState(false)
  const [allocEdit, setAllocEdit] = useState<CampaignProductWithProduct | null>(null)
  const [allocForm, setAllocForm] = useState({ product_id: 0, allocation_pct: 100, notes: '' })

  const [search, setSearch] = useState('')
  const [platformFilter, setPlatformFilter] = useState<'ALL' | AdPlatform>('ALL')
  const [statusFilter, setStatusFilter] = useState<'ALL' | CampaignStatus>('ALL')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [c, p, advs] = await Promise.all([
        listCampaigns(supabase),
        listProducts(supabase),
        supabase.from('profiles').select('id, full_name, role').eq('role', 'advertiser')
          .then(r => (r.data || []) as Profile[]),
      ])
      setCampaigns(c)
      setProducts(p)
      setAdvertisers(advs)
    } catch (err) {
      toast.error('Gagal load campaigns', { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const reset = () => { setForm(emptyForm); setEditId(null) }

  const handleEdit = (c: CampaignWithRelations) => {
    setForm({
      campaign_name: c.campaign_name,
      campaign_code: c.campaign_code ?? '',
      platform: c.platform,
      advertiser_id: c.advertiser_id ?? '',
      status: c.status ?? 'ACTIVE',
      start_date: c.start_date ?? '',
      end_date: c.end_date ?? '',
      daily_budget: c.daily_budget ?? 0,
      objective: c.objective ?? '',
      notes: c.notes ?? '',
      active: c.active,
    })
    setEditId(c.id)
    setOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.campaign_name.trim()) return toast.error('Nama campaign wajib diisi')
    setSaving(true)
    try {
      const payload = {
        campaign_name: form.campaign_name.trim(),
        campaign_code: form.campaign_code.trim() || null,
        platform: form.platform,
        advertiser_id: form.advertiser_id || null,
        status: form.status,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        daily_budget: form.daily_budget > 0 ? form.daily_budget : null,
        objective: form.objective || null,
        notes: form.notes.trim() || null,
        active: form.active,
      }
      if (editId) {
        await updateCampaign(supabase, editId, payload)
        toast.success('Campaign diupdate')
      } else {
        await insertCampaign(supabase, 1, payload)
        toast.success('Campaign ditambahkan')
      }
      setOpen(false)
      reset()
      void load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error('Gagal simpan', { description: msg.includes('duplicate') ? 'Nama campaign sudah dipakai per platform.' : msg })
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (c: CampaignWithRelations) => {
    try {
      await updateCampaign(supabase, c.id, { active: !c.active })
      toast.success(!c.active ? `${c.campaign_name} diaktifkan` : `${c.campaign_name} dinonaktifkan`)
      void load()
    } catch (err) {
      toast.error('Gagal toggle', { description: err instanceof Error ? err.message : String(err) })
    }
  }

  const handleDelete = async (c: CampaignWithRelations) => {
    const linked = (c.linked_products || []).length
    let msg = `Hapus campaign "${c.campaign_name}"?`
    if (linked > 0) {
      msg = `⚠️ Campaign "${c.campaign_name}" punya ${linked} linked products + ad_spend history yang akan IKUT TERHAPUS (CASCADE). Lanjut?`
    }
    if (!confirm(msg)) return
    try {
      await deleteCampaign(supabase, c.id)
      toast.success('Campaign dihapus')
      void load()
    } catch (err) {
      toast.error('Gagal hapus', { description: err instanceof Error ? err.message : String(err) })
    }
  }

  const filtered = useMemo(() => {
    let list = campaigns
    if (platformFilter !== 'ALL') list = list.filter(c => c.platform === platformFilter)
    if (statusFilter !== 'ALL') list = list.filter(c => c.status === statusFilter)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(c =>
        c.campaign_name.toLowerCase().includes(q) ||
        (c.campaign_code || '').toLowerCase().includes(q) ||
        (c.advertiser?.full_name || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [campaigns, search, platformFilter, statusFilter])

  const currentLinkedCampaign = useMemo(() => {
    return campaigns.find(c => c.id === linkedCampaignId)
  }, [campaigns, linkedCampaignId])

  const advertiserOptions = useMemo(
    () => advertisers.map(a => ({ value: a.id, label: a.full_name })),
    [advertisers]
  )

  const productOptions = useMemo(() => {
    const linkedIds = new Set(
      (currentLinkedCampaign?.linked_products || [])
        .filter(lp => !allocEdit || lp.id !== allocEdit.id)
        .map(lp => lp.product_id)
    )
    return products
      .filter(p => p.active)
      .filter(p => !linkedIds.has(p.id))
      .map(p => ({ value: String(p.id), label: p.sku ? `${p.name} (${p.sku})` : p.name }))
  }, [products, currentLinkedCampaign, allocEdit])

  const allocationTotalExclEdit = useMemo(() => {
    if (!currentLinkedCampaign) return 0
    return (currentLinkedCampaign.linked_products || [])
      .filter(lp => !allocEdit || lp.id !== allocEdit.id)
      .reduce((s, lp) => s + Number(lp.allocation_pct), 0)
  }, [currentLinkedCampaign, allocEdit])

  const resetAlloc = () => { setAllocForm({ product_id: 0, allocation_pct: 100, notes: '' }); setAllocEdit(null) }

  const openLinkedDialog = (campaignId: number) => {
    setLinkedCampaignId(campaignId)
    setLinkedOpen(true)
  }

  const openAllocDialog = (lp?: CampaignProductWithProduct) => {
    if (lp) {
      setAllocEdit(lp)
      setAllocForm({
        product_id: lp.product_id,
        allocation_pct: Number(lp.allocation_pct),
        notes: lp.notes ?? '',
      })
    } else {
      resetAlloc()
    }
    setAllocOpen(true)
  }

  const handleSubmitAlloc = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!linkedCampaignId) return
    if (!allocForm.product_id) return toast.error('Pilih produk dulu')
    if (allocForm.allocation_pct <= 0 || allocForm.allocation_pct > 100) {
      return toast.error('Allocation harus antara 0 dan 100')
    }
    const newTotal = allocationTotalExclEdit + allocForm.allocation_pct
    if (newTotal > 100) {
      return toast.error(`Total allocation akan jadi ${newTotal.toFixed(2)}% (>100%). Kurangi atau hapus produk lain.`)
    }
    try {
      if (allocEdit) {
        await updateCampaignProduct(supabase, allocEdit.id, {
          product_id: allocForm.product_id,
          allocation_pct: allocForm.allocation_pct,
          notes: allocForm.notes || null,
        })
        toast.success('Allocation diupdate')
      } else {
        await insertCampaignProduct(supabase, 1, {
          campaign_id: linkedCampaignId,
          product_id: allocForm.product_id,
          allocation_pct: allocForm.allocation_pct,
          notes: allocForm.notes || null,
        })
        toast.success('Produk ditambahkan ke campaign')
      }
      setAllocOpen(false)
      resetAlloc()
      void load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error('Gagal simpan', { description: msg.includes('22023') ? 'Total allocation > 100% (trigger guard)' : msg })
    }
  }

  const handleDeleteAlloc = async (lp: CampaignProductWithProduct) => {
    if (!confirm(`Hapus link "${lp.product?.name}" dari campaign?`)) return
    try {
      await deleteCampaignProduct(supabase, lp.id)
      toast.success('Link dihapus')
      void load()
    } catch (err) {
      toast.error('Gagal hapus', { description: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Megaphone}
        title="Campaigns"
        description={`${campaigns.length} campaign • ${campaigns.filter(c => c.status === 'ACTIVE').length} active`}
        actions={
          canWrite && (
            <Button
              onClick={() => { reset(); setOpen(true) }}
              className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/20"
            >
              <Plus className="w-4 h-4 mr-2" />Tambah Campaign
            </Button>
          )
        }
      />

      {/* Filter bar */}
      <Card>
        <CardContent className="pt-4 pb-4 flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Cari nama, code, atau advertiser..."
              className="pl-9"
            />
          </div>
          <Select value={platformFilter} onValueChange={v => v && setPlatformFilter(v as 'ALL' | AdPlatform)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent className="w-[200px]">
              <SelectItem value="ALL">Semua platform</SelectItem>
              {CAMPAIGN_PLATFORMS.map(p => (
                <SelectItem key={p} value={p}>{CAMPAIGN_PLATFORM_LABEL[p]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={v => v && setStatusFilter(v as 'ALL' | CampaignStatus)}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent className="w-[180px]">
              <SelectItem value="ALL">Semua status</SelectItem>
              {CAMPAIGN_STATUSES.map(s => (
                <SelectItem key={s} value={s}>{CAMPAIGN_STATUS_LABEL[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campaign</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead>Advertiser</TableHead>
                <TableHead>Linked Products</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-right">Budget/Day</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={7} className="py-3">
                      <div className="h-4 bg-muted animate-pulse rounded w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="p-0">
                    <EmptyState
                      icon={Megaphone}
                      title={campaigns.length === 0 ? 'Belum ada campaign' : 'Tidak ada campaign yang cocok'}
                      description={campaigns.length === 0
                        ? 'Tambah campaign untuk mulai track ad spend + ROAS.'
                        : 'Coba ubah filter atau search.'}
                    />
                  </TableCell>
                </TableRow>
              ) : filtered.map(c => {
                const totalAlloc = (c.linked_products || []).reduce((s, lp) => s + Number(lp.allocation_pct), 0)
                return (
                  <TableRow key={c.id} className={!c.active ? 'opacity-60' : ''}>
                    <TableCell className="font-medium">
                      <div>{c.campaign_name}</div>
                      {c.campaign_code && (
                        <div className="text-[10px] text-muted-foreground font-mono">{c.campaign_code}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs ${CAMPAIGN_PLATFORM_COLOR[c.platform]}`}>
                        {CAMPAIGN_PLATFORM_LABEL[c.platform]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {c.advertiser?.full_name || <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => openLinkedDialog(c.id)}
                        className="text-left hover:bg-muted/50 px-2 py-1 rounded transition-colors"
                        disabled={!canWrite}
                      >
                        {(c.linked_products || []).length === 0 ? (
                          <span className="text-xs text-muted-foreground italic">no products linked</span>
                        ) : (
                          <div>
                            <div className="text-xs">
                              {(c.linked_products || []).slice(0, 2).map(lp => lp.product?.name).join(', ')}
                              {(c.linked_products || []).length > 2 && ` +${(c.linked_products || []).length - 2}`}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              total alloc: {totalAlloc.toFixed(1)}%
                            </div>
                          </div>
                        )}
                      </button>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={`text-xs ${CAMPAIGN_STATUS_COLOR[c.status || 'ACTIVE']}`}>
                        {CAMPAIGN_STATUS_LABEL[c.status || 'ACTIVE']}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {c.daily_budget ? formatRupiah(c.daily_budget) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {canWrite && (
                          <>
                            <Button variant="ghost" size="icon" title="Manage Products" onClick={() => openLinkedDialog(c.id)}>
                              <Link2 className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="icon" title="Edit" onClick={() => handleEdit(c)}>
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost" size="icon"
                              title={c.active ? 'Nonaktifkan' : 'Aktifkan'}
                              onClick={() => toggleActive(c)}
                              className={c.active ? '' : 'text-emerald-500'}
                            >
                              <Power className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                        {isOwner && (
                          <Button variant="ghost" size="icon" title="Hapus" onClick={() => handleDelete(c)} className="text-red-500">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add/Edit Campaign Dialog */}
      <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) reset() }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editId ? 'Edit' : 'Tambah'} Campaign</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Nama Campaign *</Label>
              <Input
                value={form.campaign_name}
                onChange={e => setForm({ ...form, campaign_name: e.target.value })}
                placeholder="e.g. 1-5 Nature Gemuk Badan ABO-BID"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Campaign Code</Label>
                <Input
                  value={form.campaign_code}
                  onChange={e => setForm({ ...form, campaign_code: e.target.value })}
                  placeholder="Meta Campaign ID (untuk CSV match)"
                />
              </div>
              <div className="space-y-2">
                <Label>Platform *</Label>
                <Select value={form.platform} onValueChange={v => v && setForm({ ...form, platform: v as AdPlatform })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CAMPAIGN_PLATFORMS.map(p => (
                      <SelectItem key={p} value={p}>{CAMPAIGN_PLATFORM_LABEL[p]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Advertiser</Label>
              <Combobox
                value={form.advertiser_id}
                onChange={v => setForm({ ...form, advertiser_id: v })}
                options={advertiserOptions}
                placeholder="Pilih advertiser (opsional)"
                searchPlaceholder="Cari nama..."
                emptyHint={{
                  message: 'Belum ada user dengan role advertiser.',
                  actionLabel: 'Tambah user dulu',
                  actionHref: '/settings/users',
                }}
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={v => v && setForm({ ...form, status: v as CampaignStatus })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CAMPAIGN_STATUSES.map(s => (
                      <SelectItem key={s} value={s}>{CAMPAIGN_STATUS_LABEL[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>End Date</Label>
                <Input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Daily Budget (Rp)</Label>
                <Input
                  type="number"
                  value={form.daily_budget}
                  onChange={e => setForm({ ...form, daily_budget: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label>Objective</Label>
                <Select value={form.objective || 'NONE'} onValueChange={v => setForm({ ...form, objective: !v || v === 'NONE' ? '' : v })}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">(tidak ditentukan)</SelectItem>
                    {CAMPAIGN_OBJECTIVES.map(o => (
                      <SelectItem key={o} value={o}>{CAMPAIGN_OBJECTIVE_LABEL[o]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Catatan</Label>
              <Textarea
                value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
                placeholder="opsional"
                rows={2}
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="campaign-active"
                checked={form.active}
                onCheckedChange={v => setForm({ ...form, active: v === true })}
              />
              <Label htmlFor="campaign-active" className="cursor-pointer">Aktif (muncul di Combobox saat input spend)</Label>
            </div>
            <Button
              type="submit"
              className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/20"
              disabled={saving}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Simpan
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Linked Products Dialog */}
      <Dialog open={linkedOpen} onOpenChange={v => { setLinkedOpen(v); if (!v) setLinkedCampaignId(null) }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Linked Products — {currentLinkedCampaign?.campaign_name}
            </DialogTitle>
          </DialogHeader>
          {currentLinkedCampaign && (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                Total allocation:{' '}
                <span className="font-semibold">
                  {(currentLinkedCampaign.linked_products || []).reduce((s, lp) => s + Number(lp.allocation_pct), 0).toFixed(2)}%
                </span>
                {' '}/ 100%
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produk</TableHead>
                    <TableHead className="text-right">Allocation %</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(currentLinkedCampaign.linked_products || []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-6 text-sm text-muted-foreground">
                        Belum ada produk di-link.
                      </TableCell>
                    </TableRow>
                  ) : (currentLinkedCampaign.linked_products || []).map(lp => (
                    <TableRow key={lp.id}>
                      <TableCell className="text-sm">
                        {lp.product?.name || `#${lp.product_id}`}
                        {lp.product?.sku && <span className="text-[10px] text-muted-foreground font-mono ml-2">({lp.product.sku})</span>}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {Number(lp.allocation_pct).toFixed(2)}%
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{lp.notes || '—'}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {canWrite && (
                            <>
                              <Button variant="ghost" size="icon" onClick={() => openAllocDialog(lp)}>
                                <Pencil className="w-4 h-4" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => handleDeleteAlloc(lp)} className="text-red-500">
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {canWrite && (
                <Button onClick={() => openAllocDialog()} className="w-full">
                  <Plus className="w-4 h-4 mr-2" />Tambah Produk ke Campaign
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Allocation Dialog (add/edit linked product) */}
      <Dialog open={allocOpen} onOpenChange={v => { setAllocOpen(v); if (!v) resetAlloc() }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{allocEdit ? 'Edit' : 'Tambah'} Linked Product</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmitAlloc} className="space-y-4">
            <div className="space-y-2">
              <Label>Produk *</Label>
              <Combobox
                value={allocForm.product_id ? String(allocForm.product_id) : ''}
                onChange={v => setAllocForm({ ...allocForm, product_id: v ? Number(v) : 0 })}
                options={productOptions}
                placeholder="Pilih produk"
                emptyHint={{
                  message: 'Semua produk aktif sudah di-link, atau belum ada produk.',
                  actionLabel: 'Buka /products',
                  actionHref: '/products',
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>Allocation % *</Label>
              <Input
                type="number"
                step="0.01"
                value={allocForm.allocation_pct}
                onChange={e => setAllocForm({ ...allocForm, allocation_pct: Number(e.target.value) })}
                required
              />
              <p className="text-[10px] text-muted-foreground">
                Sudah teralokasi (di luar item ini): {allocationTotalExclEdit.toFixed(2)}%.
                Sisa budget: {(100 - allocationTotalExclEdit).toFixed(2)}%.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={allocForm.notes}
                onChange={e => setAllocForm({ ...allocForm, notes: e.target.value })}
                placeholder="opsional"
                rows={2}
              />
            </div>
            <Button type="submit" className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white">
              Simpan
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
