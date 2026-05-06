'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Megaphone, DollarSign, Target, TrendingUp, AlertTriangle, CheckCircle2, Clock, Plus } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { DateRangePicker, defaultRange, type DateRange } from '@/components/ui/date-range-picker'
import { formatRupiah } from '@/lib/format'
import Link from 'next/link'

const supabase = createClient()

export default function AdvDashboardPage() {
  const { profile, role, user, loading: authLoading } = useAuth()
  const [range, setRange] = useState<DateRange>(defaultRange())
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user?.id) return
    const load = async () => {
      setLoading(true)
      const [{ data: campaigns }, { data: spends }, { data: orders }, { data: commissions }] = await Promise.all([
        supabase.from('campaigns').select('id, campaign_name, platform, active').eq('advertiser_id', user.id),
        supabase.from('ad_spend').select('campaign_id, spend_date, spend, lead_platform, clicks, impressions').gte('spend_date', range.from).lte('spend_date', range.to),
        supabase.from('orders').select('id, advertiser_id, campaign_id, total, order_date, status, resi_status').gte('order_date', range.from).lte('order_date', range.to).is('duplicate_of', null),
        supabase.from('commissions').select('amount, status, orders!inner(advertiser_id, order_date)').eq('user_id', user.id).gte('orders.order_date', range.from).lte('orders.order_date', range.to),
      ])

      // Filter spends to my campaigns
      const myCampaignIds = new Set((campaigns || []).map((c: any) => c.id))
      const mySpends = (spends || []).filter((s: any) => myCampaignIds.has(s.campaign_id))
      const myOrders = (orders || []).filter((o: any) => o.advertiser_id === user.id || myCampaignIds.has(o.campaign_id))
      const validOrders = myOrders.filter((o: any) => !['CANCEL', 'FAKE'].includes(o.status))

      const totalSpend = mySpends.reduce((s: number, x: any) => s + Number(x.spend), 0)
      const totalLeadPlatform = mySpends.reduce((s: number, x: any) => s + (Number(x.lead_platform) || 0), 0)
      const totalClosing = validOrders.length
      const totalRevenue = validOrders.reduce((s: number, o: any) => s + Number(o.total), 0)
      const cpp = totalLeadPlatform > 0 ? totalSpend / totalLeadPlatform : 0
      const cpaReal = totalClosing > 0 ? totalSpend / totalClosing : 0
      const roas = totalSpend > 0 ? totalRevenue / totalSpend : 0
      const earnedCommission = (commissions || []).filter((c: any) => c.status === 'EARNED').reduce((s: number, c: any) => s + Number(c.amount), 0)
      const estimatedCommission = (commissions || []).filter((c: any) => c.status === 'ESTIMATED').reduce((s: number, c: any) => s + Number(c.amount), 0)

      // Per-campaign breakdown
      const campaignStats = (campaigns || []).map((c: any) => {
        const campaignSpends = mySpends.filter((s: any) => s.campaign_id === c.id)
        const campaignOrders = validOrders.filter((o: any) => o.campaign_id === c.id)
        const cSpend = campaignSpends.reduce((s: number, x: any) => s + Number(x.spend), 0)
        const cLeadPlatform = campaignSpends.reduce((s: number, x: any) => s + (Number(x.lead_platform) || 0), 0)
        const cClosing = campaignOrders.length
        const cRevenue = campaignOrders.reduce((s: number, o: any) => s + Number(o.total), 0)
        return {
          ...c,
          spend: cSpend,
          leadPlatform: cLeadPlatform,
          closing: cClosing,
          revenue: cRevenue,
          cpp: cLeadPlatform > 0 ? cSpend / cLeadPlatform : 0,
          cpa: cClosing > 0 ? cSpend / cClosing : 0,
          roas: cSpend > 0 ? cRevenue / cSpend : 0,
        }
      }).filter((c: any) => c.spend > 0 || c.closing > 0).sort((a: any, b: any) => b.revenue - a.revenue)

      setData({ campaigns: campaigns || [], totalSpend, totalLeadPlatform, totalClosing, totalRevenue, cpp, cpaReal, roas, earnedCommission, estimatedCommission, campaignStats })
      setLoading(false)
    }
    load()
  }, [user?.id, range])

  if (authLoading) return <div className="text-sm text-muted-foreground">Memeriksa akses...</div>
  if (role && !['advertiser', 'owner', 'admin'].includes(role)) {
    return (
      <Card className="max-w-md mx-auto mt-8">
        <CardContent className="pt-6 text-center space-y-2">
          <AlertTriangle className="w-10 h-10 text-yellow-500 mx-auto" />
          <h2 className="text-lg font-semibold">Akses Dibatasi</h2>
          <p className="text-sm text-muted-foreground">Halaman ini untuk role Advertiser.</p>
        </CardContent>
      </Card>
    )
  }

  const roasColor = data && data.roas >= 2 ? 'text-emerald-500' : data && data.roas >= 1 ? 'text-amber-500' : 'text-red-500'

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Megaphone}
        title={`Halo, ${profile?.full_name || 'Advertiser'} 👋`}
        description="Dashboard performa campaign kamu"
        actions={
          <div className="flex items-center gap-2">
            <DateRangePicker value={range} onChange={setRange} />
            <Button render={<Link href="/ad-spend" />} className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/20">
              <Plus className="w-4 h-4 mr-2" />Input Spend
            </Button>
          </div>
        }
      />

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 flex items-center gap-3 relative">
            <div className="p-2.5 bg-red-500/15 rounded-xl ring-1 ring-red-500/20"><DollarSign className="w-5 h-5 text-red-500" /></div>
            <div className="min-w-0"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Spend</p><p className="text-lg font-bold truncate">{formatRupiah(data?.totalSpend || 0)}</p></div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 flex items-center gap-3 relative">
            <div className="p-2.5 bg-amber-500/15 rounded-xl ring-1 ring-amber-500/20"><Target className="w-5 h-5 text-amber-500" /></div>
            <div className="min-w-0"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">CPP / CPA</p><p className="text-lg font-bold">{data?.cpp > 0 ? formatRupiah(data.cpp) : '—'}<span className="text-xs text-muted-foreground"> / </span><span className="text-emerald-500">{data?.cpaReal > 0 ? formatRupiah(data.cpaReal) : '—'}</span></p><p className="text-[10px] text-muted-foreground">{data?.totalClosing || 0} closing</p></div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 flex items-center gap-3 relative">
            <div className="p-2.5 bg-violet-500/15 rounded-xl ring-1 ring-violet-500/20"><TrendingUp className="w-5 h-5 text-violet-500" /></div>
            <div className="min-w-0"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">ROAS</p><p className={`text-lg font-bold ${roasColor}`}>{data?.roas > 0 ? `${data.roas.toFixed(2)}x` : '—'}</p><p className="text-[10px] text-muted-foreground">{formatRupiah(data?.totalRevenue || 0)} revenue</p></div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden relative border-emerald-500/30">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-transparent" />
          <CardContent className="pt-4 pb-4 flex items-center gap-3 relative">
            <div className="p-2.5 bg-emerald-500/15 rounded-xl ring-1 ring-emerald-500/20"><CheckCircle2 className="w-5 h-5 text-emerald-500" /></div>
            <div className="min-w-0"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Komisi Earned</p><p className="text-lg font-bold text-emerald-500">{formatRupiah(data?.earnedCommission || 0)}</p><p className="text-[10px] text-muted-foreground"><Clock className="w-2.5 h-2.5 inline" /> + {formatRupiah(data?.estimatedCommission || 0)} pending</p></div>
          </CardContent>
        </Card>
      </div>

      {/* Per campaign */}
      <Card>
        <CardContent className="p-0">
          <div className="p-4 pb-2">
            <h3 className="font-semibold">Performa Per Campaign</h3>
            <p className="text-xs text-muted-foreground">Sortir dari revenue tertinggi</p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campaign</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead className="text-right">Spend</TableHead>
                <TableHead className="text-center">Lead</TableHead>
                <TableHead className="text-right">CPP</TableHead>
                <TableHead className="text-center">Closing</TableHead>
                <TableHead className="text-right">CPA</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">ROAS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => <TableRow key={i}><TableCell colSpan={9}><div className="h-4 bg-muted animate-pulse rounded" /></TableCell></TableRow>)
              ) : !data || data.campaignStats.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="p-0"><EmptyState icon={Megaphone} title="Belum ada aktivitas campaign" description="Spending atau order belum tercatat di periode ini. Coba ubah range tanggal atau input spend baru." /></TableCell></TableRow>
              ) : data.campaignStats.map((c: any) => {
                const cRoasColor = c.roas >= 2 ? 'text-emerald-500' : c.roas >= 1 ? 'text-amber-500' : 'text-red-500'
                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium text-sm max-w-[180px] truncate">{c.campaign_name}{!c.active && <Badge variant="outline" className="text-[10px] ml-1.5">archived</Badge>}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{c.platform}</Badge></TableCell>
                    <TableCell className="text-right text-sm">{formatRupiah(c.spend)}</TableCell>
                    <TableCell className="text-center text-sm">{c.leadPlatform || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-right text-sm text-amber-500">{c.cpp > 0 ? formatRupiah(c.cpp) : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-center text-sm font-semibold text-emerald-500">{c.closing}</TableCell>
                    <TableCell className="text-right text-sm text-emerald-500">{c.cpa > 0 ? formatRupiah(c.cpa) : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-right font-medium">{formatRupiah(c.revenue)}</TableCell>
                    <TableCell className={`text-right font-bold ${cRoasColor}`}>{c.roas > 0 ? `${c.roas.toFixed(2)}x` : <span className="text-muted-foreground">—</span>}</TableCell>
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
