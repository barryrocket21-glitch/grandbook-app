'use client'
// =============================================================
// Personal Dashboard component — shared antara /cs-dashboard & /adv-dashboard
// Stat cards + daily revenue area chart + table 10 order terbaru.
// Owner bisa override filter user via dropdown di header (kalau diberikan).
// =============================================================
import { useState, useEffect, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Combobox } from '@/components/ui/combobox'
import { EmptyState } from '@/components/ui/empty-state'
import { Loader2, RefreshCw, type LucideIcon } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer,
} from 'recharts'
import { DateRangePicker, thisMonth, type DateRange } from '@/components/ui/date-range-picker'
import { formatRupiah, formatDate } from '@/lib/format'
import { STATUS_BADGE_COLOR, STATUS_LABEL, COMMISSION_STATUS_BADGE_COLOR, COMMISSION_STATUS_LABEL } from '@/lib/schemas/settings'
import { fetchPersonalDashboard, type PersonalDashboardData } from '@/lib/supabase/queries/analytics'
import type { OrderStatus, CommissionV2Status } from '@/lib/types'

const supabase = createClient()

interface UserOption {
  id: string
  full_name: string
}

interface Props {
  /** Role yang halaman ini scope ke (cs untuk /cs-dashboard, advertiser untuk /adv-dashboard). */
  role: 'cs' | 'advertiser'
  pageTitle: string
  pageDescription: string
  icon: LucideIcon
  /** Empty state hint kalau user yang sedang login bukan role ini & belum pilih siapa-siapa. */
  emptyHintForOwner?: string
  /** Pencairan link target (default /commissions/my) */
  commissionLink?: string
  /** Phase 6: optional render slot di atas stat cards orders. Dipakai /cs-dashboard
   *  untuk inject lead/closing summary dari daily_cs_report. Receives userId + date range. */
  renderExtraSection?: (args: { userId: string; from: string; to: string }) => React.ReactNode
}

export function PersonalDashboard({ role, pageTitle, pageDescription, icon: Icon, emptyHintForOwner, commissionLink = '/commissions/my', renderExtraSection }: Props) {
  const { user, role: viewerRole, loading: authLoading } = useAuth()
  // Owner & admin keduanya dapat "supervisor view": dropdown pilih user mana saja.
  const isOwnerLooking = viewerRole === 'owner' || viewerRole === 'admin'

  const [range, setRange] = useState<DateRange>(thisMonth)
  const [rangeReady, setRangeReady] = useState(false)
  // For owner: optional filter to view another user's data. For non-owner: always self.
  const [pickedUserId, setPickedUserId] = useState<string>('')
  const [users, setUsers] = useState<UserOption[]>([])
  const [data, setData] = useState<PersonalDashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setRange(thisMonth())
    setRangeReady(true)
  }, [])

  // Owner-only: load list of users with this role
  useEffect(() => {
    if (!isOwnerLooking) return
    const loadUsers = async () => {
      const { data: us } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('role', role)
        .eq('active', true)
        .order('full_name')
      setUsers((us || []) as UserOption[])
    }
    void loadUsers()
  }, [isOwnerLooking, role])

  // Effective user being viewed: owner picks (or empty), non-owner always self
  const effectiveUserId = useMemo(() => {
    if (isOwnerLooking) return pickedUserId || ''
    return user?.id || ''
  }, [isOwnerLooking, pickedUserId, user?.id])

  const load = useCallback(async () => {
    if (!effectiveUserId || !rangeReady) {
      setData(null)
      return
    }
    setLoading(true)
    try {
      const d = await fetchPersonalDashboard(supabase, {
        role,
        userId: effectiveUserId,
        from: range.from,
        to: range.to,
      })
      setData(d)
    } finally {
      setLoading(false)
    }
  }, [effectiveUserId, range.from, range.to, rangeReady, role])

  useEffect(() => {
    if (!authLoading) void load()
  }, [authLoading, load])

  // Loading state for auth resolution
  if (authLoading) {
    return (
      <div className="space-y-6">
        <PageHeader icon={Icon} title={pageTitle} />
        <Card><CardContent className="p-6 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></CardContent></Card>
      </div>
    )
  }

  // Permission gate: if viewer role doesn't match and not owner, refuse.
  if (!isOwnerLooking && viewerRole !== role) {
    return (
      <div className="space-y-6">
        <PageHeader icon={Icon} title={pageTitle} />
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          Halaman ini cuma untuk role <span className="font-mono">{role}</span> atau owner.
        </CardContent></Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Icon}
        title={pageTitle}
        description={pageDescription}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            {isOwnerLooking && (
              <div className="min-w-[200px]">
                <Combobox
                  value={pickedUserId}
                  onChange={setPickedUserId}
                  options={users.map((u) => ({ value: u.id, label: u.full_name }))}
                  placeholder={`Pilih ${role}`}
                  searchPlaceholder={`Cari ${role}...`}
                  emptyHint={{
                    message: `Belum ada ${role} terdaftar.`,
                    actionLabel: 'Tambah di Pengaturan Users',
                    actionHref: '/settings/users',
                  }}
                />
              </div>
            )}
            <DateRangePicker value={range} onChange={setRange} />
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading || !effectiveUserId}>
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            </Button>
          </div>
        }
      />

      {/* Owner-but-no-user-picked yet */}
      {isOwnerLooking && !pickedUserId && (
        <EmptyState
          icon={Icon}
          title={emptyHintForOwner || `Pilih ${role} dari dropdown atas`}
          description={`Owner mode: pilih ${role} untuk lihat performance individual mereka. Untuk overview agregat semua ${role}, buka /analytics.`}
        />
      )}

      {/* Data is being loaded */}
      {effectiveUserId && loading && (
        <Card><CardContent className="p-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></CardContent></Card>
      )}

      {/* Data loaded */}
      {effectiveUserId && !loading && data && (
        <>
          {/* Phase 6: optional CS lead/closing summary (only renders if prop given) */}
          {renderExtraSection && renderExtraSection({ userId: effectiveUserId, from: range.from, to: range.to })}

          {data.totals.total_orders === 0 ? (
            <EmptyState
              icon={Icon}
              title="Belum ada order di periode ini"
              description={`Coba ubah date range — atau pastikan order yang Anda handle sebagai ${role} sudah ada di sistem.`}
            />
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="Total Orders" value={String(data.totals.total_orders)} sub="periode ini" color="blue" />
                <StatCard label="Revenue" value={formatRupiah(data.totals.total_revenue)} sub="dari order Anda" color="violet" />
                <StatCard label="Diterima" value={String(data.totals.diterima)} sub={`${data.totals.conversion_rate.toFixed(1)}% conv rate`} color="emerald" />
                <StatCard label="Retur" value={String(data.totals.retur)} sub="dari order final" color="orange" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <StatCard
                  label="Komisi Earned (pending pencairan)"
                  value={formatRupiah(data.totals.commission_earned)}
                  sub={<>Belum dicairkan • <Link href={commissionLink} className="text-zinc-500 hover:underline">lihat detail</Link></>}
                  color="amber"
                />
                <StatCard
                  label="Komisi Paid (sudah dicairkan)"
                  value={formatRupiah(data.totals.commission_paid)}
                  sub={<>Sudah ditransfer • <Link href={commissionLink} className="text-zinc-500 hover:underline">history</Link></>}
                  color="emerald"
                />
              </div>

              <Card>
                <CardContent className="pt-4 pb-4">
                  <h3 className="text-sm font-semibold mb-2">Daily Orders</h3>
                  {data.dailySeries.length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">Belum ada data harian.</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <AreaChart data={data.dailySeries} margin={{ top: 8, right: 8, left: 8, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgb(148 163 184 / 0.2)" />
                        <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <RechartsTooltip
                          contentStyle={{ background: 'rgb(15 23 42 / 0.95)', border: '1px solid rgb(148 163 184 / 0.3)', borderRadius: 6, fontSize: 12 }}
                          formatter={(value, name) => name === 'revenue' ? [formatRupiah(Number(value)), 'Revenue'] : [String(value), String(name)]}
                        />
                        <Area type="monotone" dataKey="total_orders" stroke="#3f6fd1" fill="#3f6fd1" fillOpacity={0.3} name="orders" />
                        <Area type="monotone" dataKey="diterima_orders" stroke="#10b981" fill="#10b981" fillOpacity={0.3} name="diterima" />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-0">
                  <div className="px-4 py-3 border-b">
                    <h3 className="text-sm font-semibold">10 Order Terbaru</h3>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Order#</TableHead>
                        <TableHead>Tanggal</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-right">Komisi</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.recentOrders.map((o) => (
                        <TableRow key={o.id}>
                          <TableCell>
                            <Link href={`/orders/${o.id}`} className="font-mono text-xs text-zinc-500 hover:underline">
                              {o.order_number}
                            </Link>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{formatDate(o.order_date)}</TableCell>
                          <TableCell className="text-sm">{o.customer_name}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`text-[10px] ${STATUS_BADGE_COLOR[o.status as OrderStatus]}`}>
                              {STATUS_LABEL[o.status as OrderStatus]}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right text-xs">{formatRupiah(o.total)}</TableCell>
                          <TableCell className="text-right text-xs">
                            {o.commission_amount != null ? (
                              <div className="flex items-center justify-end gap-1.5">
                                <span className="font-semibold">{formatRupiah(o.commission_amount)}</span>
                                {o.commission_status && (
                                  <Badge variant="outline" className={`text-[10px] ${COMMISSION_STATUS_BADGE_COLOR[o.commission_status as CommissionV2Status]}`}>
                                    {COMMISSION_STATUS_LABEL[o.commission_status as CommissionV2Status]}
                                  </Badge>
                                )}
                              </div>
                            ) : (
                              <span className="text-muted-foreground italic">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  )
}

function StatCard({ label, value, sub, color }: {
  label: string
  value: string
  sub: React.ReactNode
  color: 'blue' | 'amber' | 'emerald' | 'zinc' | 'violet' | 'red' | 'orange'
}) {
  const colorMap: Record<string, string> = {
    blue: 'bg-zinc-500/10 border-zinc-500/30 text-zinc-600',
    amber: 'bg-amber-500/10 border-amber-500/30 text-amber-600',
    emerald: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600',
    zinc: 'bg-zinc-500/10 border-zinc-500/30 text-zinc-600',
    violet: 'bg-zinc-500/10 border-zinc-500/30 text-zinc-600',
    red: 'bg-red-500/10 border-red-500/30 text-red-600',
    orange: 'bg-amber-500/10 border-amber-500/30 text-amber-600',
  }
  return (
    <div className={`p-3 rounded border ${colorMap[color]}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-bold mt-1">{value}</div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>
    </div>
  )
}
