'use client'
import { useCallback, useEffect, useState, useMemo } from 'react'
import { getErrorMessage } from '@/lib/errors'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Megaphone, ShieldOff, ChevronRight, ArrowUpDown } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { DateRangePicker, thisMonth, type DateRange } from '@/components/ui/date-range-picker'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { canViewTeamPerformance } from '@/lib/auth/permissions'
import { fetchAdvertiserTeamSummary } from '@/lib/supabase/queries/team'
import { formatRupiah } from '@/lib/format'
import type { AdvertiserPerformance } from '@/lib/types'
import { cn } from '@/lib/utils'

const supabase = createClient()

type SortKey =
  | 'full_name'
  | 'active_campaigns'
  | 'total_spend'
  | 'revenue_attributed'
  | 'roas'
  | 'orders_attributed'
  | 'commission_unpaid'
type SortDir = 'asc' | 'desc'

export default function AdvertiserTeamListPage() {
  const router = useRouter()
  const { role, loading: authLoading } = useAuth()
  const allowed = canViewTeamPerformance(role)

  const [range, setRange] = useState<DateRange>(thisMonth)
  const [rangeReady, setRangeReady] = useState(false)
  const [rows, setRows] = useState<AdvertiserPerformance[]>([])
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<SortKey>('total_spend')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  useEffect(() => { setRange(thisMonth()); setRangeReady(true) }, [])

  const load = useCallback(async () => {
    if (!rangeReady || !allowed) return
    setLoading(true)
    try {
      const data = await fetchAdvertiserTeamSummary(supabase, range.from, range.to)
      setRows(data)
    } catch (err) {
      toast.error('Gagal load data', { description: getErrorMessage(err) })
    } finally {
      setLoading(false)
    }
  }, [allowed, rangeReady, range.from, range.to])

  useEffect(() => { load() }, [load])

  const sorted = useMemo(() => {
    const arr = [...rows]
    arr.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey]
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      }
      const an = Number(av) || 0, bn = Number(bv) || 0
      return sortDir === 'asc' ? an - bn : bn - an
    })
    return arr
  }, [rows, sortKey, sortDir])

  const summary = useMemo(() => {
    const activeCount = rows.filter(r => r.is_active).length
    const totalSpend = rows.reduce((s, r) => s + r.total_spend, 0)
    const unpaidCommission = rows.reduce((s, r) => s + r.commission_unpaid, 0)
    return { activeCount, totalSpend, unpaidCommission }
  }, [rows])

  function clickSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  if (authLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>
  if (!allowed) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-500">
              <ShieldOff className="size-5" /> Akses ditolak
            </CardTitle>
            <CardDescription>
              Daftar Advertiser hanya bisa diakses owner atau admin. Advertiser lain bisa cek performance pribadi di /adv-dashboard.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 space-y-5">
      <PageHeader
        title="Daftar Advertiser"
        description="Performance per ADV — spend, ROAS, orders attributed, komisi."
        icon={Megaphone}
        actions={<DateRangePicker value={range} onChange={setRange} />}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <StatCard label="ADV aktif" value={String(summary.activeCount)} hint={`dari ${rows.length} terdaftar`} />
        <StatCard label="Total spend (periode)" value={formatRupiah(summary.totalSpend)} hint="semua campaign" />
        <StatCard label="Komisi unpaid" value={formatRupiah(summary.unpaidCommission)} hint="EARNED, belum PAID" />
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : sorted.length === 0 ? (
            <EmptyState
              icon={Megaphone}
              title="Belum ada Advertiser terdaftar"
              description="Tambah user dengan role Advertiser di Users & Roles."
              action={
                <Link href="/settings/users" className="inline-flex items-center text-sm text-violet-500 hover:underline">
                  Buka Users &amp; Roles →
                </Link>
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHead label="Nama"     col="full_name"          sortKey={sortKey} sortDir={sortDir} onClick={clickSort} />
                  <TableHead>Status</TableHead>
                  <TableHead>Top Produk</TableHead>
                  <SortableHead label="Campaign" col="active_campaigns"   sortKey={sortKey} sortDir={sortDir} onClick={clickSort} align="right" />
                  <SortableHead label="Spend"    col="total_spend"        sortKey={sortKey} sortDir={sortDir} onClick={clickSort} align="right" />
                  <SortableHead label="Revenue"  col="revenue_attributed" sortKey={sortKey} sortDir={sortDir} onClick={clickSort} align="right" />
                  <SortableHead label="ROAS"     col="roas"               sortKey={sortKey} sortDir={sortDir} onClick={clickSort} align="right" />
                  <SortableHead label="Orders"   col="orders_attributed"  sortKey={sortKey} sortDir={sortDir} onClick={clickSort} align="right" />
                  <SortableHead label="Unpaid"   col="commission_unpaid"  sortKey={sortKey} sortDir={sortDir} onClick={clickSort} align="right" />
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map(r => (
                  <TableRow
                    key={r.user_id}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => router.push(`/team/advertisers/${r.user_id}`)}
                  >
                    <TableCell className="font-medium">
                      <div className="flex flex-col">
                        <span>{r.full_name}</span>
                        {r.email && <span className="text-[10px] font-mono text-muted-foreground">{r.email}</span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={r.is_active ? 'bg-emerald-500/10 text-emerald-600' : 'bg-zinc-500/10 text-zinc-500'}>
                        {r.is_active ? 'Aktif' : 'Nonaktif'}
                      </Badge>
                    </TableCell>
                    <TableCell><TopProductPill name={r.top_product_name} count={r.top_product_orders} /></TableCell>
                    <TableCell className="text-right tabular-nums">{r.active_campaigns.toLocaleString('id-ID')}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRupiah(r.total_spend)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRupiah(r.revenue_attributed)}</TableCell>
                    <TableCell className={cn('text-right tabular-nums', r.roas >= 2 ? 'text-emerald-500' : r.roas >= 1 ? 'text-amber-500' : 'text-red-500')}>
                      {r.roas.toFixed(2)}x
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.orders_attributed.toLocaleString('id-ID')}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRupiah(r.commission_unpaid)}</TableCell>
                    <TableCell><ChevronRight className="size-4 text-muted-foreground" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function TopProductPill({ name, count }: { name: string | null; count: number }) {
  if (!name) return <span className="text-muted-foreground">—</span>
  const truncated = name.length > 20 ? name.slice(0, 18) + '…' : name
  return (
    <span title={name} className="text-sm">
      {truncated} <span className="text-muted-foreground tabular-nums">({count})</span>
    </span>
  )
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-bold tabular-nums mt-1">{value}</p>
        {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
      </CardContent>
    </Card>
  )
}

function SortableHead({
  label, col, sortKey, sortDir, onClick, align,
}: {
  label: string
  col: SortKey
  sortKey: SortKey
  sortDir: SortDir
  onClick: (k: SortKey) => void
  align?: 'right'
}) {
  const isActive = sortKey === col
  return (
    <TableHead className={align === 'right' ? 'text-right' : ''}>
      <button
        type="button"
        onClick={() => onClick(col)}
        className={cn('inline-flex items-center gap-1 hover:text-foreground', isActive && 'text-foreground font-semibold')}
      >
        {label}
        <ArrowUpDown className={cn('size-3', isActive ? 'opacity-100' : 'opacity-40')} />
        {isActive && <span className="text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>}
      </button>
    </TableHead>
  )
}
