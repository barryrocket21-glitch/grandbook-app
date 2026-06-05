'use client'
import { useState, useEffect, useMemo, useCallback } from 'react'
import Link from 'next/link'
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
import { Combobox } from '@/components/ui/combobox'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { getErrorMessage } from '@/lib/errors'
import {
  Plus, Loader2, Users, Save, CopyPlus, Trash2, RotateCcw,
  TrendingUp, MessageCircle, CheckCircle2, AlertTriangle, Pencil,
} from 'lucide-react'
import { formatNumber } from '@/lib/format'
import type { Product, Profile } from '@/lib/types'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import {
  listReportForDay, upsertReportBatch, deleteReportRow,
  fetchCsDailySummary, yesterdayOf,
  type CsDailySummary,
} from '@/lib/supabase/queries/cs-report'
import { listProducts } from '@/lib/supabase/queries/products'

const supabase = createClient()

const today = () => new Date().toISOString().slice(0, 10)

interface Row {
  id?: number  // existing row id (kalau ada) — preserve untuk delete
  product_id: number
  product_name: string
  product_sku: string | null
  lead_in: number
  closing: number
  rejected: number
  reject_reasons: string
  notes: string
  isNew: boolean
}

export default function CsReportPage() {
  const { profile, role, loading: authLoading } = useAuth()
  const isOwner = role === 'owner' || role === 'admin'
  const isCs = role === 'cs'
  const canAccess = isOwner || isCs

  const [date, setDate] = useState<string>(today())
  const [dateReady, setDateReady] = useState(false)

  const [csList, setCsList] = useState<Profile[]>([])
  const [selectedCsId, setSelectedCsId] = useState<string>('')

  const [products, setProducts] = useState<Product[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [generalNotes, setGeneralNotes] = useState<string>('')

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [copying, setCopying] = useState(false)
  const [summary, setSummary] = useState<CsDailySummary | null>(null)
  const [editMode, setEditMode] = useState(false) // read-only default; klik Edit baru bisa ubah angka

  // Init: pick today + auto-set CS to current user kalau role=cs
  useEffect(() => {
    setDate(today())
    setDateReady(true)
  }, [])

  useEffect(() => {
    if (isCs && profile?.id) {
      setSelectedCsId(profile.id)
    }
  }, [isCs, profile?.id])

  // Load CS list (owner/admin only) + products
  useEffect(() => {
    const loadInit = async () => {
      const [pp, csQ] = await Promise.all([
        listProducts(supabase),
        supabase.from('profiles').select('id, full_name, role, active')
          .eq('role', 'cs')
          .eq('active', true)
          .order('full_name'),
      ])
      setProducts(pp.filter(p => p.active))
      setCsList((csQ.data || []) as Profile[])
    }
    void loadInit()
  }, [])

  // Load report rows for selected (csId, date)
  const loadReport = useCallback(async () => {
    if (!selectedCsId || !dateReady) {
      setRows([])
      setSummary(null)
      return
    }
    setLoading(true)
    try {
      const [existing, sum] = await Promise.all([
        listReportForDay(supabase, { csId: selectedCsId, date }),
        fetchCsDailySummary(supabase, { csId: selectedCsId, date }),
      ])
      const mapped: Row[] = existing.map(r => ({
        id: r.id,
        product_id: r.product_id,
        product_name: r.product?.name || `#${r.product_id}`,
        product_sku: r.product?.sku ?? null,
        lead_in: Number(r.lead_in),
        closing: Number(r.closing),
        rejected: Number((r as { rejected?: number }).rejected) || 0,
        reject_reasons: Array.isArray((r as { reject_reasons?: string[] }).reject_reasons)
          ? ((r as { reject_reasons?: string[] }).reject_reasons || []).join(', ') : '',
        notes: r.notes ?? '',
        isNew: false,
      }))
      setRows(mapped)
      setSummary(sum)
    } catch (err) {
      toast.error('Gagal load laporan', { description: getErrorMessage(err) })
    } finally {
      setLoading(false)
    }
  }, [selectedCsId, date, dateReady])

  useEffect(() => { void loadReport() }, [loadReport])

  // Real-time totals
  const totals = useMemo(() => {
    const lead = rows.reduce((s, r) => s + (Number(r.lead_in) || 0), 0)
    const close = rows.reduce((s, r) => s + (Number(r.closing) || 0), 0)
    const rate = lead > 0 ? (close * 100) / lead : 0
    return { lead, close, rate }
  }, [rows])

  // Validation per row
  const rowErrors = useMemo(() => {
    const errs: Record<number, string> = {}
    rows.forEach((r, idx) => {
      if (r.closing > r.lead_in) {
        errs[idx] = 'Closing tidak boleh > lead masuk'
      }
    })
    return errs
  }, [rows])

  const hasErrors = Object.keys(rowErrors).length > 0

  // Product options for Combobox (exclude already-added)
  const productOptions = useMemo(() => {
    const usedIds = new Set(rows.map(r => r.product_id))
    return products
      .filter(p => !usedIds.has(p.id))
      .map(p => ({
        value: String(p.id),
        label: p.name,
        hint: p.sku ? `SKU: ${p.sku}` : undefined,
      }))
  }, [products, rows])

  const csOptions = useMemo(
    () => csList.map(c => ({ value: c.id, label: c.full_name })),
    [csList]
  )

  const handleAddProduct = (productId: string) => {
    const pid = Number(productId)
    if (!pid) return
    const p = products.find(x => x.id === pid)
    if (!p) return
    setRows(prev => [...prev, {
      product_id: p.id,
      product_name: p.name,
      product_sku: p.sku,
      lead_in: 0,
      closing: 0,
      rejected: 0,
      reject_reasons: '',
      notes: '',
      isNew: true,
    }])
  }

  const handleRowChange = (idx: number, patch: Partial<Row>) => {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r))
  }

  const handleRowDelete = async (idx: number) => {
    const r = rows[idx]
    if (r.id) {
      // Existing row — confirm DB delete (owner/admin only based on RLS)
      if (!isOwner) {
        toast.error('Hanya owner/admin yang bisa hapus row existing')
        return
      }
      if (!confirm(`Hapus laporan "${r.product_name}" (${r.lead_in} lead, ${r.closing} closing)?`)) return
      try {
        await deleteReportRow(supabase, r.id)
        toast.success('Row dihapus')
        void loadReport()
      } catch (err) {
        toast.error('Gagal hapus', { description: getErrorMessage(err) })
      }
      return
    }
    // New unsaved row — just remove from state
    setRows(prev => prev.filter((_, i) => i !== idx))
  }

  const handleSaveAll = async () => {
    if (!selectedCsId) return toast.error('Pilih CS dulu')
    if (hasErrors) return toast.error('Ada baris yang invalid — fix dulu sebelum save')
    if (rows.length === 0) return toast.error('Belum ada produk untuk disimpan')
    setSaving(true)
    try {
      const result = await upsertReportBatch(supabase, {
        orgId: profile?.organization_id ?? 1,
        csId: selectedCsId,
        reportDate: date,
        rows: rows.map(r => ({
          product_id: r.product_id,
          lead_in: r.lead_in,
          closing: r.closing,
          rejected: r.rejected,
          reject_reasons: r.reject_reasons.trim()
            ? r.reject_reasons.split(',').map(s => s.trim()).filter(Boolean) : null,
          notes: r.notes.trim() || generalNotes.trim() || null,
        })),
        createdBy: profile?.id ?? null,
      })
      toast.success(`${result.upserted} laporan disimpan`)
      setEditMode(false) // balik ke read-only abis save (aman)
      void loadReport()
    } catch (err) {
      const msg = getErrorMessage(err)
      toast.error('Gagal save', { description: msg.includes('closing_lte_lead') ? 'Closing > lead di salah satu row (DB constraint)' : msg })
    } finally {
      setSaving(false)
    }
  }

  const handleCopyFromYesterday = async () => {
    if (!selectedCsId) return toast.error('Pilih CS dulu')
    const yday = yesterdayOf(date)
    setCopying(true)
    try {
      const yRows = await listReportForDay(supabase, { csId: selectedCsId, date: yday })
      if (yRows.length === 0) {
        toast.info(`Tidak ada laporan ${yday} untuk di-copy.`)
        return
      }
      // Merge: keep existing today rows + append yesterday rows yang belum ada
      const existingIds = new Set(rows.map(r => r.product_id))
      const yMapped: Row[] = yRows
        .filter(r => !existingIds.has(r.product_id))
        .map(r => ({
          product_id: r.product_id,
          product_name: r.product?.name || `#${r.product_id}`,
          product_sku: r.product?.sku ?? null,
          lead_in: Number(r.lead_in),
          closing: Number(r.closing),
          rejected: 0,
          reject_reasons: '',
          notes: r.notes ?? '',
          isNew: true,
        }))
      setRows(prev => [...prev, ...yMapped])
      toast.success(`${yMapped.length} produk ditambahkan dari ${yday} (angka di-prefill, adjust sebelum save)`)
    } catch (err) {
      toast.error('Gagal copy', { description: getErrorMessage(err) })
    } finally {
      setCopying(false)
    }
  }

  const handleResetUnsaved = () => {
    if (rows.some(r => r.isNew) && !confirm('Reset row yang belum di-save?')) return
    setRows(prev => prev.filter(r => !r.isNew))
  }

  if (authLoading) return null
  if (!canAccess) {
    return (
      <div className="space-y-6">
        <PageHeader icon={MessageCircle} title="Laporan Harian CS" />
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          Halaman ini untuk CS, owner, atau admin. Login dengan akun yang sesuai.
        </CardContent></Card>
      </div>
    )
  }

  const viewingOtherCs = isOwner && selectedCsId && selectedCsId !== profile?.id
  const selectedCsName = csList.find(c => c.id === selectedCsId)?.full_name

  return (
    <div className="space-y-6">
      <PageHeader
        icon={MessageCircle}
        title="Laporan Harian CS"
        description={viewingOtherCs
          ? `Mode edit untuk ${selectedCsName} (owner/admin override)`
          : 'Input lead masuk & closing per produk per hari'}
        actions={
          <Link href="/cs-dashboard">
            <Button variant="outline" size="sm">
              <TrendingUp className="w-3.5 h-3.5 mr-2" />Dashboard CS
            </Button>
          </Link>
        }
      />

      {/* Top controls */}
      <Card>
        <CardContent className="pt-4 pb-4 flex flex-col sm:flex-row gap-3 items-end">
          <div className="space-y-1 sm:w-44">
            <Label className="text-xs">Tanggal Laporan</Label>
            <Input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
            />
          </div>
          {isOwner && (
            <div className="space-y-1 flex-1 max-w-xs">
              <Label className="text-xs">CS</Label>
              <Combobox
                value={selectedCsId}
                onChange={v => setSelectedCsId(v)}
                options={csOptions}
                placeholder="Pilih CS"
                searchPlaceholder="Cari CS..."
                emptyHint={{
                  message: 'Belum ada user role=cs aktif.',
                  actionLabel: 'Buka /settings/users',
                  actionHref: '/settings/users',
                }}
              />
            </div>
          )}
          {isCs && (
            <div className="space-y-1">
              <Label className="text-xs">CS</Label>
              <div className="h-9 px-3 flex items-center text-sm bg-muted/30 rounded border">
                {profile?.full_name || '—'}
              </div>
            </div>
          )}
          <div className="flex gap-2 ml-auto">
            {!editMode ? (
              <Button size="sm" onClick={() => setEditMode(true)} disabled={!selectedCsId} className="bg-violet-600 hover:bg-violet-700 text-white">
                <Pencil className="w-3.5 h-3.5 mr-2" />Edit Angka
              </Button>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={handleCopyFromYesterday} disabled={copying || !selectedCsId} title={`Copy laporan dari ${yesterdayOf(date)}`}>
                  {copying ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <CopyPlus className="w-3.5 h-3.5 mr-2" />}
                  Copy dari Kemarin
                </Button>
                <Button variant="outline" size="sm" onClick={handleResetUnsaved} disabled={!rows.some(r => r.isNew)}>
                  <RotateCcw className="w-3.5 h-3.5 mr-2" />Reset
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setEditMode(false)}>Batal</Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Stat cards: live totals */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 flex items-center gap-3 relative">
            <div className="p-2.5 bg-blue-500/15 rounded-xl ring-1 ring-blue-500/20">
              <MessageCircle className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Lead Masuk</p>
              <p className="text-2xl font-bold text-blue-600">{formatNumber(totals.lead)}</p>
              <p className="text-[10px] text-muted-foreground">{rows.length} produk</p>
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 flex items-center gap-3 relative">
            <div className="p-2.5 bg-emerald-500/15 rounded-xl ring-1 ring-emerald-500/20">
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Closing</p>
              <p className="text-2xl font-bold text-emerald-600">{formatNumber(totals.close)}</p>
              <p className="text-[10px] text-muted-foreground">{summary ? `saved: ${summary.total_closing}` : 'belum saved'}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 flex items-center gap-3 relative">
            <div className="p-2.5 bg-violet-500/15 rounded-xl ring-1 ring-violet-500/20">
              <TrendingUp className="w-5 h-5 text-violet-500" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Close Rate</p>
              <p className="text-2xl font-bold text-violet-600">{totals.rate.toFixed(2)}%</p>
              <p className="text-[10px] text-muted-foreground">closing / lead</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Rows table */}
      {!selectedCsId ? (
        <Card><CardContent className="p-6">
          <EmptyState
            icon={Users}
            title="Pilih CS dulu"
            description={isOwner ? 'Pilih CS dari dropdown di atas untuk input/edit laporan.' : 'Akun lu belum di-link ke profile CS. Hubungi owner.'}
          />
        </CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produk</TableHead>
                  <TableHead className="text-right w-32">Lead Masuk</TableHead>
                  <TableHead className="text-right w-32">Closing</TableHead>
                  <TableHead className="text-right w-24">Reject</TableHead>
                  <TableHead className="text-center w-24">Rate</TableHead>
                  <TableHead className="w-44">Alasan Reject</TableHead>
                  <TableHead>Catatan</TableHead>
                  <TableHead className="text-right w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={6} className="py-8 text-center">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                  </TableCell></TableRow>
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="p-0">
                    <EmptyState
                      icon={MessageCircle}
                      title="Belum ada produk untuk hari ini"
                      description="Tambah produk lewat dropdown di bawah, atau klik 'Copy dari Kemarin' kalau ada draft."
                      compact
                    />
                  </TableCell></TableRow>
                ) : rows.map((r, idx) => {
                  const rate = r.lead_in > 0 ? (r.closing * 100) / r.lead_in : 0
                  const err = rowErrors[idx]
                  return (
                    <TableRow key={`${r.product_id}-${idx}`} className={err ? 'bg-red-500/5' : ''}>
                      <TableCell className="font-medium">
                        <div>{r.product_name}</div>
                        {r.product_sku && (
                          <div className="text-[10px] text-muted-foreground font-mono">{r.product_sku}</div>
                        )}
                        {r.isNew && <Badge variant="outline" className="text-[9px] mt-1 bg-amber-500/10 text-amber-600 border-amber-500/30">unsaved</Badge>}
                      </TableCell>
                      <TableCell className="text-right">
                        {editMode ? (
                          <Input type="number" min={0} value={r.lead_in}
                            onChange={e => handleRowChange(idx, { lead_in: Math.max(0, Number(e.target.value)) })}
                            className="text-right h-8 w-24 ml-auto" />
                        ) : <span className="font-medium tabular-nums pr-2">{formatNumber(r.lead_in)}</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        {editMode ? (
                          <Input type="number" min={0} value={r.closing}
                            onChange={e => handleRowChange(idx, { closing: Math.max(0, Number(e.target.value)) })}
                            className={`text-right h-8 w-24 ml-auto ${err ? 'border-red-500/50' : ''}`} />
                        ) : <span className="font-medium tabular-nums pr-2">{formatNumber(r.closing)}</span>}
                        {editMode && err && (
                          <div className="text-[10px] text-red-600 mt-1 flex items-center gap-1 justify-end">
                            <AlertTriangle className="w-3 h-3" />{err}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {editMode ? (
                          <Input type="number" min={0} value={r.rejected}
                            onChange={e => handleRowChange(idx, { rejected: Math.max(0, Number(e.target.value)) })}
                            className="text-right h-8 w-20 ml-auto" />
                        ) : <span className="tabular-nums pr-2 text-muted-foreground">{formatNumber(r.rejected)}</span>}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className={`text-[10px] ${rate >= 25 ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' : rate >= 10 ? 'bg-amber-500/10 text-amber-600 border-amber-500/30' : 'bg-zinc-500/10 text-zinc-600 border-zinc-500/30'}`}>
                          {rate.toFixed(1)}%
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {editMode ? (
                          <Input value={r.reject_reasons} onChange={e => handleRowChange(idx, { reject_reasons: e.target.value })} placeholder="mahal, stok habis…" className="h-8 text-xs" />
                        ) : <span className="text-xs text-muted-foreground">{r.reject_reasons || '—'}</span>}
                      </TableCell>
                      <TableCell>
                        {editMode ? (
                          <Input value={r.notes} onChange={e => handleRowChange(idx, { notes: e.target.value })} placeholder="optional" className="h-8 text-xs" />
                        ) : <span className="text-xs text-muted-foreground">{r.notes || '—'}</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        {editMode && (
                          <Button variant="ghost" size="icon" onClick={() => handleRowDelete(idx)} className="text-red-500 h-8 w-8"
                            title={r.id ? 'Hapus row (owner/admin only)' : 'Hapus row baru'} disabled={!!r.id && !isOwner}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
                {selectedCsId && rows.length > 0 && (
                  <TableRow className="bg-muted/30 font-semibold">
                    <TableCell>TOTAL</TableCell>
                    <TableCell className="text-right">{formatNumber(totals.lead)}</TableCell>
                    <TableCell className="text-right">{formatNumber(totals.close)}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className="text-xs">{totals.rate.toFixed(2)}%</Badge>
                    </TableCell>
                    <TableCell colSpan={2}></TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Add product Combobox + general notes + save — cuma pas edit mode */}
      {selectedCsId && editMode && (
        <Card>
          <CardContent className="pt-4 pb-4 space-y-4">
            <div className="flex flex-col sm:flex-row gap-3 items-end">
              <div className="flex-1 max-w-md space-y-1">
                <Label className="text-xs">Tambah Produk ke Laporan</Label>
                <Combobox
                  value=""
                  onChange={handleAddProduct}
                  options={productOptions}
                  placeholder="+ Pilih produk untuk ditambahkan..."
                  searchPlaceholder="Cari produk..."
                  emptyHint={{
                    message: productOptions.length === 0 && rows.length > 0
                      ? 'Semua produk aktif sudah di-list. Tambah produk baru di /products.'
                      : 'Belum ada produk aktif.',
                    actionLabel: 'Buka /products',
                    actionHref: '/products',
                  }}
                />
              </div>
              <Button
                onClick={handleSaveAll}
                disabled={saving || rows.length === 0 || hasErrors}
                className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/20"
              >
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                Save All ({rows.length})
              </Button>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Catatan Umum Hari Ini (opsional, fallback kalau row notes kosong)</Label>
              <Textarea
                value={generalNotes}
                onChange={e => setGeneralNotes(e.target.value)}
                placeholder="e.g. Banyak lead spam dari iklan A — perlu screening ulang"
                rows={2}
              />
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-blue-500/20 bg-blue-500/5">
        <CardContent className="pt-4 pb-4 text-sm space-y-2">
          <p>💡 <strong>Tips:</strong></p>
          <ul className="list-disc list-inside text-xs text-muted-foreground space-y-1">
            <li><strong>Closing</strong> = lead yang berhasil jadi order (akan di-cross-check dengan system orders di /analytics tab Funnel).</li>
            <li><strong>Closing ≤ Lead</strong> — DB constraint. Kalau lebih, fix dulu sebelum save.</li>
            <li><strong>Copy dari Kemarin</strong> — append produk yang udah tercatat kemarin (angka di-prefill, adjust sesuai hari ini).</li>
            <li>Save All <strong>upsert per (CS × tanggal × produk)</strong>. Edit ulang nilai aman — tidak duplikat.</li>
            <li>Hapus row existing hanya owner/admin (preserve audit trail).</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
