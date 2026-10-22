'use client'
import { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import { isCalendarDate } from '@/lib/date/ranges'
import { getErrorMessage } from '@/lib/errors'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Users, ShieldOff, ChevronRight, ArrowUpDown } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { StatCard } from '@/components/ui/stat-card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { DateRangePicker, thisMonth, type DateRange } from '@/components/ui/date-range-picker'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { canViewTeamPerformance } from '@/lib/auth/permissions'
import { fetchCsTeamSummary } from '@/lib/supabase/queries/team'
import { formatRupiah } from '@/lib/format'
import type { CsPerformance } from '@/lib/types'
import { cn } from '@/lib/utils'

const supabase = createClient()

type SortKey = 'full_name' | 'leads_reported' | 'total_orders' | 'closing_count' | 'retur_count' | 'gross_profit' | 'retur_rate' | 'conv_rate' | 'delivered_rate'
type SortDir = 'asc' | 'desc'

export default function CsTeamListPage() {
  const router = useRouter()
  const { role, loading: authLoading } = useAuth()
  const allowed = canViewTeamPerformance(role)

  const [range, setRange] = useState<DateRange>(() => thisMonth())
  const [rangeReady, setRangeReady] = useState(false)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const from = params.get('from') || '', to = params.get('to') || ''
    // Read browser URL after SSR to keep hydration stable.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isCalendarDate(from) && isCalendarDate(to) && from <= to) setRange({ from, to })
    setRangeReady(true)
  }, [])
  const [rows, setRows] = useState<CsPerformance[]>([])
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<SortKey>('total_orders')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const requestRef = useRef(0)
  const load = useCallback(async () => {
    const request = ++requestRef.current
    if (!allowed || !rangeReady) return
    setLoading(true)
    try {
      const data = await fetchCsTeamSummary(supabase, range.from, range.to)
      if (request === requestRef.current) setRows(data)
    } catch (err) {
      if (request === requestRef.current) toast.error('Gagal load data', { description: getErrorMessage(err) })
    } finally {
      if (request === requestRef.current) setLoading(false)
    }
  }, [allowed, rangeReady, range.from, range.to])

  // Fetching remote CS metrics is an effect; targeted lint disable avoids React 19 false-positive on async load().
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); return () => { requestRef.current++ } }, [load])

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
    const totalLeads = rows.reduce((s, r) => s + Number(r.leads_reported || 0), 0)
    const totalOrderResi = rows.reduce((s, r) => s + r.total_orders, 0)
    const totalDelivered = rows.reduce((s, r) => s + r.closing_count, 0)
    const totalClosingReported = rows.reduce((s, r) => s + Number(r.closing_reported || 0), 0)
    const totalReturned = rows.reduce((s, r) => s + Number(r.retur_count || 0), 0)
    const grossProfit = rows.reduce((s, r) => s + Number(r.gross_profit || 0), 0)
    const closingRate = totalLeads > 0 ? (totalClosingReported / totalLeads) * 100 : 0
    const returnRate = totalOrderResi > 0 ? (totalReturned / totalOrderResi) * 100 : 0
    const deliveredRate = totalOrderResi > 0 ? (totalDelivered / totalOrderResi) * 100 : 0
    return { activeCount, totalLeads, totalOrderResi, totalDelivered, totalClosingReported, totalReturned, grossProfit, closingRate, returnRate, deliveredRate }
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
              Daftar CS hanya bisa diakses owner atau admin. CS lain bisa cek performance pribadi di /cs-dashboard.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 space-y-5">
      <PageHeader
        title="Daftar CS"
        description="Performance per CS — leads, order resi, closing, return, gross profit."
        icon={Users}
        actions={<DateRangePicker value={range} onChange={setRange} />}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
        <StatCard label="CS aktif" value={String(summary.activeCount)} sub={`dari ${rows.length} terdaftar`} />
        <StatCard label="Total leads" value={summary.totalLeads.toLocaleString('id-ID')} sub="laporan CS periode ini" />
        <StatCard label="Total resi" value={summary.totalOrderResi.toLocaleString('id-ID')} sub="unique resi dari Tanggal Create SPX" />
        <StatCard label="Total delivered" value={summary.totalDelivered.toLocaleString('id-ID')} sub={`${summary.deliveredRate.toFixed(1)}% dari total resi`} />
        <StatCard label="Total returned" value={summary.totalReturned.toLocaleString('id-ID')} sub={`${summary.returnRate.toFixed(1)}% dari total resi`} />
        <StatCard label="Gross profit closing" value={formatRupiah(summary.grossProfit)} sub="hanya status DITERIMA" />
      </div>

      <p className="text-sm text-muted-foreground">Periode pengiriman: tanggal dibuat di SPX, {range.from} – {range.to} WIB. Klik nama CS untuk detail produk dan wilayah.</p>
      {rows.some(r => (r.incomplete_hpp_orders || 0) > 0) && <p role="status" className="text-sm text-amber-600">Ada order delivered dengan HPP belum lengkap. Lengkapi pemeriksaan biaya sebelum memakai profit untuk keputusan pencairan.</p>}
      <Card className="bg-muted/20">
        <CardContent className="grid gap-3 p-4 text-xs text-muted-foreground md:grid-cols-3">
          <div>
            <div className="font-semibold text-foreground">Gross Profit Closing</div>
            <div>Hanya resi berstatus akhir <span className="font-medium text-foreground">Delivered</span>, bukan semua resi. HPP mencakup modal barang dan biaya packing per item, dikali jumlah barang. Nilai profit masih estimasi biaya pengiriman.</div>
          </div>
          <div>
            <div className="font-semibold text-foreground">Rate utama</div>
            <div>Closing Rate = closing dari laporan CS ÷ Leads. Delivered % = Total Delivered ÷ Total Resi.</div>
          </div>
          <div>
            <div className="font-semibold text-foreground">Return</div>
            <div>Return % = Returned ÷ Total Resi. Returned tidak masuk Gross Profit Closing.</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : sorted.length === 0 ? (
            <EmptyState
              icon={Users}
              title="Belum ada CS terdaftar"
              description="Tambah user dengan role CS di Users & Roles."
              action={
                <Link href="/settings/users" className="inline-flex items-center text-sm text-zinc-500 hover:underline">
                  Buka Users &amp; Roles →
                </Link>
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHead label="Nama" col="full_name" sortKey={sortKey} sortDir={sortDir} onClick={clickSort} />
                  <TableHead>Status</TableHead>
                  <SortableHead label="Leads" col="leads_reported" sortKey={sortKey} sortDir={sortDir} onClick={clickSort} align="right" />
                  <SortableHead label="Order Resi" col="total_orders" sortKey={sortKey} sortDir={sortDir} onClick={clickSort} align="right" />
                  <SortableHead label="Resi Delivered" col="closing_count" sortKey={sortKey} sortDir={sortDir} onClick={clickSort} align="right" />
                  <SortableHead label="Returned" col="retur_count" sortKey={sortKey} sortDir={sortDir} onClick={clickSort} align="right" />
                  <SortableHead label="Gross Profit" col="gross_profit" sortKey={sortKey} sortDir={sortDir} onClick={clickSort} align="right" />
                  <SortableHead label="Return %" col="retur_rate" sortKey={sortKey} sortDir={sortDir} onClick={clickSort} align="right" />
                  <SortableHead label="Closing Rate" col="conv_rate" sortKey={sortKey} sortDir={sortDir} onClick={clickSort} align="right" />
                  <SortableHead label="Delivered %" col="delivered_rate" sortKey={sortKey} sortDir={sortDir} onClick={clickSort} align="right" />
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map(r => (
                  <TableRow
                    key={r.user_id}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => router.push(`/team/cs/${r.user_id}?from=${range.from}&to=${range.to}`)}
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
                    <TableCell className="text-right tabular-nums">{Number(r.leads_reported || 0).toLocaleString('id-ID')}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.total_orders.toLocaleString('id-ID')}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.closing_count.toLocaleString('id-ID')}</TableCell>
                    <TableCell className="text-right tabular-nums">{Number(r.retur_count || 0).toLocaleString('id-ID')}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{formatRupiah(Number(r.gross_profit || 0))}</TableCell>
                    <TableCell className={cn('text-right tabular-nums', Number(r.retur_rate || 0) >= 30 ? 'text-red-500' : Number(r.retur_rate || 0) >= 15 ? 'text-amber-500' : 'text-emerald-600')}>
                      {Number(r.retur_rate || 0).toFixed(1)}%
                    </TableCell>
                    <TableCell className={cn('text-right tabular-nums', r.conv_rate >= 50 ? 'text-emerald-500' : r.conv_rate >= 30 ? 'text-amber-500' : 'text-muted-foreground')}>
                      {r.conv_rate.toFixed(1)}%
                    </TableCell>
                    <TableCell className={cn('text-right tabular-nums', Number(r.delivered_rate || 0) >= 50 ? 'text-emerald-500' : Number(r.delivered_rate || 0) >= 30 ? 'text-amber-500' : 'text-muted-foreground')}>
                      {Number(r.delivered_rate || 0).toFixed(1)}%
                    </TableCell>
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
