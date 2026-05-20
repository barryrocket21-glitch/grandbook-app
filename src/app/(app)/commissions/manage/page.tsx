'use client'
import { useState, useEffect, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { toast } from 'sonner'
import {
  Coins, Loader2, Search, BadgeDollarSign, AlertTriangle,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { formatRupiah, formatDate, formatDateTime } from '@/lib/format'
import {
  STATUS_BADGE_COLOR, STATUS_LABEL,
  COMMISSION_STATUS_BADGE_COLOR, COMMISSION_STATUS_LABEL,
  COMMISSION_PAYMENT_METHODS, COMMISSION_PAYMENT_METHOD_LABEL,
  type CommissionPaymentMethodEnum,
} from '@/lib/schemas/settings'
import {
  listCommissions,
  computeStats,
  periodToDates,
  markCommissionPaid,
  bulkMarkCommissionPaid,
  type CommissionRow,
} from '@/lib/supabase/queries/commissions'
import { type CommissionV2Status, type Profile } from '@/lib/types'

const supabase = createClient()

type Period = 'this_month' | 'last_month' | 'all' | 'custom'
type TabKey = 'EARNED' | 'PAID' | 'ESTIMATED' | 'ALL'

const TAB_TO_FILTER: Record<TabKey, CommissionV2Status[] | undefined> = {
  EARNED: ['EARNED'],
  PAID: ['PAID'],
  ESTIMATED: ['ESTIMATED'],
  ALL: undefined,
}

export default function ManageCommissionsPage() {
  const { role, loading: authLoading } = useAuth()
  const canManageCommissions = role === 'owner' || role === 'admin'

  const [tab, setTab] = useState<TabKey>('EARNED')
  const [rows, setRows] = useState<CommissionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [users, setUsers] = useState<Pick<Profile, 'id' | 'full_name' | 'role'>[]>([])

  // Filters
  const [period, setPeriod] = useState<Period>('this_month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [userFilter, setUserFilter] = useState<string>('ALL')
  const [search, setSearch] = useState('')

  // Selection + dialog
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogTargetIds, setDialogTargetIds] = useState<number[]>([])
  const [paymentMethod, setPaymentMethod] = useState<CommissionPaymentMethodEnum>('TRANSFER')
  const [paymentReference, setPaymentReference] = useState('')
  const [paymentNote, setPaymentNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // ---------- Effects ----------
  useEffect(() => {
    const loadUsers = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, role')
        .in('role', ['cs', 'advertiser', 'admin'])
        .eq('active', true)
        .order('full_name')
      setUsers((data || []) as typeof users)
    }
    if (canManageCommissions) void loadUsers()
  }, [canManageCommissions])

  const load = useCallback(async () => {
    if (!canManageCommissions) return
    setLoading(true)
    try {
      const { dateFrom, dateTo } = periodToDates(period, customFrom || null, customTo || null)
      const data = await listCommissions(supabase, {
        userId: userFilter === 'ALL' ? null : userFilter,
        statuses: TAB_TO_FILTER[tab],
        dateFrom,
        dateTo,
        search,
      })
      setRows(data)
      // Drop selection of rows no longer in result set
      setSelectedIds((prev) => {
        const next = new Set<number>()
        for (const r of data) if (prev.has(r.id)) next.add(r.id)
        return next
      })
    } finally {
      setLoading(false)
    }
  }, [canManageCommissions, tab, period, customFrom, customTo, userFilter, search])

  useEffect(() => {
    if (!authLoading && canManageCommissions) void load()
  }, [authLoading, canManageCommissions, load])

  const stats = useMemo(() => computeStats(rows), [rows])

  // ---------- Selection logic ----------
  // Only EARNED rows selectable (only EARNED can be marked PAID)
  const selectableIds = useMemo(
    () => rows.filter((r) => r.status === 'EARNED').map((r) => r.id),
    [rows]
  )
  const allSelectableSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id))
  const toggleAllSelectable = (checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) for (const id of selectableIds) next.add(id)
      else for (const id of selectableIds) next.delete(id)
      return next
    })
  }
  const toggleOne = (id: number, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  // ---------- Mark paid ----------
  const openSingleDialog = (id: number) => {
    setDialogTargetIds([id])
    setPaymentMethod('TRANSFER')
    setPaymentReference('')
    setPaymentNote('')
    setDialogOpen(true)
  }
  const openBulkDialog = () => {
    if (selectedIds.size === 0) return
    setDialogTargetIds(Array.from(selectedIds))
    setPaymentMethod('TRANSFER')
    setPaymentReference('')
    setPaymentNote('')
    setDialogOpen(true)
  }
  const dialogTotal = useMemo(() => {
    let sum = 0
    for (const r of rows) if (dialogTargetIds.includes(r.id)) sum += Number(r.amount) || 0
    return sum
  }, [rows, dialogTargetIds])

  const submitPayment = async () => {
    if (dialogTargetIds.length === 0) return
    setSubmitting(true)
    try {
      const args = {
        paymentMethod,
        paymentReference: paymentReference.trim() || null,
        paymentNote: paymentNote.trim() || null,
      }
      if (dialogTargetIds.length === 1) {
        await markCommissionPaid(supabase, dialogTargetIds[0], args)
        toast.success('Komisi di-mark PAID')
      } else {
        const updated = await bulkMarkCommissionPaid(supabase, dialogTargetIds, args)
        toast.success(`${updated} komisi di-mark PAID`)
      }
      setDialogOpen(false)
      setSelectedIds(new Set())
      void load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error('Gagal mark paid', { description: msg })
    } finally {
      setSubmitting(false)
    }
  }

  // ---------- Permission gate ----------
  if (!authLoading && !canManageCommissions) {
    return (
      <div className="space-y-6">
        <PageHeader icon={Coins} title="Kelola Komisi" />
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          Hanya owner &amp; admin yang bisa mengelola pencairan komisi.
          Untuk lihat komisi Anda sendiri, buka <Link href="/commissions/my" className="text-violet-500 hover:underline">/commissions/my</Link>.
        </CardContent></Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Coins}
        title="Kelola Komisi"
        description="Mark komisi EARNED sebagai PAID setelah ditransfer ke CS / advertiser. ESTIMATED tidak bisa di-mark paid (order belum DITERIMA)."
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Pending Pencairan (Earned)" value={formatRupiah(stats.earnedTotal)} sub={`${stats.earnedCount} komisi`} color="amber" />
        <StatCard label="Sudah Dicairkan" value={formatRupiah(stats.paidTotal)} sub={`${stats.paidCount} komisi`} color="emerald" />
        <StatCard label="Estimated (belum confirmed)" value={formatRupiah(stats.estimatedTotal)} sub={`${stats.estimatedCount} komisi`} color="blue" />
        <StatCard label="Cancelled" value={String(stats.cancelledCount)} sub="komisi" color="zinc" />
      </div>

      <Tabs value={tab} onValueChange={(v) => v && setTab(v as TabKey)}>
        <TabsList>
          <TabsTrigger value="EARNED">Pending Pencairan</TabsTrigger>
          <TabsTrigger value="PAID">Paid</TabsTrigger>
          <TabsTrigger value="ESTIMATED">Estimated</TabsTrigger>
          <TabsTrigger value="ALL">Semua</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card>
        <CardContent className="pt-4 pb-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">User</Label>
              <Select value={userFilter} onValueChange={(v) => v && setUserFilter(v)}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Semua user">
                  {(value: string | null) => {
                    if (!value || value === 'ALL') return 'Semua user'
                    return users.find((u) => u.id === value)?.full_name ?? value
                  }}
                </SelectValue></SelectTrigger>
                <SelectContent className="w-[260px]">
                  <SelectItem value="ALL">Semua user</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.full_name} ({u.role})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Periode</Label>
              <Select value={period} onValueChange={(v) => v && setPeriod(v as Period)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="this_month">Bulan Ini</SelectItem>
                  <SelectItem value="last_month">Bulan Lalu</SelectItem>
                  <SelectItem value="all">Semua Waktu</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {period === 'custom' && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">Dari</Label>
                  <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Sampai</Label>
                  <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
                </div>
              </>
            )}
            <div className="space-y-1 lg:col-span-2">
              <Label className="text-xs">Cari</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Order# / customer..." className="pl-9" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedIds.size > 0 && (
        <Card className="border-violet-500/30 bg-violet-500/5">
          <CardContent className="pt-3 pb-3 flex flex-wrap items-center gap-2 justify-between">
            <div className="text-sm">
              <span className="font-bold text-violet-500">{selectedIds.size}</span> komisi terpilih
            </div>
            <Button onClick={openBulkDialog} className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white">
              <BadgeDollarSign className="w-4 h-4 mr-1" />Bulk Mark Paid
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  {tab === 'EARNED' && (
                    <Checkbox
                      checked={allSelectableSelected}
                      onCheckedChange={(v) => toggleAllSelectable(!!v)}
                      disabled={selectableIds.length === 0}
                    />
                  )}
                </TableHead>
                <TableHead>User</TableHead>
                <TableHead>Order#</TableHead>
                <TableHead>Tanggal</TableHead>
                <TableHead>Status Order</TableHead>
                <TableHead className="text-right">Total Order</TableHead>
                <TableHead className="text-right">Komisi</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading || authLoading ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                </TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="p-0">
                  <EmptyState
                    icon={Coins}
                    title={tab === 'EARNED' ? 'Tidak ada komisi pending pencairan' : 'Tidak ada komisi'}
                    description="Komisi otomatis terhitung saat order DITERIMA. Untuk re-trigger, cek status order di /orders/list."
                  />
                </TableCell></TableRow>
              ) : rows.map((c) => {
                const canPay = c.status === 'EARNED'
                const checked = selectedIds.has(c.id)
                return (
                  <TableRow key={c.id} className={checked ? 'bg-violet-500/5' : ''}>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {canPay && (
                        <Checkbox checked={checked} onCheckedChange={(v) => toggleOne(c.id, !!v)} />
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      <div className="font-medium">{c.user?.full_name || c.user_id.slice(0, 8)}</div>
                      <div className="text-[10px] text-muted-foreground">{c.role}</div>
                    </TableCell>
                    <TableCell>
                      <Link href={`/orders/${c.order_id}`} className="font-mono text-xs hover:underline text-violet-500">
                        {c.order?.order_number || `#${c.order_id}`}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {c.order?.order_date ? formatDate(c.order.order_date) : '-'}
                    </TableCell>
                    <TableCell>
                      {c.order?.status && (
                        <Badge variant="outline" className={`text-[10px] ${STATUS_BADGE_COLOR[c.order.status]}`}>
                          {STATUS_LABEL[c.order.status]}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {c.order ? formatRupiah(Number(c.order.total)) : '-'}
                    </TableCell>
                    <TableCell className="text-right text-sm font-semibold">
                      {formatRupiah(Number(c.amount))}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] ${COMMISSION_STATUS_BADGE_COLOR[c.status]}`}>
                        {COMMISSION_STATUS_LABEL[c.status]}
                      </Badge>
                      {c.status === 'PAID' && c.paid_at && (
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {formatDateTime(c.paid_at)}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {canPay ? (
                        <Button size="sm" variant="outline" onClick={() => openSingleDialog(c.id)}>
                          <BadgeDollarSign className="w-3.5 h-3.5 mr-1" />Pay
                        </Button>
                      ) : c.status === 'PAID' ? (
                        <span className="text-[10px] text-muted-foreground">{c.payment_method || '-'}{c.payment_reference ? ` · ${c.payment_reference}` : ''}</span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground italic">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Mark Komisi sebagai PAID</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="text-sm space-y-1">
              <div>Total komisi: <span className="font-bold">{dialogTargetIds.length} baris</span></div>
              <div>Total nilai: <span className="font-bold text-emerald-600">{formatRupiah(dialogTotal)}</span></div>
            </div>

            <div className="text-xs p-3 rounded bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <p>
                Hanya komisi status <span className="font-mono">EARNED</span> yang akan di-update. Setelah di-mark PAID,
                komisi tidak bisa kembali ke status sebelumnya — preserved untuk audit trail.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Payment Method *</Label>
              <Select value={paymentMethod} onValueChange={(v) => v && setPaymentMethod(v as CommissionPaymentMethodEnum)}>
                <SelectTrigger><SelectValue>
                  {(value: string | null) => COMMISSION_PAYMENT_METHOD_LABEL[value as CommissionPaymentMethodEnum] || 'Pilih method'}
                </SelectValue></SelectTrigger>
                <SelectContent className="w-[220px]">
                  {COMMISSION_PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>{COMMISSION_PAYMENT_METHOD_LABEL[m]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Payment Reference</Label>
              <Input
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
                placeholder="e.g. BCA-12345 / nomor transfer"
                maxLength={120}
              />
              <p className="text-[10px] text-muted-foreground">Opsional. Maks 120 karakter.</p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Catatan</Label>
              <Input
                value={paymentNote}
                onChange={(e) => setPaymentNote(e.target.value)}
                placeholder="e.g. Pencairan Mei 2026"
                maxLength={500}
              />
              <p className="text-[10px] text-muted-foreground">Opsional. Maks 500 karakter.</p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>Batal</Button>
              <Button
                onClick={submitPayment}
                disabled={submitting}
                className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white"
              >
                {submitting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                Konfirmasi Pencairan
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function StatCard({ label, value, sub, color }: {
  label: string
  value: string
  sub: string
  color: 'blue' | 'amber' | 'emerald' | 'zinc'
}) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-500/10 border-blue-500/30 text-blue-600',
    amber: 'bg-amber-500/10 border-amber-500/30 text-amber-600',
    emerald: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600',
    zinc: 'bg-zinc-500/10 border-zinc-500/30 text-zinc-600',
  }
  return (
    <div className={`p-3 rounded border ${colorMap[color]}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-bold mt-1">{value}</div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>
    </div>
  )
}
