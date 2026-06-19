'use client'
// =============================================================
// Brief #4 — Retur Root-Cause section (di /analytics).
// 5 panel (CS / Produk / Campaign / Wilayah / Kurir): tabel + bar return_rate.
// Klik baris → drill breakdown reject_reason. Guard sampel kecil (<5).
// =============================================================
import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Headphones, Package, Target, MapPin, Truck, Undo2 } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { EmptyState } from '@/components/ui/empty-state'
import { formatRupiah } from '@/lib/format'
import {
  fetchReturPerCs, fetchReturPerProduk, fetchReturPerCampaign, fetchReturPerWilayah,
  fetchReturPerKurir, fetchReturReasons, returRateColor,
} from '@/lib/supabase/queries/retur'
import type {
  ReturPerCs, ReturPerProduk, ReturPerCampaign, ReturPerWilayah, ReturPerKurir, ReturReason,
} from '@/lib/types'

const supabase = createClient()
const pct = (r: number | null) => r == null ? '—' : `${(Number(r) * 100).toFixed(1)}%`

interface PanelRow {
  key: string
  label: string
  total_final: number; diterima: number; retur: number; fake: number
  return_rate: number | null; small_sample: boolean
  extra?: ReactNode
}

function ReturPanel({
  title, icon: Icon, dimension, rows, loading, extraHead, from, to,
}: {
  title: string; icon: typeof Package; dimension: string
  rows: PanelRow[]; loading: boolean; extraHead?: string[]
  from?: Date | string | null; to?: Date | string | null
}) {
  const [drillKey, setDrillKey] = useState<string | null>(null)
  const [reasons, setReasons] = useState<ReturReason[]>([])
  const [reasonsLoading, setReasonsLoading] = useState(false)

  const onRow = async (r: PanelRow) => {
    if (drillKey === r.key) { setDrillKey(null); return }
    setDrillKey(r.key); setReasons([]); setReasonsLoading(true)
    try {
      setReasons(await fetchReturReasons(supabase, dimension, r.key, from, to))
    } catch { setReasons([]) } finally { setReasonsLoading(false) }
  }

  // Bar: top 8 by return_rate, exclude sampel kecil
  const barData = rows
    .filter(r => !r.small_sample && r.return_rate != null)
    .slice(0, 8)
    .map(r => ({ name: r.label.length > 16 ? r.label.slice(0, 15) + '…' : r.label, rate: Math.round(Number(r.return_rate) * 1000) / 10 }))

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Icon className="w-4 h-4 text-zinc-500" />{title}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <p className="text-xs text-muted-foreground py-4 text-center">Memuat...</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">Belum ada data retur di dimensi ini.</p>
        ) : (
          <>
            {barData.length > 0 && (
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={barData} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                    <XAxis type="number" unit="%" tick={{ fontSize: 10 }} />
                    <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v) => `${v}%`} />
                    <Bar dataKey="rate" radius={[0, 3, 3, 0]}>
                      {barData.map((b, i) => <Cell key={i} fill={b.rate >= 30 ? '#dc2626' : b.rate >= 15 ? '#d97706' : '#7c3aed'} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{title.replace('Per ', '')}</TableHead>
                    <TableHead className="text-right">Diterima</TableHead>
                    <TableHead className="text-right">Retur</TableHead>
                    <TableHead className="text-right">Fake</TableHead>
                    <TableHead className="text-right">Return%</TableHead>
                    {extraHead?.map(h => <TableHead key={h} className="text-right">{h}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(r => (
                    <Fragment key={r.key}>
                      <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => onRow(r)}>
                        <TableCell className="text-sm">
                          {r.label}
                          {r.small_sample && <Badge variant="outline" className="ml-1.5 text-[9px] bg-zinc-500/10 text-zinc-500">sampel kecil</Badge>}
                        </TableCell>
                        <TableCell className="text-right text-sm">{r.diterima}</TableCell>
                        <TableCell className="text-right text-sm">{r.retur}</TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">{r.fake}</TableCell>
                        <TableCell className={`text-right text-sm ${returRateColor(r.return_rate)}`}>{pct(r.return_rate)}</TableCell>
                        {r.extra}
                      </TableRow>
                      {drillKey === r.key && (
                        <TableRow className="bg-muted/20">
                          <TableCell colSpan={5 + (extraHead?.length ?? 0)} className="text-xs py-2">
                            <span className="font-medium text-muted-foreground">Alasan retur: </span>
                            {reasonsLoading ? 'memuat...' : reasons.length === 0 ? 'tidak ada alasan tercatat' : (
                              <span className="inline-flex flex-wrap gap-1.5">
                                {reasons.map((rs, i) => (
                                  <Badge key={i} variant="outline" className="text-[10px]">{rs.reject_reason} · {rs.n}</Badge>
                                ))}
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

export function ReturSection({ from, to }: { from?: Date | string | null; to?: Date | string | null }) {
  const [cs, setCs] = useState<ReturPerCs[]>([])
  const [produk, setProduk] = useState<ReturPerProduk[]>([])
  const [campaign, setCampaign] = useState<ReturPerCampaign[]>([])
  const [wilayah, setWilayah] = useState<ReturPerWilayah[]>([])
  const [kurir, setKurir] = useState<ReturPerKurir[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [a, b, c, d, e] = await Promise.all([
        fetchReturPerCs(supabase, from, to),
        fetchReturPerProduk(supabase, from, to),
        fetchReturPerCampaign(supabase, from, to),
        fetchReturPerWilayah(supabase, from, to),
        fetchReturPerKurir(supabase, from, to),
      ])
      setCs(a); setProduk(b); setCampaign(c); setWilayah(d); setKurir(e)
    } catch {
      setCs([]); setProduk([]); setCampaign([]); setWilayah([]); setKurir([])
    } finally { setLoading(false) }
  }, [from, to])

  useEffect(() => { void load() }, [load])

  const anyData = cs.length || produk.length || campaign.length || wilayah.length || kurir.length
  if (!loading && !anyData) {
    return <EmptyState icon={Undo2} title="Belum ada data retur" description="Belum ada order RETUR di periode ini. View ini bakal keisi seiring data retur masuk." />
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Return rate = RETUR ÷ (DITERIMA + RETUR). FAKE dipisah. Dimensi &lt;5 order final ditandai &quot;sampel kecil&quot; (gak masuk ranking puncak). Klik baris buat lihat alasan retur.
      </p>

      <ReturPanel title="Per Produk" icon={Package} dimension="produk" loading={loading} from={from} to={to}
        rows={produk.map(r => ({ key: String(r.product_id), label: r.product_name, ...r }))} />

      <ReturPanel title="Per CS" icon={Headphones} dimension="cs" loading={loading} from={from} to={to}
        extraHead={['Closing%']}
        rows={cs.map(r => ({
          key: r.cs_id, label: r.cs_name ?? '(tanpa nama)', ...r,
          extra: <TableCell className="text-right text-sm">{r.closing_rate == null ? '—' : `${(Number(r.closing_rate) * 100).toFixed(0)}%`}</TableCell>,
        }))} />

      <ReturPanel title="Per Campaign" icon={Target} dimension="campaign" loading={loading} from={from} to={to}
        extraHead={['CPR', 'Net Profit (after ads)']}
        rows={campaign.map(r => ({
          key: String(r.campaign_id), label: r.campaign_name, ...r,
          extra: <>
            <TableCell className="text-right text-sm">{r.cpr == null ? '—' : formatRupiah(r.cpr)}</TableCell>
            <TableCell className={`text-right text-sm ${Number(r.net_profit_after_ads) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{formatRupiah(r.net_profit_after_ads)}</TableCell>
          </>,
        }))} />

      <ReturPanel title="Per Wilayah" icon={MapPin} dimension="wilayah" loading={loading} from={from} to={to}
        rows={wilayah.map(r => ({ key: r.city, label: r.city, ...r }))} />

      <ReturPanel title="Per Kurir" icon={Truck} dimension="kurir" loading={loading} from={from} to={to}
        rows={kurir.map(r => ({ key: String(r.channel_id), label: r.channel_code ?? r.channel_name ?? `#${r.channel_id}`, ...r }))} />
    </div>
  )
}
