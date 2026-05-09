'use client'
import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { toast } from 'sonner'
import {
  Plus, Pencil, Loader2, Power, Search, Filter, Wrench,
  ArrowRight, FileSpreadsheet,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { PermissionGuard } from '@/components/settings/permission-guard'
import { canManageSettings } from '@/lib/auth/permissions'
import {
  converterProfileSchema,
  CONVERTER_DIRECTIONS,
  CONVERTER_FILE_FORMATS,
  CONVERTER_PRIMARY_KEY_TARGETS,
  DIRECTION_BADGE_COLOR,
  DIRECTION_LABEL,
  type ConverterDirectionEnum,
  type ConverterFileFormatEnum,
} from '@/lib/schemas/settings'

const supabase = createClient()

interface Channel { id: number; code: string; name: string; active: boolean }

interface Profile {
  id: number
  code: string
  name: string
  direction: ConverterDirectionEnum
  source_or_target: string
  channel_id: number | null
  primary_key_field: string | null
  primary_key_target: string | null
  file_format: ConverterFileFormatEnum
  file_delimiter: string | null
  file_encoding: string
  has_header_row: boolean
  header_row_index: number
  regex_pattern: string | null
  notes: string | null
  active: boolean
  channel?: Channel
  field_count?: number
  value_count?: number
}

const initialForm = {
  code: '',
  name: '',
  direction: 'INBOUND_ORDER' as ConverterDirectionEnum,
  source_or_target: '',
  channel_id: '',
  primary_key_field: '',
  primary_key_target: '',
  file_format: 'CSV' as ConverterFileFormatEnum,
  file_delimiter: ',',
  file_encoding: 'utf-8',
  has_header_row: true,
  header_row_index: 1,
  regex_pattern: '',
  notes: '',
  active: true,
}

export default function ConverterProfilesPage() {
  const router = useRouter()
  const { role } = useAuth()
  const canManage = canManageSettings(role)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState(initialForm)
  const [search, setSearch] = useState('')
  const [directionFilter, setDirectionFilter] = useState<'ALL' | ConverterDirectionEnum>('ALL')
  const [channelFilter, setChannelFilter] = useState('ALL')
  const [showInactive, setShowInactive] = useState(false)

  const load = async () => {
    setLoading(true)
    const [{ data: ps }, { data: chs }, { data: fms }, { data: vms }] = await Promise.all([
      supabase
        .from('converter_profiles')
        .select('*, channel:courier_channels(id, code, name, active)')
        .order('code'),
      supabase.from('courier_channels').select('id, code, name, active').order('code'),
      supabase.from('converter_field_mappings').select('profile_id'),
      supabase.from('converter_value_mappings').select('profile_id'),
    ])
    const fmCount = new Map<number, number>()
    ;(fms || []).forEach((f: any) => fmCount.set(f.profile_id, (fmCount.get(f.profile_id) || 0) + 1))
    const vmCount = new Map<number, number>()
    ;(vms || []).forEach((v: any) => vmCount.set(v.profile_id, (vmCount.get(v.profile_id) || 0) + 1))
    setProfiles(
      (ps || []).map((p: any) => ({
        ...p,
        field_count: fmCount.get(p.id) || 0,
        value_count: vmCount.get(p.id) || 0,
      }))
    )
    setChannels(chs || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const reset = () => { setForm(initialForm); setEditId(null) }

  const openEdit = (p: Profile) => {
    setEditId(p.id)
    setForm({
      code: p.code,
      name: p.name,
      direction: p.direction,
      source_or_target: p.source_or_target,
      channel_id: p.channel_id ? String(p.channel_id) : '',
      primary_key_field: p.primary_key_field || '',
      primary_key_target: p.primary_key_target || '',
      file_format: p.file_format,
      file_delimiter: p.file_delimiter || '',
      file_encoding: p.file_encoding || 'utf-8',
      has_header_row: p.has_header_row,
      header_row_index: p.header_row_index,
      regex_pattern: p.regex_pattern || '',
      notes: p.notes || '',
      active: p.active,
    })
    setOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      direction: form.direction,
      source_or_target: form.source_or_target.trim(),
      channel_id: form.channel_id ? Number(form.channel_id) : null,
      primary_key_field: form.primary_key_field.trim() || null,
      primary_key_target:
        form.direction === 'OUTBOUND_TO_COURIER' ? null : (form.primary_key_target || null),
      file_format: form.file_format,
      file_delimiter:
        form.file_format === 'CSV' ? (form.file_delimiter || ',') : null,
      file_encoding: form.file_encoding || 'utf-8',
      has_header_row: form.has_header_row,
      header_row_index: form.has_header_row ? form.header_row_index : 1,
      regex_pattern:
        form.direction === 'WA_PASTE' ? (form.regex_pattern.trim() || null) : null,
      notes: form.notes.trim() || null,
      active: form.active,
    }
    const parsed = converterProfileSchema.safeParse(payload)
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Validasi gagal')
      return
    }
    setSaving(true)
    try {
      if (editId) {
        const { error } = await supabase
          .from('converter_profiles')
          .update(parsed.data)
          .eq('id', editId)
        if (error) throw error
        toast.success('Profile diupdate')
        setOpen(false)
        reset()
        load()
      } else {
        const { data, error } = await supabase
          .from('converter_profiles')
          .insert(parsed.data)
          .select('id')
          .single()
        if (error) {
          if ((error as any).code === '23505') throw new Error(`Code "${parsed.data.code}" sudah dipakai`)
          throw error
        }
        toast.success('Profile ditambahkan — buka editor untuk konfigurasi mappings')
        setOpen(false)
        reset()
        if (data?.id) router.push(`/settings/converter-profiles/${data.id}`)
        else load()
      }
    } catch (err: any) {
      toast.error('Gagal simpan', { description: err.message })
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async (p: Profile) => {
    if (!confirm(`${p.active ? 'Disable' : 'Enable'} profile "${p.name}"?`)) return
    const { error } = await supabase
      .from('converter_profiles')
      .update({ active: !p.active })
      .eq('id', p.id)
    if (error) {
      toast.error('Gagal update status', { description: error.message })
      return
    }
    toast.success(`Profile ${!p.active ? 'diaktifkan' : 'dinonaktifkan'}`)
    load()
  }

  const filtered = useMemo(() => {
    let list = profiles
    if (!showInactive) list = list.filter((p) => p.active)
    if (directionFilter !== 'ALL') list = list.filter((p) => p.direction === directionFilter)
    if (channelFilter !== 'ALL')
      list = list.filter((p) => String(p.channel_id ?? '') === channelFilter)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(
        (p) =>
          p.code.toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q) ||
          p.source_or_target.toLowerCase().includes(q)
      )
    }
    return list
  }, [profiles, directionFilter, channelFilter, search, showInactive])

  const directionFlag = {
    isWaPaste: form.direction === 'WA_PASTE',
    needsChannel:
      form.direction === 'INBOUND_REKONSIL' || form.direction === 'OUTBOUND_TO_COURIER',
    isOutbound: form.direction === 'OUTBOUND_TO_COURIER',
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Wrench}
        title="Converter Profiles"
        description="Profile untuk konversi file (CSV/XLSX/Text) → data internal Grandbook. Tiap profile punya field mapping & value mapping sendiri."
        actions={
          <PermissionGuard role={role} allowedRoles={['owner', 'admin']}>
            <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
              <DialogTrigger
                render={
                  <Button className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/20" />
                }
              >
                <Plus className="w-4 h-4 mr-2" />
                Tambah Profile
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{editId ? 'Edit' : 'Tambah'} Converter Profile</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Code *</Label>
                      <Input
                        value={form.code}
                        onChange={(e) => setForm({ ...form, code: e.target.value.toLowerCase() })}
                        placeholder="orderonline_inbound"
                        disabled={!!editId}
                        required
                      />
                      <p className="text-[10px] text-muted-foreground">lowercase + underscore, unique</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Name *</Label>
                      <Input
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        placeholder="Orderonline (Inbound)"
                        required
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Direction *</Label>
                      <Select
                        value={form.direction}
                        onValueChange={(v) =>
                          v && setForm({
                            ...form,
                            direction: v as ConverterDirectionEnum,
                            file_format: v === 'WA_PASTE' ? 'TEXT' : form.file_format,
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="w-[300px]">
                          {CONVERTER_DIRECTIONS.map((d) => (
                            <SelectItem key={d} value={d}>
                              {DIRECTION_LABEL[d]} ({d})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Source/Target *</Label>
                      <Input
                        value={form.source_or_target}
                        onChange={(e) => setForm({ ...form, source_or_target: e.target.value })}
                        placeholder="orderonline / spx / mengantar"
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">
                      Channel {directionFlag.needsChannel ? '*' : '(optional)'}
                    </Label>
                    <Select
                      value={form.channel_id || 'none'}
                      onValueChange={(v) =>
                        setForm({ ...form, channel_id: !v || v === 'none' ? '' : v })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Pilih channel">
                          {(value: string | null) =>
                            !value || value === 'none'
                              ? '— (generic)'
                              : channels.find((c) => String(c.id) === value)?.name ?? 'Pilih channel'
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent className="w-[300px]">
                        <SelectItem value="none">— (generic, tanpa channel)</SelectItem>
                        {channels.filter((c) => c.active).map((c) => (
                          <SelectItem key={c.id} value={String(c.id)}>
                            {c.code} — {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[10px] text-muted-foreground">
                      INBOUND_ORDER bisa kosong (generic). REKONSIL & OUTBOUND wajib pilih channel.
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">File Format *</Label>
                      <Select
                        value={form.file_format}
                        onValueChange={(v) =>
                          v && setForm({ ...form, file_format: v as ConverterFileFormatEnum })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="w-[200px]">
                          {CONVERTER_FILE_FORMATS.map((f) => (
                            <SelectItem key={f} value={f}>{f}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Delimiter</Label>
                      <Input
                        value={form.file_delimiter}
                        onChange={(e) => setForm({ ...form, file_delimiter: e.target.value })}
                        placeholder=","
                        disabled={form.file_format !== 'CSV'}
                        maxLength={3}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Encoding</Label>
                      <Select
                        value={form.file_encoding}
                        onValueChange={(v) => v && setForm({ ...form, file_encoding: v })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="w-[200px]">
                          <SelectItem value="utf-8">utf-8</SelectItem>
                          <SelectItem value="utf-8-sig">utf-8-sig (BOM)</SelectItem>
                          <SelectItem value="latin-1">latin-1</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex items-center gap-2 mt-6">
                      <Checkbox
                        checked={form.has_header_row}
                        onCheckedChange={(v) => setForm({ ...form, has_header_row: v === true })}
                      />
                      <span className="text-xs">Has header row</span>
                    </label>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Header Row Index</Label>
                      <Input
                        type="number"
                        min={1}
                        max={10}
                        value={form.header_row_index}
                        onChange={(e) =>
                          setForm({ ...form, header_row_index: Number(e.target.value) || 1 })
                        }
                        disabled={!form.has_header_row}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Primary Key Field</Label>
                      <Input
                        value={form.primary_key_field}
                        onChange={(e) => setForm({ ...form, primary_key_field: e.target.value })}
                        placeholder="order_id"
                        disabled={directionFlag.isOutbound}
                      />
                      <p className="text-[10px] text-muted-foreground">Nama kolom file untuk identifier</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Primary Key Target</Label>
                      <Select
                        value={form.primary_key_target || 'none'}
                        onValueChange={(v) =>
                          setForm({ ...form, primary_key_target: !v || v === 'none' ? '' : v })
                        }
                        disabled={directionFlag.isOutbound}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Pilih target">
                            {(value: string | null) =>
                              !value || value === 'none' ? '—' : value
                            }
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent className="w-[240px]">
                          <SelectItem value="none">—</SelectItem>
                          {CONVERTER_PRIMARY_KEY_TARGETS.map((t) => (
                            <SelectItem key={t} value={t}>{t}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {directionFlag.isWaPaste && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Regex Pattern *</Label>
                      <Textarea
                        value={form.regex_pattern}
                        onChange={(e) => setForm({ ...form, regex_pattern: e.target.value })}
                        rows={3}
                        placeholder="Nama:\\s*(?<customer_name>.+?)\\nNomor:\\s*(?<customer_phone>.+?)$"
                        className="font-mono text-xs"
                      />
                      <p className="text-[10px] text-muted-foreground">
                        Gunakan named groups <code>(?&lt;field&gt;...)</code>. Setiap match → 1 row.
                      </p>
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label className="text-xs">Notes</Label>
                    <Textarea
                      value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                      rows={2}
                      placeholder="Catatan untuk operator..."
                    />
                  </div>
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={form.active}
                      onCheckedChange={(v) => setForm({ ...form, active: v === true })}
                    />
                    <span className="text-xs">Aktif</span>
                  </label>
                  <Button
                    type="submit"
                    className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/20"
                    disabled={saving}
                  >
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Simpan {!editId && '& Buka Editor'}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </PermissionGuard>
        }
      />

      <Card>
        <CardContent className="pt-4 pb-4 flex flex-col sm:flex-row gap-3 flex-wrap">
          <div className="flex-1 min-w-[200px] relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari code, name, source..."
              className="pl-9"
            />
          </div>
          <Select
            value={directionFilter}
            onValueChange={(v) => v && setDirectionFilter(v as 'ALL' | ConverterDirectionEnum)}
          >
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Direction" />
            </SelectTrigger>
            <SelectContent className="w-[260px]">
              <SelectItem value="ALL">Semua direction</SelectItem>
              {CONVERTER_DIRECTIONS.map((d) => (
                <SelectItem key={d} value={d}>{DIRECTION_LABEL[d]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={channelFilter} onValueChange={(v) => v && setChannelFilter(v)}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Channel" />
            </SelectTrigger>
            <SelectContent className="w-[260px]">
              <SelectItem value="ALL">Semua channel</SelectItem>
              {channels.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.code}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 px-2">
            <Checkbox
              checked={showInactive}
              onCheckedChange={(v) => setShowInactive(v === true)}
            />
            <span className="text-xs">Tampilkan tidak aktif</span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Direction</TableHead>
                <TableHead>Source/Target</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Format</TableHead>
                <TableHead>Mappings</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={9}>
                      <div className="h-4 bg-muted animate-pulse rounded" />
                    </TableCell>
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="p-0">
                    <EmptyState
                      icon={Filter}
                      title={profiles.length === 0 ? 'Belum ada profile' : 'Tidak ada hasil'}
                      description={
                        profiles.length === 0
                          ? 'Tambah converter profile untuk konversi file inbound/outbound. Tiap profile punya field & value mapping yang fully customizable.'
                          : 'Coba ubah filter.'
                      }
                    />
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{p.code}</code>
                    </TableCell>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={DIRECTION_BADGE_COLOR[p.direction]}>
                        {DIRECTION_LABEL[p.direction]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{p.source_or_target}</TableCell>
                    <TableCell className="text-xs">
                      {p.channel ? (
                        <Badge variant="outline" className="font-mono text-[10px]">{p.channel.code}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {p.file_format}
                      {p.file_format === 'CSV' && p.file_delimiter && (
                        <span className="text-muted-foreground"> ({p.file_delimiter === ',' ? '","' : `"${p.file_delimiter}"`})</span>
                      )}
                      {p.has_header_row && p.header_row_index > 1 && (
                        <span className="text-muted-foreground"> · row {p.header_row_index}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p.field_count || 0} fields, {p.value_count || 0} values
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          p.active
                            ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
                            : 'bg-zinc-500/10 text-zinc-600 border-zinc-500/30'
                        }
                      >
                        {p.active ? 'Aktif' : 'Nonaktif'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Link
                          href={`/settings/converter-profiles/${p.id}`}
                          className={buttonVariants({ variant: 'outline', size: 'sm' })}
                        >
                          <FileSpreadsheet className="w-3.5 h-3.5 mr-1" />
                          Editor
                          <ArrowRight className="w-3 h-3 ml-1" />
                        </Link>
                        <PermissionGuard role={role} allowedRoles={['owner', 'admin']}>
                          <Button variant="ghost" size="icon" onClick={() => openEdit(p)}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleToggleActive(p)}
                            className={p.active ? 'text-orange-500' : 'text-emerald-500'}
                          >
                            <Power className="w-3.5 h-3.5" />
                          </Button>
                        </PermissionGuard>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {!canManage && (
        <Card className="border-blue-500/20 bg-blue-500/5">
          <CardContent className="pt-3 pb-3 text-xs text-muted-foreground">
            ℹ️ Mode read-only. Hanya Owner/Admin yang bisa edit converter profiles.
          </CardContent>
        </Card>
      )}
    </div>
  )
}
