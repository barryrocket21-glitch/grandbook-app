'use client'
// =============================================================
// Kelola Komisi (rewrite) — per-CS-per-periode batch settle.
//
// Filosofi: komisi auto-follow status order (DITERIMA = EARNED, RETUR/
// CANCEL/FAKE = HANGUS, masih jalan = PENDING). Owner cuma 1 click per
// CS per payday buat tandain "udah ditransfer" — bukan per-order.
//
// Halaman ini surface: per CS di periode terpilih, berapa yang Earned
// (perlu dibayar), berapa yang Sudah Dibayar, dan tombol bayar batch.
// =============================================================
import { useState, useEffect, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { DateRangePicker, thisMonth, type DateRange } from '@/components/ui/date-range-picker'
import { toast } from 'sonner'
import { Coins, Loader2, Settings, Info, BadgeDollarSign } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { formatRupiah, formatDate } from '@/lib/format'
import {
  COMMISSION_PAYMENT_METHODS, COMMISSION_PAYMENT_METHOD_LABEL,
  type CommissionPaymentMethodEnum,
} from '@/lib/schemas/settings'
import {
  listCommissions, bulkMarkCommissionPaid, type CommissionRow,
} from '@/lib/supabase/queries/commissions'
import type { UserRole } from '@/lib/types'

const supabase = createClient()

interface CsAggregate {
  user_id: string
  user_name: string
  role: UserRole
  earned_unpaid_total: number
  earned_unpaid_count: number
  earned_unpaid_ids: number[]
  earned_unpaid_orders: Array<{ id: number; order_number: string; customer_name: string; amount: number; order_date: string }>
  paid_total: number
  paid_count: number
  cancelled_count: number
}

export default function ManageCommissionsPage() {
  const { role, loading: authLoading } = useAuth()
  const canManage = role === 'owner' || role === 'admin'

  const [range, setRange] = useState<DateRange>(thisMonth)
  const [rangeReady, setRangeReady] = useState(false)
  const [rows, setRows] = useState<CommissionRow[]>([])
  const [loading, setLoading] = useState(true)

  // Pay dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogTarget, setDialogTarget] = useState<CsAggregate | null>(null)
  const [paymentMethod, setPaymentMethod] = useState<CommissionPaymentMethodEnum>('TRANSFER')
  const [paymentReference, setPaymentReference] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    setRange(thisMonth())
    setRangeReady(true)
  }, [])

  const load = useCallback(async () => {
    if (!canManage || !rangeReady) return
    setLoading(true)
    try {
      const data = await listCommissions(supabase, {
        dateFrom: range.from,
        dateTo: range.to,
      })
      setRows(data)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error('Gagal load komisi', { description: msg })
    } finally {
      setLoading(false)
    }
  }, [canManage, rangeReady, range.from, range.to])

  useEffect(() => {
    if (!authLoading && canManage) void load()
  }, [authLoading, canManage, load])

  // Aggregate per CS — drives the main table.
  const aggregates = useMemo<CsAggregate[]>(() => {
    const map = new Map<string, CsAggregate>()
    for (const r of rows) {
      const uid = r.user_id
      let agg = map.get(uid)
      if (!agg) {
        agg = {
          user_id: uid,
          user_name: r.user?.full_name || uid.slice(0, 8),
          role: r.role,
          earned_unpaid_total: 0,
          earned_unpaid_count: 0,
          earned_unpaid_ids: [],
          earned_unpaid_orders: [],
          paid_total: 0,
          paid_count: 0,
          cancelled_count: 0,
        }
        map.set(uid, agg)
      }
      const amt = Number(r.amount) || 0
      if (r.status === 'EARNED') {
        agg.earned_unpaid_total += amt
        agg.earned_unpaid_count++
        agg.earned_unpaid_ids.push(r.id)
        if (r.order) {
          agg.earned_unpaid_orders.push({
            id: r.order.id,
            order_number: r.order.order_number,
            customer_name: r.order.customer_name,
            amount: amt,
            order_date: r.order.order_date,
          })
        }
      } else if (r.status === 'PAID') {
        agg.paid_total += amt
        agg.paid_count++
      } else if (r.status === 'CANCELLED') {
        agg.cancelled_count++
      }
    }
    return Array.from(map.values()).sort((a, b) => b.earned_unpaid_total - a.earned_unpaid_total)
  }, [rows])

  const totals = useMemo(() => {
    let earnedUnpaid = 0, paid = 0, cancelled = 0, ordersUnpaid = 0
    for (const a of aggregates) {
      earnedUnpaid += a.earned_unpaid_total
      paid += a.paid_total
      cancelled += a.cancelled_count
      ordersUnpaid += a.earned_unpaid_count
    }
    return { earnedUnpaid, paid, cancelled, ordersUnpaid }
  }, [aggregates])

  const openPayDialog = (agg: CsAggregate) => {
    if (agg.earned_unpaid_count === 0) return
    setDialogTarget(agg)
    setPaymentMethod('TRANSFER')
    setPaymentReference('')
    setDialogOpen(true)
  }

  const submitPayment = async () => {
    if (!dialogTarget) return
    setSubmitting(true)
    try {
      const updated = await bulkMarkCommissionPaid(
        supabase,
        dialogTarget.earned_unpaid_ids,
        {
          paymentMethod,
          paymentReference: paymentReference.trim() || null,
          paymentNote: `Pembayaran komisi ${range.from}..${range.to} untuk ${dialogTarget.user_name}`,
        }
      )
      toast.success(`${updated} order komisi ditandai Sudah Dibayar (${formatRupiah(dialogTarget.earned_unpaid_total)})`)
      setDialogOpen(false)
      setDialogTarget(null)
      void load()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error('Gagal mark paid', { description: msg })
    } finally {
      setSubmitting(false)
    }
  }

  // ---------- Permission gate ----------
  if (!authLoading && !canManage) {
    return (
      <div className="space-y-6">
        <PageHeader icon={Coins} title="Kelola Komisi" />
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          Hanya owner &amp; admin yang bisa kelola pencairan komisi.
          Untuk lihat komisi Anda sendiri, buka{' '}
          <Link href="/commissions/my" className="text-violet-500 hover:underline">/commissions/my</Link>.
        </CardContent></Card>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Coins}
        title="Kelola Komisi"
        description="Komisi auto-follow status order. 1 klik per CS per gajian — tinggal pilih periode."
        actions={
          <div className="flex items-center gap-2">
            <DateRangePicker value={range} onChange={setRange} />
            <Link
              href="/settings/commission-rules"
              className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground h-8 px-3 text-sm transition-colors"
            >
              <Settings className="w-3.5 h-3.5" />Aturan Komisi
            </Link>
          </div>
        }
      />

      {/* Info banner — cara kerja */}
      <div className="text-xs bg-blue-500/5 border border-blue-500/20 rounded-lg p-3 flex gap-2 items-start">
        <Info className="w-4 h-4 mt-0.5 shrink-0 text-blue-600" />
        <div className="space-y-0.5 text-muted-foreground">
          <div>Order <strong className="text-foreground">DITERIMA</strong> → komisi auto-EARNED (perlu dibayar). <strong className="text-foreground">RETUR/CANCEL/FAKE</strong> → auto-HANGUS. Order masih di jalan belum keitung.</div>
          <div>Klik tombol <strong className="text-foreground">Bayar</strong> di baris CS untuk batch-tandai semua komisi belum dibayar di periode ini → "Sudah Dibayar."</div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Belum Dibayar" value={formatRupiah(totals.earnedUnpaid)} sub={`${totals.ordersUnpaid} order`} color="amber" />
        <StatCard label="Sudah Dibayar" value={formatRupiah(totals.paid)} sub="Periode ini" color="emerald" />
        <StatCard label="Hangus" value={String(totals.cancelled)} sub="komisi (Retur/Cancel/Fake)" color="zinc" />
        <StatCard label="Total Earned" value={formatRupiah(totals.earnedUnpaid + totals.paid)} sub="Sebelum dibayar" color="violet" />
      </div>

      {/* Per-CS table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>CS / Advertiser</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Belum Dibayar</TableHead>
                <TableHead className="text-right">Sudah Dibayar</TableHead>
                <TableHead className="text-right">Hangus</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading || authLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                </TableCell></TableRow>
              ) : aggregates.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="p-0">
                  <EmptyState
                    icon={Coins}
                    title="Belum ada komisi di periode ini"
                    description="Komisi auto-terhitung saat order DITERIMA. Pastikan Aturan Komisi sudah di-setup di Aturan Komisi → atau cek status order."
                  />
                </TableCell></TableRow>
              ) : aggregates.map((agg) => (
                <TableRow key={agg.user_id}>
                  <TableCell className="text-sm font-medium">{agg.user_name}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px] capitalize">{agg.role}</Badge>
                  </TableCell>
                  <TableCell className="text-right text-sm font-semibold text-amber-600">
                    {formatRupiah(agg.earned_unpaid_total)}
                    <div className="text-[10px] text-muted-foreground font-normal">{agg.earned_unpaid_count} order</div>
                  </TableCell>
                  <TableCell className="text-right text-sm text-emerald-600">
                    {formatRupiah(agg.paid_total)}
                    <div className="text-[10px] text-muted-foreground font-normal">{agg.paid_count} order</div>
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {agg.cancelled_count}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      disabled={agg.earned_unpaid_count === 0}
                      onClick={() => openPayDialog(agg)}
                      className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white disabled:opacity-30 disabled:bg-none disabled:bg-zinc-500/20 disabled:text-muted-foreground"
                    >
                      <BadgeDollarSign className="w-3.5 h-3.5 mr-1" />
                      Bayar {agg.earned_unpaid_count > 0 ? `${agg.earned_unpaid_count} order` : ''}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pay confirmation dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Bayar Komisi {dialogTarget?.user_name}
            </DialogTitle>
          </DialogHeader>
          {dialogTarget && (
            <div className="space-y-3">
              <div className="text-sm space-y-1 bg-muted/30 rounded p-3">
                <div>Periode: <span className="font-medium">{range.from} s/d {range.to}</span></div>
                <div>Total order: <span className="font-bold">{dialogTarget.earned_unpaid_count}</span></div>
                <div>Total bayar: <span className="font-bold text-emerald-600">{formatRupiah(dialogTarget.earned_unpaid_total)}</span></div>
              </div>

              {/* Order drilldown */}
              <div className="space-y-1">
                <Label className="text-xs">Order yang akan ditandai dibayar</Label>
                <div className="max-h-40 overflow-y-auto border rounded text-xs divide-y">
                  {dialogTarget.earned_unpaid_orders.map((o) => (
                    <div key={o.id} className="px-2.5 py-1.5 flex justify-between gap-2">
                      <Link href={`/orders/${o.id}`} target="_blank" className="font-mono text-violet-500 hover:underline shrink-0">
                        {o.order_number}
                      </Link>
                      <span className="text-muted-foreground truncate flex-1">{o.customer_name}</span>
                      <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{formatDate(o.order_date)}</span>
                      <span className="font-semibold tabular-nums shrink-0">{formatRupiah(o.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Metode</Label>
                <Select value={paymentMethod} onValueChange={(v) => v && setPaymentMethod(v as CommissionPaymentMethodEnum)}>
                  <SelectTrigger><SelectValue>
                    {(value: string | null) => COMMISSION_PAYMENT_METHOD_LABEL[value as CommissionPaymentMethodEnum] || 'Pilih'}
                  </SelectValue></SelectTrigger>
                  <SelectContent className="w-[220px]">
                    {COMMISSION_PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m} value={m}>{COMMISSION_PAYMENT_METHOD_LABEL[m]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Reference (opsional)</Label>
                <Input
                  value={paymentReference}
                  onChange={(e) => setPaymentReference(e.target.value)}
                  placeholder="e.g. Transfer BCA 1 Juni 2026"
                  maxLength={120}
                />
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>Batal</Button>
                <Button
                  onClick={submitPayment}
                  disabled={submitting}
                  className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white"
                >
                  {submitting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                  Konfirmasi Bayar {formatRupiah(dialogTarget.earned_unpaid_total)}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function StatCard({ label, value, sub, color }: {
  label: string
  value: string
  sub: string
  color: 'amber' | 'emerald' | 'zinc' | 'violet'
}) {
  const colorMap: Record<string, string> = {
    amber: 'bg-amber-500/10 border-amber-500/30 text-amber-600',
    emerald: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600',
    zinc: 'bg-zinc-500/10 border-zinc-500/30 text-zinc-500',
    violet: 'bg-violet-500/10 border-violet-500/30 text-violet-600',
  }
  return (
    <div className={`p-3 rounded border ${colorMap[color]}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-bold mt-1 tabular-nums">{value}</div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>
    </div>
  )
}
