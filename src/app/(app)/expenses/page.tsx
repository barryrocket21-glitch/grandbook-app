'use client'
import { useState, useEffect, useMemo, useCallback } from 'react'
import { getErrorMessage } from '@/lib/errors'
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
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import {
  Plus, Pencil, Loader2, Receipt, Trash2, Search,
  Repeat, CopyPlus, TrendingDown, Wallet, BadgeCheck,
} from 'lucide-react'
import { formatRupiah, formatDate } from '@/lib/format'
import type { OperationalExpense, OperationalExpenseCategory } from '@/lib/types'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import {
  DateRangePicker, thisMonth, type DateRange,
} from '@/components/ui/date-range-picker'
import {
  listExpenses, listRecurringExpenses, insertExpense, updateExpense,
  deleteExpense, bulkDeleteExpenses, copyRecurringFromLastMonth,
} from '@/lib/supabase/queries/expenses'
import {
  EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABEL, EXPENSE_CATEGORY_COLOR,
  EXPENSE_PAYMENT_METHODS, EXPENSE_PAYMENT_METHOD_LABEL,
  RECURRENCE_PERIODS, RECURRENCE_PERIOD_LABEL,
} from '@/lib/schemas/settings'

const supabase = createClient()

const today = () => new Date().toISOString().split('T')[0]
const firstOfThisMonth = () => {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}

type CategoryFilter = 'ALL' | OperationalExpenseCategory
type RecurringFilter = 'ALL' | 'RECURRING' | 'ONETIME'

interface ExpenseForm {
  expense_date: string
  category: OperationalExpenseCategory
  description: string
  amount: number
  payment_method: string
  payment_reference: string
  vendor_name: string
  recurring: boolean
  recurrence_period: 'MONTHLY' | 'WEEKLY' | 'YEARLY' | ''
  notes: string
}

const emptyForm: ExpenseForm = {
  expense_date: today(),
  category: 'OPERASIONAL',
  description: '',
  amount: 0,
  payment_method: '',
  payment_reference: '',
  vendor_name: '',
  recurring: false,
  recurrence_period: '',
  notes: '',
}

export default function ExpensesPage() {
  const { profile, role } = useAuth()
  const isOwner = role === 'owner'
  const canWrite = role === 'owner' || role === 'admin' || role === 'akunting'

  const [expenses, setExpenses] = useState<OperationalExpense[]>([])
  const [recurringAll, setRecurringAll] = useState<OperationalExpense[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [copying, setCopying] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [range, setRange] = useState<DateRange>(thisMonth())
  const [rangeReady, setRangeReady] = useState(false)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('ALL')
  const [recurringFilter, setRecurringFilter] = useState<RecurringFilter>('ALL')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [form, setForm] = useState<ExpenseForm>(emptyForm)

  // Lazy-init range to avoid hydration drift
  useEffect(() => {
    setRange(thisMonth())
    setRangeReady(true)
  }, [])

  const load = useCallback(async () => {
    if (!rangeReady) return
    setLoading(true)
    try {
      const [list, rec] = await Promise.all([
        listExpenses(supabase, { from: range.from, to: range.to }),
        listRecurringExpenses(supabase),
      ])
      setExpenses(list)
      setRecurringAll(rec)
      setSelectedIds(new Set())
    } catch (err) {
      toast.error('Gagal load expenses', { description: getErrorMessage(err) })
    } finally {
      setLoading(false)
    }
  }, [range.from, range.to, rangeReady])

  useEffect(() => { void load() }, [load])

  const reset = () => { setForm(emptyForm); setEditId(null) }

  const openEdit = (e: OperationalExpense) => {
    setForm({
      expense_date: e.expense_date,
      category: e.category,
      description: e.description,
      amount: Number(e.amount),
      payment_method: e.payment_method ?? '',
      payment_reference: e.payment_reference ?? '',
      vendor_name: e.vendor_name ?? '',
      recurring: e.recurring,
      recurrence_period: e.recurrence_period ?? '',
      notes: e.notes ?? '',
    })
    setEditId(e.id)
    setOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.description.trim()) return toast.error('Deskripsi wajib diisi')
    if (form.amount <= 0) return toast.error('Jumlah harus lebih dari 0')
    if (form.recurring && !form.recurrence_period) {
      return toast.error('Pilih periode recurrence (Mingguan/Bulanan/Tahunan)')
    }
    setSaving(true)
    try {
      const payload = {
        expense_date: form.expense_date,
        category: form.category,
        description: form.description.trim(),
        amount: form.amount,
        payment_method: form.payment_method || null,
        payment_reference: form.payment_reference.trim() || null,
        vendor_name: form.vendor_name.trim() || null,
        recurring: form.recurring,
        recurrence_period: form.recurring && form.recurrence_period ? form.recurrence_period : null,
        notes: form.notes.trim() || null,
      }
      if (editId) {
        await updateExpense(supabase, editId, payload)
        toast.success('Biaya diupdate')
      } else {
        await insertExpense(supabase, {
          orgId: profile?.organization_id ?? 1,
          createdBy: profile?.id ?? null,
          payload,
        })
        toast.success('Biaya ditambahkan')
      }
      setOpen(false)
      reset()
      void load()
    } catch (err) {
      toast.error('Gagal simpan', { description: getErrorMessage(err) })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (e: OperationalExpense) => {
    if (!confirm(`Hapus biaya "${e.description}" sebesar ${formatRupiah(e.amount)} (${formatDate(e.expense_date)})?`)) return
    try {
      await deleteExpense(supabase, e.id)
      toast.success('Biaya dihapus')
      void load()
    } catch (err) {
      toast.error('Gagal hapus', { description: getErrorMessage(err) })
    }
  }

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return
    if (!confirm(`Hapus ${selectedIds.size} biaya terpilih?`)) return
    try {
      const n = await bulkDeleteExpenses(supabase, Array.from(selectedIds))
      toast.success(`${n} biaya dihapus`)
      void load()
    } catch (err) {
      toast.error('Gagal bulk hapus', { description: getErrorMessage(err) })
    }
  }

  const handleCopyRecurring = async () => {
    if (!confirm('Copy semua biaya rutin dari bulan lalu ke bulan ini? Item dengan kategori+vendor+amount yang sama akan di-skip.')) return
    setCopying(true)
    try {
      const result = await copyRecurringFromLastMonth(supabase, {
        orgId: profile?.organization_id ?? 1,
        createdBy: profile?.id ?? null,
        targetMonthFirstDay: firstOfThisMonth(),
      })
      if (result.source_count === 0) {
        toast.info('Tidak ada biaya rutin di bulan lalu untuk di-copy.')
      } else {
        toast.success(`${result.copied} biaya rutin di-copy. ${result.skipped_duplicate} skipped (sudah ada di bulan ini).`)
      }
      void load()
    } catch (err) {
      toast.error('Gagal copy', { description: getErrorMessage(err) })
    } finally {
      setCopying(false)
    }
  }

  // Filtered + computed
  const filtered = useMemo(() => {
    let list = expenses
    if (categoryFilter !== 'ALL') list = list.filter(e => e.category === categoryFilter)
    if (recurringFilter === 'RECURRING') list = list.filter(e => e.recurring)
    if (recurringFilter === 'ONETIME') list = list.filter(e => !e.recurring)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(e =>
        e.description.toLowerCase().includes(q) ||
        (e.vendor_name || '').toLowerCase().includes(q) ||
        EXPENSE_CATEGORY_LABEL[e.category].toLowerCase().includes(q)
      )
    }
    return list
  }, [expenses, search, categoryFilter, recurringFilter])

  const totalExpense = filtered.reduce((s, e) => s + Number(e.amount), 0)
  const recurringExpense = filtered.filter(e => e.recurring).reduce((s, e) => s + Number(e.amount), 0)
  const onetimeExpense = totalExpense - recurringExpense

  const byCategory = useMemo(() => {
    return filtered.reduce((acc, e) => {
      acc[e.category] = (acc[e.category] || 0) + Number(e.amount)
      return acc
    }, {} as Record<string, number>)
  }, [filtered])

  const topCategories = useMemo(() => {
    return Object.entries(byCategory)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
  }, [byCategory])

  const recurringMonthly = useMemo(() => {
    const monthly = recurringAll.filter(e => e.recurrence_period === 'MONTHLY')
    return {
      count: monthly.length,
      total: monthly.reduce((s, e) => s + Number(e.amount), 0),
    }
  }, [recurringAll])

  const toggleSelect = (id: number) => {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
  }

  const selectAllVisible = () => {
    if (selectedIds.size === filtered.length && filtered.length > 0) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filtered.map(e => e.id)))
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Receipt}
        title="Biaya Operasional"
        description={`${filtered.length} entry • Total ${formatRupiah(totalExpense)}`}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <DateRangePicker value={range} onChange={setRange} />
            {canWrite && (
              <>
                <Button
                  variant="outline" size="sm"
                  onClick={handleCopyRecurring}
                  disabled={copying || recurringMonthly.count === 0}
                  title={recurringMonthly.count === 0 ? 'Belum ada biaya rutin' : 'Copy biaya rutin dari bulan lalu'}
                >
                  {copying ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <CopyPlus className="w-3.5 h-3.5 mr-2" />}
                  Copy Bulan Lalu
                </Button>
                <Button
                  onClick={() => { reset(); setOpen(true) }}
                  className="bg-gradient-to-r from-zinc-600 to-zinc-600 hover:from-zinc-700 hover:to-zinc-700 text-white shadow-lg shadow-zinc-500/20"
                >
                  <Plus className="w-4 h-4 mr-2" />Tambah
                </Button>
              </>
            )}
          </div>
        }
      />

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 flex items-center gap-3 relative">
            <div className="p-2.5 bg-red-500/15 rounded-xl ring-1 ring-red-500/20">
              <TrendingDown className="w-5 h-5 text-red-500" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Periode</p>
              <p className="text-xl font-bold text-red-500">{formatRupiah(totalExpense)}</p>
              <p className="text-[10px] text-muted-foreground">{filtered.length} entry</p>
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 flex items-center gap-3 relative">
            <div className="p-2.5 bg-amber-500/15 rounded-xl ring-1 ring-amber-500/20">
              <Wallet className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Top Kategori</p>
              <p className="text-sm font-bold truncate max-w-[150px]">
                {topCategories[0] ? EXPENSE_CATEGORY_LABEL[topCategories[0][0] as OperationalExpenseCategory] : '—'}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {topCategories[0] ? formatRupiah(topCategories[0][1]) : 'belum ada'}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-zinc-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 flex items-center gap-3 relative">
            <div className="p-2.5 bg-zinc-500/15 rounded-xl ring-1 ring-zinc-500/20">
              <Repeat className="w-5 h-5 text-zinc-500" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Recurring vs One-time</p>
              <p className="text-sm font-bold">{formatRupiah(recurringExpense)}</p>
              <p className="text-[10px] text-muted-foreground">+ {formatRupiah(onetimeExpense)} one-time</p>
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-zinc-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 flex items-center gap-3 relative">
            <div className="p-2.5 bg-zinc-500/15 rounded-xl ring-1 ring-zinc-500/20">
              <BadgeCheck className="w-5 h-5 text-zinc-500" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Biaya Rutin Bulanan</p>
              <p className="text-sm font-bold">{formatRupiah(recurringMonthly.total)}</p>
              <p className="text-[10px] text-muted-foreground">{recurringMonthly.count} item • all-time</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Per category breakdown clickable */}
      {Object.keys(byCategory).length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {Object.entries(byCategory).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => {
            const pct = totalExpense > 0 ? (amt / totalExpense) * 100 : 0
            const isActive = categoryFilter === cat
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setCategoryFilter(isActive ? 'ALL' : cat as OperationalExpenseCategory)}
                className={`text-left rounded-lg border bg-card p-3 transition-all hover:shadow-md ${isActive ? 'ring-2 ring-zinc-500 border-zinc-500/50' : 'hover:border-zinc-500/30'}`}
              >
                <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground truncate">
                  {EXPENSE_CATEGORY_LABEL[cat as OperationalExpenseCategory]}
                </p>
                <p className="text-base font-bold mt-1">{formatRupiah(amt)}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{pct.toFixed(0)}% dari total</p>
              </button>
            )
          })}
        </div>
      )}

      {/* Filter row */}
      <Card>
        <CardContent className="pt-4 pb-4 flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Cari deskripsi, vendor, atau kategori..."
              className="pl-9"
            />
          </div>
          <Select value={categoryFilter} onValueChange={v => v && setCategoryFilter(v as CategoryFilter)}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent className="w-[240px]">
              <SelectItem value="ALL">Semua kategori</SelectItem>
              {EXPENSE_CATEGORIES.map(c => (
                <SelectItem key={c} value={c}>{EXPENSE_CATEGORY_LABEL[c]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={recurringFilter} onValueChange={v => v && setRecurringFilter(v as RecurringFilter)}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent className="w-[200px]">
              <SelectItem value="ALL">Recurring + One-time</SelectItem>
              <SelectItem value="RECURRING">Recurring saja</SelectItem>
              <SelectItem value="ONETIME">One-time saja</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Bulk actions banner */}
      {selectedIds.size > 0 && isOwner && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="pt-3 pb-3 flex items-center gap-3">
            <p className="text-sm">{selectedIds.size} biaya terpilih</p>
            <Button variant="outline" size="sm" onClick={() => setSelectedIds(new Set())}>Batal</Button>
            <Button
              variant="outline" size="sm"
              onClick={handleBulkDelete}
              className="ml-auto text-red-500 border-red-500/30 hover:bg-red-500/10"
            >
              <Trash2 className="w-3.5 h-3.5 mr-2" />Hapus Terpilih
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {isOwner && (
                  <TableHead className="w-10">
                    <Checkbox
                      checked={filtered.length > 0 && selectedIds.size === filtered.length}
                      onCheckedChange={selectAllVisible}
                    />
                  </TableHead>
                )}
                <TableHead>Tanggal</TableHead>
                <TableHead>Kategori</TableHead>
                <TableHead>Deskripsi</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-center">Recurring</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={isOwner ? 9 : 8} className="py-3">
                      <div className="h-4 bg-muted animate-pulse rounded w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isOwner ? 9 : 8} className="p-0">
                    <EmptyState
                      icon={Receipt}
                      title="Belum ada biaya di periode ini"
                      description="Klik 'Tambah' untuk catat biaya operasional rutin (sewa, gaji, listrik, dll)."
                    />
                  </TableCell>
                </TableRow>
              ) : filtered.map(e => (
                <TableRow key={e.id}>
                  {isOwner && (
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.has(e.id)}
                        onCheckedChange={() => toggleSelect(e.id)}
                      />
                    </TableCell>
                  )}
                  <TableCell className="text-sm whitespace-nowrap">{formatDate(e.expense_date)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-xs ${EXPENSE_CATEGORY_COLOR[e.category]}`}>
                      {EXPENSE_CATEGORY_LABEL[e.category]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm max-w-[280px]">
                    <div className="truncate">{e.description}</div>
                    {e.notes && <div className="text-[10px] text-muted-foreground truncate">{e.notes}</div>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{e.vendor_name || '—'}</TableCell>
                  <TableCell className="font-semibold text-right whitespace-nowrap">{formatRupiah(e.amount)}</TableCell>
                  <TableCell className="text-center">
                    {e.recurring ? (
                      <Badge variant="outline" className="bg-zinc-500/10 text-zinc-600 border-zinc-500/30 text-[10px]">
                        <Repeat className="w-3 h-3 mr-1" />
                        {e.recurrence_period ? RECURRENCE_PERIOD_LABEL[e.recurrence_period] : 'Rutin'}
                      </Badge>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">one-time</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {e.payment_method ? (
                      <div>
                        <div>{EXPENSE_PAYMENT_METHOD_LABEL[e.payment_method as keyof typeof EXPENSE_PAYMENT_METHOD_LABEL] || e.payment_method}</div>
                        {e.payment_reference && (
                          <div className="text-[10px] text-muted-foreground font-mono truncate">{e.payment_reference}</div>
                        )}
                      </div>
                    ) : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {canWrite && (
                        <Button variant="ghost" size="icon" title="Edit" onClick={() => openEdit(e)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {isOwner && (
                        <Button variant="ghost" size="icon" title="Hapus" onClick={() => handleDelete(e)} className="text-red-500">
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) reset() }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editId ? 'Edit' : 'Tambah'} Biaya Operasional</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Tanggal *</Label>
                <Input
                  type="date"
                  value={form.expense_date}
                  onChange={e => setForm({ ...form, expense_date: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Kategori *</Label>
                <Select value={form.category} onValueChange={v => v && setForm({ ...form, category: v as OperationalExpenseCategory })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EXPENSE_CATEGORIES.map(c => (
                      <SelectItem key={c} value={c}>{EXPENSE_CATEGORY_LABEL[c]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Deskripsi *</Label>
              <Input
                value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })}
                placeholder="e.g. Sewa gudang Mei 2026"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Vendor / Penerima</Label>
                <Input
                  value={form.vendor_name}
                  onChange={e => setForm({ ...form, vendor_name: e.target.value })}
                  placeholder="e.g. PT Listrik Negara"
                />
              </div>
              <div className="space-y-2">
                <Label>Jumlah (Rp) *</Label>
                <Input
                  type="number"
                  value={form.amount}
                  onChange={e => setForm({ ...form, amount: Number(e.target.value) })}
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Metode Pembayaran</Label>
                <Select value={form.payment_method || 'NONE'} onValueChange={v => setForm({ ...form, payment_method: !v || v === 'NONE' ? '' : v })}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">(tidak ditentukan)</SelectItem>
                    {EXPENSE_PAYMENT_METHODS.map(m => (
                      <SelectItem key={m} value={m}>{EXPENSE_PAYMENT_METHOD_LABEL[m]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>No. Receipt / Referensi</Label>
                <Input
                  value={form.payment_reference}
                  onChange={e => setForm({ ...form, payment_reference: e.target.value })}
                  placeholder="opsional"
                />
              </div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="exp-recurring"
                  checked={form.recurring}
                  onCheckedChange={v => setForm({ ...form, recurring: v === true, recurrence_period: v === true ? form.recurrence_period || 'MONTHLY' : '' })}
                />
                <Label htmlFor="exp-recurring" className="cursor-pointer text-sm">
                  Biaya rutin (recurring) — bisa di-copy ke bulan depan
                </Label>
              </div>
              {form.recurring && (
                <div className="space-y-2 pl-6">
                  <Label className="text-xs">Periode</Label>
                  <Select value={form.recurrence_period || 'MONTHLY'} onValueChange={v => v && setForm({ ...form, recurrence_period: v as 'MONTHLY' | 'WEEKLY' | 'YEARLY' })}>
                    <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {RECURRENCE_PERIODS.map(p => (
                        <SelectItem key={p} value={p}>{RECURRENCE_PERIOD_LABEL[p]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
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
            <Button
              type="submit"
              className="w-full bg-gradient-to-r from-zinc-600 to-zinc-600 hover:from-zinc-700 hover:to-zinc-700 text-white shadow-lg shadow-zinc-500/20"
              disabled={saving}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Simpan
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
