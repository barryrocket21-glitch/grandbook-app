'use client'
import { useState, useEffect, useMemo, useRef } from 'react'
import { getErrorMessage } from '@/lib/errors'
import { use } from 'react'
import Link from 'next/link'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { toast } from 'sonner'
import {
  Plus, Pencil, Loader2, Trash2, ArrowLeft, ArrowUp, ArrowDown,
  Copy, Play, Upload, AlertTriangle, CheckCircle2, ArrowRight, FileText,
} from 'lucide-react'
import { PermissionGuard } from '@/components/settings/permission-guard'
import { canManageSettings } from '@/lib/auth/permissions'
import {
  fieldMappingSchema,
  valueMappingSchema,
  CONVERTER_TARGET_TABLES,
  TARGET_TABLE_BADGE_COLOR,
  DIRECTION_BADGE_COLOR,
  DIRECTION_LABEL,
  type ConverterTargetTableEnum,
} from '@/lib/schemas/settings'
import { TRANSFORMS } from '@/lib/converter/transforms'
import { previewParse, type PreviewResult } from '@/lib/converter/preview'
import type {
  ConverterProfile,
  ConverterFieldMapping,
  ConverterValueMapping,
  CourierChannel,
} from '@/lib/types'

const supabase = createClient()

type FieldForm = {
  source_field: string
  target_field: string
  target_table: ConverterTargetTableEnum
  transform: string
  required: boolean
  display_order: number
  notes: string
}
const initialFieldForm: FieldForm = {
  source_field: '',
  target_field: '',
  target_table: 'orders',
  transform: '',
  required: false,
  display_order: 0,
  notes: '',
}

type ValueForm = {
  source_field: string
  raw_value: string
  mapped_value: string
  notes: string
}
const initialValueForm: ValueForm = {
  source_field: '',
  raw_value: '',
  mapped_value: '',
  notes: '',
}

export default function ConverterProfileDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: paramId } = use(params)
  const profileId = Number(paramId)
  const { role } = useAuth()
  const canManage = canManageSettings(role)

  const [profile, setProfile] = useState<(ConverterProfile & { channel?: CourierChannel }) | null>(null)
  const [fieldMappings, setFieldMappings] = useState<ConverterFieldMapping[]>([])
  const [valueMappings, setValueMappings] = useState<ConverterValueMapping[]>([])
  const [otherProfiles, setOtherProfiles] = useState<ConverterProfile[]>([])
  const [loading, setLoading] = useState(true)

  // Field mapping dialog
  const [fmOpen, setFmOpen] = useState(false)
  const [fmSaving, setFmSaving] = useState(false)
  const [fmEditId, setFmEditId] = useState<number | null>(null)
  const [fmForm, setFmForm] = useState<FieldForm>(initialFieldForm)

  // Value mapping dialog
  const [vmOpen, setVmOpen] = useState(false)
  const [vmSaving, setVmSaving] = useState(false)
  const [vmEditId, setVmEditId] = useState<number | null>(null)
  const [vmForm, setVmForm] = useState<ValueForm>(initialValueForm)

  // Bulk copy
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkSource, setBulkSource] = useState('')
  const [bulkRunning, setBulkRunning] = useState(false)

  // Test parser
  const [testFile, setTestFile] = useState<File | null>(null)
  const [testText, setTestText] = useState('')
  const [testRunning, setTestRunning] = useState(false)
  const [testResult, setTestResult] = useState<PreviewResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    setLoading(true)
    const [{ data: p }, { data: fms }, { data: vms }, { data: others }] = await Promise.all([
      supabase
        .from('converter_profiles')
        .select('*, channel:courier_channels(id, code, name, active)')
        .eq('id', profileId)
        .single(),
      supabase
        .from('converter_field_mappings')
        .select('*')
        .eq('profile_id', profileId)
        .order('display_order')
        .order('id'),
      supabase
        .from('converter_value_mappings')
        .select('*')
        .eq('profile_id', profileId)
        .order('source_field')
        .order('raw_value'),
      supabase
        .from('converter_profiles')
        .select('id, code, name, direction')
        .neq('id', profileId)
        .order('code'),
    ])
    setProfile((p as any) || null)
    setFieldMappings(fms || [])
    setValueMappings(vms || [])
    setOtherProfiles((others as any) || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [profileId])

  // ================== Field Mapping handlers ==================
  const openAddField = () => {
    const nextOrder = fieldMappings.length === 0
      ? 1
      : Math.max(...fieldMappings.map((f) => f.display_order || 0)) + 1
    setFmForm({
      ...initialFieldForm,
      display_order: nextOrder,
      target_table: profile?.direction === 'OUTBOUND_TO_COURIER' ? 'file_column' : 'orders',
    })
    setFmEditId(null)
    setFmOpen(true)
  }
  const openEditField = (fm: ConverterFieldMapping) => {
    setFmEditId(fm.id)
    setFmForm({
      source_field: fm.source_field,
      target_field: fm.target_field,
      target_table: fm.target_table as ConverterTargetTableEnum,
      transform: fm.transform || '',
      required: fm.required,
      display_order: fm.display_order,
      notes: fm.notes || '',
    })
    setFmOpen(true)
  }

  const saveField = async (e: React.FormEvent) => {
    e.preventDefault()
    const payload = {
      source_field: fmForm.source_field.trim(),
      target_field: fmForm.target_field.trim(),
      target_table: fmForm.target_table,
      transform: fmForm.transform.trim() || null,
      required: fmForm.required,
      display_order: Number(fmForm.display_order) || 0,
      notes: fmForm.notes.trim() || null,
    }
    const parsed = fieldMappingSchema.safeParse(payload)
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Validasi gagal')
      return
    }
    setFmSaving(true)
    try {
      const writeData = { ...parsed.data, profile_id: profileId }
      const { error } = fmEditId
        ? await supabase.from('converter_field_mappings').update(writeData).eq('id', fmEditId)
        : await supabase.from('converter_field_mappings').insert(writeData)
      if (error) {
        if ((error as any).code === '23505') {
          throw new Error(`Source field "${parsed.data.source_field}" sudah dipakai di profile ini`)
        }
        throw error
      }
      toast.success(fmEditId ? 'Field mapping diupdate' : 'Field mapping ditambahkan')
      setFmOpen(false)
      setFmForm(initialFieldForm)
      setFmEditId(null)
      load()
    } catch (err: any) {
      toast.error('Gagal simpan', { description: getErrorMessage(err) })
    } finally {
      setFmSaving(false)
    }
  }

  const deleteField = async (fm: ConverterFieldMapping) => {
    if (!confirm(`Hapus field mapping "${fm.source_field}" → "${fm.target_field}"?`)) return
    const { error } = await supabase.from('converter_field_mappings').delete().eq('id', fm.id)
    if (error) {
      toast.error('Gagal hapus', { description: error.message })
      return
    }
    toast.success('Field mapping dihapus')
    load()
  }

  const moveField = async (fm: ConverterFieldMapping, dir: 'up' | 'down') => {
    const sorted = [...fieldMappings].sort((a, b) => (a.display_order || 0) - (b.display_order || 0))
    const idx = sorted.findIndex((f) => f.id === fm.id)
    const targetIdx = dir === 'up' ? idx - 1 : idx + 1
    if (targetIdx < 0 || targetIdx >= sorted.length) return
    const other = sorted[targetIdx]
    const newOrderForFm = other.display_order
    const newOrderForOther = fm.display_order
    const { error: e1 } = await supabase
      .from('converter_field_mappings')
      .update({ display_order: newOrderForFm })
      .eq('id', fm.id)
    if (e1) {
      toast.error('Gagal reorder', { description: e1.message })
      return
    }
    const { error: e2 } = await supabase
      .from('converter_field_mappings')
      .update({ display_order: newOrderForOther })
      .eq('id', other.id)
    if (e2) {
      toast.error('Gagal reorder (step 2)', { description: e2.message })
    }
    load()
  }

  // ================== Value Mapping handlers ==================
  const openAddValue = () => {
    setVmForm(initialValueForm)
    setVmEditId(null)
    setVmOpen(true)
  }
  const openEditValue = (vm: ConverterValueMapping) => {
    setVmEditId(vm.id)
    setVmForm({
      source_field: vm.source_field,
      raw_value: vm.raw_value,
      mapped_value: vm.mapped_value,
      notes: vm.notes || '',
    })
    setVmOpen(true)
  }
  const saveValue = async (e: React.FormEvent) => {
    e.preventDefault()
    const payload = {
      source_field: vmForm.source_field.trim(),
      raw_value: vmForm.raw_value,
      mapped_value: vmForm.mapped_value,
      notes: vmForm.notes.trim() || null,
    }
    const parsed = valueMappingSchema.safeParse(payload)
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Validasi gagal')
      return
    }
    setVmSaving(true)
    try {
      const writeData = { ...parsed.data, profile_id: profileId }
      const { error } = vmEditId
        ? await supabase.from('converter_value_mappings').update(writeData).eq('id', vmEditId)
        : await supabase.from('converter_value_mappings').insert(writeData)
      if (error) {
        if ((error as any).code === '23505') {
          throw new Error(
            `Value mapping ("${parsed.data.source_field}" → "${parsed.data.raw_value}") sudah ada`
          )
        }
        throw error
      }
      toast.success(vmEditId ? 'Value mapping diupdate' : 'Value mapping ditambahkan')
      setVmOpen(false)
      setVmForm(initialValueForm)
      setVmEditId(null)
      load()
    } catch (err: any) {
      toast.error('Gagal simpan', { description: getErrorMessage(err) })
    } finally {
      setVmSaving(false)
    }
  }
  const deleteValue = async (vm: ConverterValueMapping) => {
    if (!confirm(`Hapus value mapping "${vm.raw_value}" → "${vm.mapped_value}"?`)) return
    const { error } = await supabase.from('converter_value_mappings').delete().eq('id', vm.id)
    if (error) {
      toast.error('Gagal hapus', { description: error.message })
      return
    }
    toast.success('Value mapping dihapus')
    load()
  }

  // ================== Bulk copy field mappings ==================
  const runBulkCopy = async () => {
    if (!bulkSource) {
      toast.error('Pilih source profile')
      return
    }
    setBulkRunning(true)
    try {
      const { data: srcFms, error } = await supabase
        .from('converter_field_mappings')
        .select('source_field, target_field, target_table, transform, required, display_order, notes')
        .eq('profile_id', Number(bulkSource))
      if (error) throw error
      if (!srcFms || srcFms.length === 0) {
        toast.error('Source profile belum punya field mappings')
        return
      }
      const payload = srcFms.map((f: any) => ({ ...f, profile_id: profileId }))
      const { error: e2 } = await supabase
        .from('converter_field_mappings')
        .upsert(payload, { onConflict: 'profile_id,source_field', ignoreDuplicates: true })
      if (e2) throw e2
      toast.success(`${payload.length} field mappings ter-copy`, {
        description: 'Mapping yang sudah ada di profile ini di-skip.',
      })
      setBulkOpen(false)
      setBulkSource('')
      load()
    } catch (err: any) {
      toast.error('Gagal copy', { description: getErrorMessage(err) })
    } finally {
      setBulkRunning(false)
    }
  }

  // ================== Test Parser ==================
  const runTestParser = async () => {
    if (!profile) return
    if (profile.direction === 'WA_PASTE' && !testText.trim()) {
      toast.error('Paste sample text dulu')
      return
    }
    if (profile.direction !== 'WA_PASTE' && !testFile) {
      toast.error('Pilih file dulu')
      return
    }
    setTestRunning(true)
    try {
      const input = profile.direction === 'WA_PASTE' ? testText : testFile!
      const result = await previewParse(profile, fieldMappings, valueMappings, input, 3)
      setTestResult(result)
      if (result.errors.length > 0) {
        toast.error('Preview error', { description: result.errors[0] })
      } else if (result.warnings.length > 0) {
        toast.warning(`Preview selesai dengan ${result.warnings.length} warning`)
      } else {
        toast.success(`Preview selesai (${result.rows.length} rows ditampilkan, total ${result.totalRowsDetected} terdeteksi)`)
      }
    } catch (err: any) {
      toast.error('Gagal parse', { description: getErrorMessage(err) })
    } finally {
      setTestRunning(false)
    }
  }

  const sortedFms = useMemo(
    () => [...fieldMappings].sort((a, b) => (a.display_order || 0) - (b.display_order || 0)),
    [fieldMappings]
  )

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-10 bg-muted animate-pulse rounded w-64" />
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin mx-auto" />
          </CardContent>
        </Card>
      </div>
    )
  }
  if (!profile) {
    return (
      <div className="space-y-6">
        <Link href="/settings/converter-profiles" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Kembali
        </Link>
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            Profile tidak ditemukan.
          </CardContent>
        </Card>
      </div>
    )
  }

  const isOutbound = profile.direction === 'OUTBOUND_TO_COURIER'
  const isWaPaste = profile.direction === 'WA_PASTE'

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link
          href="/settings/converter-profiles"
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Kembali
        </Link>
      </div>

      {/* Profile header */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold">{profile.name}</h1>
                <Badge variant="outline" className={DIRECTION_BADGE_COLOR[profile.direction]}>
                  {DIRECTION_LABEL[profile.direction]}
                </Badge>
                <Badge variant="outline" className={profile.active ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' : 'bg-zinc-500/10 text-zinc-600 border-zinc-500/30'}>
                  {profile.active ? 'Aktif' : 'Nonaktif'}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground space-x-3">
                <code className="bg-muted px-1.5 py-0.5 rounded">{profile.code}</code>
                <span>Source/Target: <span className="font-medium">{profile.source_or_target}</span></span>
                {profile.channel && <span>Channel: <span className="font-medium">{profile.channel.code}</span></span>}
                <span>Format: {profile.file_format}{profile.file_format === 'CSV' && profile.file_delimiter ? ` (${profile.file_delimiter})` : ''}</span>
                {profile.has_header_row && <span>Header row: {profile.header_row_index}</span>}
              </div>
              {profile.notes && <p className="text-xs text-muted-foreground">{profile.notes}</p>}
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="fields">
        <TabsList>
          <TabsTrigger value="fields">Field Mappings ({fieldMappings.length})</TabsTrigger>
          <TabsTrigger value="values">Value Mappings ({valueMappings.length})</TabsTrigger>
          <TabsTrigger value="test">Test Parser</TabsTrigger>
        </TabsList>

        {/* TAB 1: FIELD MAPPINGS */}
        <TabsContent value="fields" className="space-y-3">
          <div className="flex items-center justify-end gap-2 flex-wrap">
            <PermissionGuard role={role} allowedRoles={['owner', 'admin']}>
              <Dialog open={bulkOpen} onOpenChange={(v) => { setBulkOpen(v); if (!v) setBulkSource('') }}>
                <DialogTrigger render={<Button variant="outline" size="sm"><Copy className="w-3.5 h-3.5 mr-1" />Salin dari Profile Lain</Button>} />
                <DialogContent>
                  <DialogHeader><DialogTitle>Salin Field Mappings</DialogTitle></DialogHeader>
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Source Profile</Label>
                      <Select value={bulkSource} onValueChange={(v) => v && setBulkSource(v)}>
                        <SelectTrigger><SelectValue placeholder="Pilih profile asal">
                          {(value: string | null) => {
                            if (!value) return 'Pilih profile asal'
                            const p = otherProfiles.find((x) => String(x.id) === value)
                            return p ? `${p.code} — ${p.name}` : value
                          }}
                        </SelectValue></SelectTrigger>
                        <SelectContent className="w-[320px]">
                          {otherProfiles.map((p) => (
                            <SelectItem key={p.id} value={String(p.id)}>{p.code} — {p.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Semua field mappings dari source di-copy ke profile ini.
                      Source field yang sudah ada di profile ini akan di-skip (UNIQUE constraint).
                    </p>
                    <Button
                      onClick={runBulkCopy}
                      disabled={bulkRunning || !bulkSource}
                      className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white"
                    >
                      {bulkRunning && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Salin
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
              <Dialog open={fmOpen} onOpenChange={(v) => { setFmOpen(v); if (!v) { setFmForm(initialFieldForm); setFmEditId(null) } }}>
                <DialogTrigger
                  render={
                    <Button onClick={openAddField} size="sm" className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white">
                      <Plus className="w-3.5 h-3.5 mr-1" />Tambah Field Mapping
                    </Button>
                  }
                />
                <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                  <DialogHeader><DialogTitle>{fmEditId ? 'Edit' : 'Tambah'} Field Mapping</DialogTitle></DialogHeader>
                  <form onSubmit={saveField} className="space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Source Field *</Label>
                      <Input
                        value={fmForm.source_field}
                        onChange={(e) => setFmForm({ ...fmForm, source_field: e.target.value })}
                        placeholder={isOutbound ? 'customer_name (field internal)' : 'Customer Name (kolom file)'}
                        required
                      />
                      <p className="text-[10px] text-muted-foreground">
                        {isOutbound
                          ? 'Field internal Grandbook (e.g. customer_name, order_items.product_summary)'
                          : 'Nama persis dengan kolom file (case-sensitive!)'}
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Target Field *</Label>
                      <Input
                        value={fmForm.target_field}
                        onChange={(e) => setFmForm({ ...fmForm, target_field: e.target.value })}
                        placeholder={isOutbound ? 'No HP Penerima (kolom output)' : 'customer_phone'}
                        required
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Target Table *</Label>
                        <Select
                          value={fmForm.target_table}
                          onValueChange={(v) => v && setFmForm({ ...fmForm, target_table: v as ConverterTargetTableEnum })}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent className="w-[200px]">
                            {CONVERTER_TARGET_TABLES.map((t) => (
                              <SelectItem key={t} value={t}>{t}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Display Order</Label>
                        <Input
                          type="number"
                          min={0}
                          value={fmForm.display_order}
                          onChange={(e) => setFmForm({ ...fmForm, display_order: Number(e.target.value) || 0 })}
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Transform (optional)</Label>
                      <Select
                        value={fmForm.transform || 'none'}
                        onValueChange={(v) => setFmForm({ ...fmForm, transform: !v || v === 'none' ? '' : v })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Pilih transform">
                            {(value: string | null) => !value || value === 'none' ? 'Tidak ada' : value}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent className="w-[360px] max-h-[300px]">
                          <SelectItem value="none">Tidak ada</SelectItem>
                          {TRANSFORMS.map((t) => (
                            <SelectItem key={t.key} value={t.key}>
                              {t.label}{!t.available && ' (Phase 3)'}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {fmForm.transform && (
                        <p className="text-[10px] text-muted-foreground">
                          {TRANSFORMS.find((t) => t.key === fmForm.transform)?.description}
                        </p>
                      )}
                    </div>
                    <label className="flex items-center gap-2">
                      <Checkbox
                        checked={fmForm.required}
                        onCheckedChange={(v) => setFmForm({ ...fmForm, required: v === true })}
                      />
                      <span className="text-xs">Required (warning kalau kosong)</span>
                    </label>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Notes</Label>
                      <Textarea
                        value={fmForm.notes}
                        onChange={(e) => setFmForm({ ...fmForm, notes: e.target.value })}
                        rows={2}
                      />
                    </div>
                    <Button
                      type="submit"
                      disabled={fmSaving}
                      className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white"
                    >
                      {fmSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Simpan
                    </Button>
                  </form>
                </DialogContent>
              </Dialog>
            </PermissionGuard>
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Order</TableHead>
                    <TableHead>Source Field</TableHead>
                    <TableHead className="text-center">→</TableHead>
                    <TableHead>Target Field</TableHead>
                    <TableHead>Target Table</TableHead>
                    <TableHead>Transform</TableHead>
                    <TableHead className="text-center">Required</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedFms.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-12 text-muted-foreground text-sm">
                        Belum ada field mappings. Klik “Tambah Field Mapping” untuk mulai.
                      </TableCell>
                    </TableRow>
                  ) : sortedFms.map((fm, idx) => (
                    <TableRow key={fm.id}>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-muted-foreground w-5 text-center">{fm.display_order}</span>
                          <PermissionGuard role={role} allowedRoles={['owner', 'admin']}>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => moveField(fm, 'up')}
                              disabled={idx === 0}
                            >
                              <ArrowUp className="w-3 h-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => moveField(fm, 'down')}
                              disabled={idx === sortedFms.length - 1}
                            >
                              <ArrowDown className="w-3 h-3" />
                            </Button>
                          </PermissionGuard>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{fm.source_field}</TableCell>
                      <TableCell className="text-center text-muted-foreground"><ArrowRight className="w-3.5 h-3.5 inline" /></TableCell>
                      <TableCell className="font-mono text-xs">{fm.target_field}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={TARGET_TABLE_BADGE_COLOR[fm.target_table as ConverterTargetTableEnum]}>
                          {fm.target_table}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {fm.transform ? <code className="bg-muted px-1 py-0.5 rounded">{fm.transform}</code> : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-center">
                        {fm.required ? <CheckCircle2 className="w-4 h-4 text-emerald-500 inline" /> : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[150px] truncate">{fm.notes || '—'}</TableCell>
                      <TableCell className="text-right">
                        <PermissionGuard role={role} allowedRoles={['owner', 'admin']}>
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" onClick={() => openEditField(fm)}><Pencil className="w-3.5 h-3.5" /></Button>
                            <Button variant="ghost" size="icon" onClick={() => deleteField(fm)} className="text-red-500"><Trash2 className="w-3.5 h-3.5" /></Button>
                          </div>
                        </PermissionGuard>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 2: VALUE MAPPINGS */}
        <TabsContent value="values" className="space-y-3">
          <div className="flex items-center justify-end">
            <PermissionGuard role={role} allowedRoles={['owner', 'admin']}>
              <Dialog open={vmOpen} onOpenChange={(v) => { setVmOpen(v); if (!v) { setVmForm(initialValueForm); setVmEditId(null) } }}>
                <DialogTrigger
                  render={
                    <Button onClick={openAddValue} size="sm" className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white">
                      <Plus className="w-3.5 h-3.5 mr-1" />Tambah Value Mapping
                    </Button>
                  }
                />
                <DialogContent className="max-w-md">
                  <DialogHeader><DialogTitle>{vmEditId ? 'Edit' : 'Tambah'} Value Mapping</DialogTitle></DialogHeader>
                  <form onSubmit={saveValue} className="space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Source Field *</Label>
                      <Input
                        value={vmForm.source_field}
                        onChange={(e) => setVmForm({ ...vmForm, source_field: e.target.value })}
                        placeholder="payment_method"
                        required
                      />
                      <p className="text-[10px] text-muted-foreground">Biasanya sama dengan source_field di Field Mappings</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Raw Value *</Label>
                        <Input
                          value={vmForm.raw_value}
                          onChange={(e) => setVmForm({ ...vmForm, raw_value: e.target.value })}
                          placeholder="cod"
                          required
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Mapped Value *</Label>
                        <Input
                          value={vmForm.mapped_value}
                          onChange={(e) => setVmForm({ ...vmForm, mapped_value: e.target.value })}
                          placeholder="COD"
                          required
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Notes</Label>
                      <Textarea
                        value={vmForm.notes}
                        onChange={(e) => setVmForm({ ...vmForm, notes: e.target.value })}
                        rows={2}
                      />
                    </div>
                    <Button
                      type="submit"
                      disabled={vmSaving}
                      className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white"
                    >
                      {vmSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Simpan
                    </Button>
                  </form>
                </DialogContent>
              </Dialog>
            </PermissionGuard>
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source Field</TableHead>
                    <TableHead>Raw Value</TableHead>
                    <TableHead className="text-center">→</TableHead>
                    <TableHead>Mapped Value</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {valueMappings.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-12 text-muted-foreground text-sm">
                        Belum ada value mappings. Tambah kalau ada raw value yang harus di-translate (e.g. &quot;cod&quot; → &quot;COD&quot;).
                      </TableCell>
                    </TableRow>
                  ) : valueMappings.map((vm) => (
                    <TableRow key={vm.id}>
                      <TableCell className="font-mono text-xs">{vm.source_field}</TableCell>
                      <TableCell className="font-mono text-xs">{vm.raw_value}</TableCell>
                      <TableCell className="text-center text-muted-foreground"><ArrowRight className="w-3.5 h-3.5 inline" /></TableCell>
                      <TableCell className="font-mono text-xs font-medium">{vm.mapped_value}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{vm.notes || '—'}</TableCell>
                      <TableCell className="text-right">
                        <PermissionGuard role={role} allowedRoles={['owner', 'admin']}>
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" onClick={() => openEditValue(vm)}><Pencil className="w-3.5 h-3.5" /></Button>
                            <Button variant="ghost" size="icon" onClick={() => deleteValue(vm)} className="text-red-500"><Trash2 className="w-3.5 h-3.5" /></Button>
                          </div>
                        </PermissionGuard>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 3: TEST PARSER */}
        <TabsContent value="test" className="space-y-3">
          <Card>
            <CardContent className="pt-4 pb-4 space-y-3">
              {isOutbound ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  <FileText className="w-8 h-8 mx-auto mb-2 text-muted-foreground/60" />
                  OUTBOUND parser preview akan tersedia di Phase 3 (Converter Engine).<br />
                  Untuk preview output, jalankan dulu Converter Engine dengan order existing.
                </div>
              ) : (
                <>
                  <div>
                    <div className="text-sm font-medium mb-2">Test Parser ({DIRECTION_LABEL[profile.direction]})</div>
                    <p className="text-xs text-muted-foreground mb-3">
                      Light-weight preview — max 3 rows pertama. Engine production di Phase 3 akan jalan beda.
                    </p>
                    {isWaPaste ? (
                      <div className="space-y-2">
                        <Label className="text-xs">Sample Text</Label>
                        <Textarea
                          value={testText}
                          onChange={(e) => setTestText(e.target.value)}
                          rows={6}
                          placeholder="Paste sample chat WA..."
                          className="font-mono text-xs"
                        />
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Label className="text-xs">File ({profile.file_format})</Label>
                        <div className="flex items-center gap-2">
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept={profile.file_format === 'CSV' ? '.csv,text/csv' : '.xlsx,.xls'}
                            onChange={(e) => setTestFile(e.target.files?.[0] || null)}
                            className="hidden"
                          />
                          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                            <Upload className="w-3.5 h-3.5 mr-1" />Pilih File
                          </Button>
                          {testFile && (
                            <span className="text-xs text-muted-foreground">
                              {testFile.name} ({Math.round(testFile.size / 1024)} KB)
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  <Button
                    onClick={runTestParser}
                    disabled={testRunning || (isWaPaste ? !testText.trim() : !testFile)}
                    className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white"
                  >
                    {testRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                    Parse Preview
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          {testResult && !isOutbound && (
            <Card>
              <CardContent className="pt-4 pb-4 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="text-sm font-medium">
                    Hasil Parse — {testResult.rows.length} dari {testResult.totalRowsDetected} rows
                  </div>
                </div>
                {testResult.errors.length > 0 && (
                  <div className="text-xs space-y-1 p-3 rounded bg-red-500/10 border border-red-500/20 text-red-600">
                    <div className="font-semibold flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" /> Errors
                    </div>
                    {testResult.errors.map((e, i) => (
                      <div key={i}>• {e}</div>
                    ))}
                  </div>
                )}
                {testResult.warnings.length > 0 && (
                  <div className="text-xs space-y-1 p-3 rounded bg-amber-500/10 border border-amber-500/20 text-amber-600">
                    <div className="font-semibold flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" /> Warnings ({testResult.warnings.length})
                    </div>
                    {testResult.warnings.map((w, i) => (
                      <div key={i}>• {w}</div>
                    ))}
                  </div>
                )}
                {testResult.rows.map((row, i) => (
                  <div key={i} className="border rounded p-3 space-y-2 text-xs">
                    <div className="font-semibold text-muted-foreground">Row {i + 1}</div>
                    {(['orders', 'order_items', 'meta', 'file_column'] as const).map((bucket) => {
                      const data = row[bucket]
                      const keys = Object.keys(data || {})
                      if (keys.length === 0) return null
                      return (
                        <div key={bucket} className="space-y-1">
                          <Badge variant="outline" className={TARGET_TABLE_BADGE_COLOR[bucket]}>
                            {bucket}
                          </Badge>
                          <div className="pl-3 space-y-0.5 font-mono">
                            {keys.map((k) => (
                              <div key={k} className="flex gap-2">
                                <span className="text-muted-foreground">{k}:</span>
                                <span className="text-foreground break-all">
                                  {formatPreviewValue(data[k])}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ))}
                {testResult.rows.length === 0 && testResult.errors.length === 0 && (
                  <div className="text-xs text-muted-foreground text-center py-6">
                    Tidak ada baris yang ter-parse. Cek file format / regex pattern / has_header_row.
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {!canManage && (
        <Card className="border-blue-500/20 bg-blue-500/5">
          <CardContent className="pt-3 pb-3 text-xs text-muted-foreground">
            ℹ️ Mode read-only. Hanya Owner/Admin yang bisa edit field & value mappings.
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function formatPreviewValue(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'string') return `"${v}"`
  if (typeof v === 'object') {
    try { return JSON.stringify(v) } catch { return String(v) }
  }
  return String(v)
}
