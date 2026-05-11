'use client'
import { useState, useEffect, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EmptyState } from '@/components/ui/empty-state'
import { Coins, Loader2, ChevronRight } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { formatRupiah, formatDate } from '@/lib/format'
import { STATUS_BADGE_COLOR, STATUS_LABEL, COMMISSION_STATUS_BADGE_COLOR, COMMISSION_STATUS_LABEL } from '@/lib/schemas/settings'
import {
  listCommissions,
  computeStats,
  periodToDates,
  type CommissionRow,
} from '@/lib/supabase/queries/commissions'
import { COMMISSION_V2_STATUSES, type CommissionV2Status } from '@/lib/types'

const supabase = createClient()

type Period = 'this_month' | 'last_month' | 'all' | 'custom'

export default function MyCommissionsPage() {
  const { user, loading: authLoading } = useAuth()
  const [rows, setRows] = useState<CommissionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<Period>('this_month')
  const [customFrom, setCustomFrom] = useState<string>('')
  const [customTo, setCustomTo] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | CommissionV2Status>('ALL')

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const { dateFrom, dateTo } = periodToDates(period, customFrom || null, customTo || null)
      const data = await listCommissions(supabase, {
        userId: user.id,
        statuses: statusFilter === 'ALL' ? undefined : [statusFilter],
        dateFrom,
        dateTo,
      })
      setRows(data)
    } finally {
      setLoading(false)
    }
  }, [user, period, customFrom, customTo, statusFilter])

  useEffect(() => {
    if (!authLoading && user) void load()
  }, [authLoading, user, load])

  const stats = useMemo(() => computeStats(rows), [rows])

  if (!authLoading && !user) {
    return (
      <div className="space-y-6">
        <PageHeader icon={Coins} title="Komisi Saya" />
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          Login diperlukan untuk melihat komisi.
        </CardContent></Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Coins}
        title="Komisi Saya"
        description="Komisi otomatis terhitung saat order yang Anda handle status DITERIMA."
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Estimated" value={formatRupiah(stats.estimatedTotal)} sub={`${stats.estimatedCount} order`} color="blue" />
        <StatCard label="Pending Pencairan (Earned)" value={formatRupiah(stats.earnedTotal)} sub={`${stats.earnedCount} order`} color="amber" />
        <StatCard label="Sudah Dicairkan" value={formatRupiah(stats.paidTotal)} sub={`${stats.paidCount} order`} color="emerald" />
        <StatCard label="Cancelled" value={String(stats.cancelledCount)} sub="order" color="zinc" />
      </div>

      <Card>
        <CardContent className="pt-4 pb-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-4 gap-3">
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
            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <Select value={statusFilter} onValueChange={(v) => v && setStatusFilter(v as 'ALL' | CommissionV2Status)}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Semua status">
                  {(value: string | null) => {
                    if (!value || value === 'ALL') return 'Semua status'
                    return COMMISSION_STATUS_LABEL[value as CommissionV2Status] ?? value
                  }}
                </SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Semua status</SelectItem>
                  {COMMISSION_V2_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{COMMISSION_STATUS_LABEL[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order#</TableHead>
                <TableHead>Tanggal</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status Order</TableHead>
                <TableHead className="text-right">Total Order</TableHead>
                <TableHead className="text-right">Komisi</TableHead>
                <TableHead>Status Komisi</TableHead>
                <TableHead>Paid At</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading || authLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                </TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="p-0">
                  <EmptyState
                    icon={Coins}
                    title="Belum ada komisi"
                    description="Komisi otomatis terisi saat order yang Anda handle (sebagai CS, Advertiser, atau Admin) status DITERIMA. Hubungi owner kalau ada order yang seharusnya menghasilkan komisi tapi tidak muncul."
                  />
                </TableCell></TableRow>
              ) : rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link href={`/orders/${c.order_id}`} className="font-mono text-xs hover:underline text-violet-500">
                      {c.order?.order_number || `#${c.order_id}`}
                    </Link>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {c.order?.order_date ? formatDate(c.order.order_date) : '-'}
                  </TableCell>
                  <TableCell className="text-sm">{c.order?.customer_name || '-'}</TableCell>
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
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {c.paid_at ? (
                      <div className="space-y-0.5">
                        <div>{formatDate(c.paid_at)}</div>
                        {c.payment_method && (
                          <div className="text-[10px]">{c.payment_method}{c.payment_reference ? ` · ${c.payment_reference}` : ''}</div>
                        )}
                      </div>
                    ) : '-'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground flex items-center gap-1">
        <ChevronRight className="w-3 h-3" /> Untuk pertanyaan tentang pencairan, hubungi owner. Status PAID muncul setelah owner mark komisi sebagai dibayar di /commissions/manage.
      </p>
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
