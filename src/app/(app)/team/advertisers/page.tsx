'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { AlertTriangle, Megaphone, Mail } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { DateRangePicker, defaultRange, type DateRange } from '@/components/ui/date-range-picker'
import { formatRupiah } from '@/lib/format'

const supabase = createClient()

export default function AdvertisersListPage() {
  const { role, loading: authLoading } = useAuth()
  const [range, setRange] = useState<DateRange>(defaultRange())
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const [{ data: profiles }, { data: campaigns }, { data: spends }, { data: orders }] = await Promise.all([
        supabase.from('profiles').select('id, full_name, role, active, created_at').eq('role', 'advertiser').order('full_name'),
        supabase.from('campaigns').select('id, advertiser_id, active'),
        supabase.from('ad_spend').select('spend, lead_platform, campaign_id, spend_date').gte('spend_date', range.from).lte('spend_date', range.to),
        supabase.from('orders').select('id, advertiser_id, total, order_date, status').gte('order_date', range.from).lte('order_date', range.to).is('duplicate_of', null).not('status', 'in', '(CANCEL,FAKE)'),
      ])

      // Aggregate per advertiser
      const list = (profiles || []).map((p: any) => {
        const myCampaigns = (campaigns || []).filter((c: any) => c.advertiser_id === p.id)
        const myActiveCampaigns = myCampaigns.filter((c: any) => c.active).length
        const myCampaignIds = new Set(myCampaigns.map((c: any) => c.id))
        const mySpends = (spends || []).filter((s: any) => myCampaignIds.has(s.campaign_id))
        const totalSpend = mySpends.reduce((sum: number, s: any) => sum + Number(s.spend), 0)
        const totalLeadPlatform = mySpends.reduce((sum: number, s: any) => sum + (Number(s.lead_platform) || 0), 0)
        const myOrders = (orders || []).filter((o: any) => o.advertiser_id === p.id)
        const totalRevenue = myOrders.reduce((sum: number, o: any) => sum + Number(o.total), 0)
        const closingCount = myOrders.length
        const cpp = totalLeadPlatform > 0 ? totalSpend / totalLeadPlatform : 0
        const cpa = closingCount > 0 ? totalSpend / closingCount : 0
        const roas = totalSpend > 0 ? totalRevenue / totalSpend : 0
        return {
          ...p,
          campaigns: myCampaigns.length,
          activeCampaigns: myActiveCampaigns,
          totalSpend, totalLeadPlatform, totalRevenue, closingCount, cpp, cpa, roas,
        }
      })

      setUsers(list)
      setLoading(false)
    }
    load()
  }, [range])

  const totals = useMemo(() => {
    return users.reduce((acc, u) => ({
      spend: acc.spend + u.totalSpend,
      revenue: acc.revenue + u.totalRevenue,
      closing: acc.closing + u.closingCount,
      campaigns: acc.campaigns + u.activeCampaigns,
    }), { spend: 0, revenue: 0, closing: 0, campaigns: 0 })
  }, [users])

  if (authLoading) return <div className="text-sm text-muted-foreground">Memeriksa akses...</div>
  if (role !== 'owner') {
    return (
      <Card className="max-w-md mx-auto mt-8">
        <CardContent className="pt-6 text-center space-y-2">
          <AlertTriangle className="w-10 h-10 text-yellow-500 mx-auto" />
          <h2 className="text-lg font-semibold">Akses Dibatasi</h2>
          <p className="text-sm text-muted-foreground">Hanya Owner yang dapat lihat daftar advertiser.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Megaphone}
        title="Daftar Advertiser"
        description={`${users.length} advertiser • ${totals.campaigns} campaign aktif`}
        actions={<DateRangePicker value={range} onChange={setRange} />}
      />

      {/* Top stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card><CardContent className="pt-4 pb-4"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Spend</p><p className="text-xl font-bold text-red-500">{formatRupiah(totals.spend)}</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-4"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Revenue</p><p className="text-xl font-bold text-emerald-500">{formatRupiah(totals.revenue)}</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-4"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Closing</p><p className="text-xl font-bold">{totals.closing}</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-4"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Avg ROAS</p><p className={`text-xl font-bold ${totals.spend > 0 && totals.revenue / totals.spend >= 2 ? 'text-emerald-500' : 'text-amber-500'}`}>{totals.spend > 0 ? `${(totals.revenue / totals.spend).toFixed(2)}x` : '—'}</p></CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead className="text-center">Campaign</TableHead>
                <TableHead className="text-right">Spend</TableHead>
                <TableHead className="text-right">Lead Platform</TableHead>
                <TableHead className="text-right">CPP</TableHead>
                <TableHead className="text-center">Closing</TableHead>
                <TableHead className="text-right">CPA Real</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">ROAS</TableHead>
                <TableHead className="text-center">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => <TableRow key={i}><TableCell colSpan={10}><div className="h-4 bg-muted animate-pulse rounded" /></TableCell></TableRow>)
              ) : users.length === 0 ? (
                <TableRow><TableCell colSpan={10} className="p-0"><EmptyState icon={Megaphone} title="Belum ada advertiser" description="Tambah user dengan role 'advertiser' di Settings → Users." /></TableCell></TableRow>
              ) : users.map(u => {
                const roasColor = u.roas >= 2 ? 'text-emerald-500' : u.roas >= 1 ? 'text-amber-500' : u.roas > 0 ? 'text-red-500' : 'text-muted-foreground'
                return (
                  <TableRow key={u.id} className={!u.active ? 'opacity-50' : ''}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{u.full_name}</p>
                      </div>
                    </TableCell>
                    <TableCell className="text-center text-sm">{u.activeCampaigns}<span className="text-xs text-muted-foreground"> / {u.campaigns}</span></TableCell>
                    <TableCell className="text-right text-sm">{formatRupiah(u.totalSpend)}</TableCell>
                    <TableCell className="text-right text-sm">{u.totalLeadPlatform || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-right text-sm text-amber-500">{u.cpp > 0 ? formatRupiah(u.cpp) : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-center text-sm font-semibold text-emerald-500">{u.closingCount}</TableCell>
                    <TableCell className="text-right text-sm text-emerald-500">{u.cpa > 0 ? formatRupiah(u.cpa) : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-right font-medium">{formatRupiah(u.totalRevenue)}</TableCell>
                    <TableCell className={`text-right font-bold ${roasColor}`}>{u.roas > 0 ? `${u.roas.toFixed(2)}x` : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={u.active ? 'bg-emerald-500/10 text-emerald-600' : 'bg-zinc-500/10'}>{u.active ? 'Aktif' : 'Nonaktif'}</Badge>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
