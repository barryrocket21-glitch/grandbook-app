'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { BarChart3, Loader2, RefreshCw, Users, ArrowRight } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { getErrorMessage } from '@/lib/errors'
import { toast } from 'sonner'

const supabase = createClient()

// Brief #22 — Performa: lebur Dashboard ADV + Performa Advertiser + kartu CPR/CPA.
// CPR = spend÷lead · CPA = spend÷closing (ter-atribusi) · CPA Final = spend÷delivered.
interface Perf {
  campaign_id: number; campaign_name: string; platform: string
  spend_total: number; leads: number; attributed_orders: number; delivered_orders: number
  cpr: number | null; cpa: number | null; cpa_final: number | null
}
const rp = (v: number | null) => v != null ? 'Rp ' + Number(v).toLocaleString('id-ID') : '—'

export default function PerformaPage() {
  const { role } = useAuth()
  const isOwnerAdmin = role === 'owner' || role === 'admin'
  const [perf, setPerf] = useState<Perf[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase.rpc('campaign_performance', { p_from: null, p_to: null })
      if (error) throw error
      setPerf((data || []) as Perf[])
    } catch (err) { toast.error('Gagal load performa', { description: getErrorMessage(err) }) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const tot = perf.reduce((a, p) => ({ spend: a.spend + Number(p.spend_total || 0), leads: a.leads + Number(p.leads || 0), deliv: a.deliv + Number(p.delivered_orders || 0) }), { spend: 0, leads: 0, deliv: 0 })

  return (
    <div className="space-y-4">
      <PageHeader icon={BarChart3} title="Performa Iklan"
        description="Per campaign: Spend · Lead · CPR (spend÷lead) · CPA (spend÷closing) · CPA Final (spend÷delivered)."
        actions={
          <div className="flex gap-2">
            {isOwnerAdmin && (
              <Link href="/team/advertisers" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border text-sm hover:bg-muted"><Users className="w-3.5 h-3.5" /> Per Advertiser</Link>
            )}
            <Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /></Button>
          </div>
        } />

      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="pt-4 pb-4"><div className="text-[10px] uppercase text-muted-foreground">Total Spend</div><div className="text-xl font-bold tabular-nums">{rp(tot.spend)}</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-4"><div className="text-[10px] uppercase text-muted-foreground">Total Lead</div><div className="text-xl font-bold tabular-nums">{tot.leads}</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-4"><div className="text-[10px] uppercase text-muted-foreground">Total Delivered</div><div className="text-xl font-bold tabular-nums text-emerald-600">{tot.deliv}</div></CardContent></Card>
      </div>

      <Card>
        <CardContent className="pt-4 pb-4">
          {loading ? <Loader2 className="w-5 h-5 animate-spin mx-auto my-6" /> : perf.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">Belum ada spend/atribusi. Input di <Link href="/ad-spend" className="text-violet-500 hover:underline">Input Harian</Link> + Resolve di <Link href="/marketing/ad-setup" className="text-violet-500 hover:underline">Setup Iklan</Link>.</p>
          ) : (
            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Campaign</TableHead><TableHead className="text-right">Spend</TableHead><TableHead className="text-right">Lead</TableHead>
                  <TableHead className="text-right">Closing</TableHead><TableHead className="text-right">Delivered</TableHead>
                  <TableHead className="text-right">CPR</TableHead><TableHead className="text-right">CPA</TableHead><TableHead className="text-right">CPA Final</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {perf.map(p => (
                    <TableRow key={p.campaign_id}>
                      <TableCell className="text-xs">{p.campaign_name} <Badge variant="outline" className="text-[10px] ml-1">{p.platform}</Badge></TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{rp(p.spend_total)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{p.leads}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{p.attributed_orders}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{p.delivered_orders}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{rp(p.cpr)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{rp(p.cpa)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums font-medium text-emerald-600">{rp(p.cpa_final)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
