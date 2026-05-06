'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { Plus, Pencil, Loader2, Megaphone } from 'lucide-react'
import { AD_PLATFORMS } from '@/lib/constants'
import type { Campaign, Profile } from '@/lib/types'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'

const supabase = createClient()

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<(Campaign & { advertiser?: Profile })[]>([])
  const [advertisers, setAdvertisers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState({ campaign_name: '', platform: 'META' as string | null, advertiser_id: '' as string | null })

  const fetch = async () => {
    setLoading(true)
    const [{ data: c }, { data: a }] = await Promise.all([
      supabase.from('campaigns').select('*, advertiser:profiles!advertiser_id(*)').order('campaign_name'),
      supabase.from('profiles').select('*').eq('role', 'advertiser').eq('active', true),
    ])
    setCampaigns(c || [])
    setAdvertisers(a || [])
    setLoading(false)
  }
  useEffect(() => { fetch() }, [])

  const reset = () => { setForm({ campaign_name: '', platform: 'META', advertiser_id: '' }); setEditId(null) }
  const handleEdit = (c: Campaign) => {
    setForm({ campaign_name: c.campaign_name, platform: c.platform, advertiser_id: c.advertiser_id || '' })
    setEditId(c.id); setOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.campaign_name) return toast.error('Nama campaign wajib diisi')
    setSaving(true)
    try {
      const payload = { campaign_name: form.campaign_name, platform: form.platform, advertiser_id: form.advertiser_id || null }
      if (editId) {
        const { error } = await supabase.from('campaigns').update(payload).eq('id', editId)
        if (error) throw error
        toast.success('Campaign diupdate')
      } else {
        const { error } = await supabase.from('campaigns').insert(payload)
        if (error) throw error
        toast.success('Campaign ditambahkan')
      }
      setOpen(false); reset(); fetch()
    } catch (err: any) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  const platformColor: Record<string, string> = {
    META: 'bg-blue-500/15 text-blue-600', GOOGLE: 'bg-red-500/15 text-red-600',
    TIKTOK: 'bg-pink-500/15 text-pink-600', SNACK: 'bg-orange-500/15 text-orange-600',
    OTHER: 'bg-zinc-500/15 text-zinc-600',
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Megaphone}
        title="Campaigns"
        description={`${campaigns.length} campaign terdaftar`}
        actions={
          <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) reset() }}>
            <DialogTrigger render={<Button className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/20" />}><Plus className="w-4 h-4 mr-2" />Tambah Campaign</DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editId ? 'Edit' : 'Tambah'} Campaign</DialogTitle></DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2"><Label>Nama Campaign *</Label><Input value={form.campaign_name} onChange={e => setForm({ ...form, campaign_name: e.target.value })} required /></div>
                <div className="space-y-2"><Label>Platform</Label><Select value={form.platform} onValueChange={v => setForm({ ...form, platform: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent className="w-[240px]">{AD_PLATFORMS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-2"><Label>Advertiser</Label><Select value={form.advertiser_id} onValueChange={v => setForm({ ...form, advertiser_id: v })}><SelectTrigger><SelectValue placeholder="Pilih advertiser">{(value: string) => advertisers.find(a => a.id === value)?.full_name ?? 'Pilih advertiser'}</SelectValue></SelectTrigger><SelectContent className="w-[260px]">{advertisers.length === 0 ? <div className="px-2 py-1.5 text-xs text-muted-foreground">Belum ada advertiser</div> : advertisers.map(a => <SelectItem key={a.id} value={a.id}>{a.full_name}</SelectItem>)}</SelectContent></Select></div>
                <Button type="submit" className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/20" disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Simpan</Button>
              </form>
            </DialogContent>
          </Dialog>
        }
      />
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Campaign</TableHead><TableHead>Platform</TableHead><TableHead>Advertiser</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {campaigns.map(c => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.campaign_name}</TableCell>
                  <TableCell><Badge variant="outline" className={platformColor[c.platform] || ''}>{c.platform}</Badge></TableCell>
                  <TableCell>{(c as any).advertiser?.full_name || '-'}</TableCell>
                  <TableCell><Badge variant="outline" className={c.active ? 'bg-emerald-500/10 text-emerald-600' : 'bg-zinc-500/10'}>{c.active ? 'Active' : 'Inactive'}</Badge></TableCell>
                  <TableCell><Button variant="ghost" size="icon" onClick={() => handleEdit(c)}><Pencil className="w-4 h-4" /></Button></TableCell>
                </TableRow>
              ))}
              {!loading && campaigns.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="p-0">
                    <EmptyState icon={Megaphone} title="Belum ada campaign" description="Tambah campaign untuk mulai tracking ads spend dan order yang masuk dari setiap channel." />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
