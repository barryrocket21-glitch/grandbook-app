'use client'
// =============================================================
// PerProdukSection (Phase 6 redesign)
//
// Tabel ringkas per produk dengan kolom: Produk / Revenue / CS Lead /
// Closing / Close % / ROAS / Action. Klik "Detail" → /analytics/produk/[id].
//
// Sumber data: analytics_funnel_per_product (Phase 6) — sudah ada
// cs_lead_count, cs_closing_count, close_rate_cs, system_revenue, roas_system.
// =============================================================
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { ArrowRight, Loader2, ChevronUp, ChevronDown, ArrowUpDown } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Package } from 'lucide-react'
import { formatRupiah, formatNumber } from '@/lib/format'
import type { FunnelPerProductRow } from '@/lib/supabase/queries/analytics'

type SortKey = 'revenue' | 'cs_lead' | 'closing' | 'close_rate' | 'roas'
type SortDir = 'desc' | 'asc'

interface Props {
  rows: FunnelPerProductRow[]
  loading: boolean
}

export function PerProdukSection({ rows, loading }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('revenue')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir(sortDir === 'desc' ? 'asc' : 'desc')
    else { setSortKey(k); setSortDir('desc') }
  }

  const sorted = useMemo(() => {
    const dir = sortDir === 'desc' ? -1 : 1
    return [...rows].sort((a, b) => {
      const av = sortKey === 'revenue' ? Number(a.system_revenue)
        : sortKey === 'cs_lead' ? Number(a.cs_lead_count)
        : sortKey === 'closing' ? Number(a.cs_closing_count)
        : sortKey === 'close_rate' ? Number(a.close_rate_cs)
        : Number(a.roas_system)
      const bv = sortKey === 'revenue' ? Number(b.system_revenue)
        : sortKey === 'cs_lead' ? Number(b.cs_lead_count)
        : sortKey === 'closing' ? Number(b.cs_closing_count)
        : sortKey === 'close_rate' ? Number(b.close_rate_cs)
        : Number(b.roas_system)
      return (av - bv) * dir
    })
  }, [rows, sortKey, sortDir])

  const SortHead = ({ label, k, align = 'right' }: { label: string; k: SortKey; align?: 'left' | 'right' }) => {
    const active = k === sortKey
    return (
      <TableHead className={`cursor-pointer select-none hover:bg-muted/50 text-${align}`} onClick={() => toggleSort(k)}>
        <span className={`inline-flex items-center gap-1 ${active ? 'text-violet-500 font-semibold' : ''}`}>
          {label}
          {active
            ? sortDir === 'desc' ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />
            : <ArrowUpDown className="w-3 h-3 opacity-30" />}
        </span>
      </TableHead>
    )
  }

  return (
    <Card>
      <CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produk</TableHead>
              <SortHead label="Revenue" k="revenue" />
              <SortHead label="CS Lead" k="cs_lead" />
              <SortHead label="Closing" k="closing" />
              <SortHead label="Close %" k="close_rate" />
              <SortHead label="ROAS" k="roas" />
              <TableHead className="text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-12 text-center">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                </TableCell>
              </TableRow>
            ) : sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="p-0">
                  <EmptyState
                    icon={Package}
                    title="Belum ada data produk di periode ini"
                    description="Pastikan ada ad_spend, daily_cs_report, atau orders dalam date range."
                  />
                </TableCell>
              </TableRow>
            ) : sorted.map(r => {
              const revenue = Number(r.system_revenue)
              const csLead = Number(r.cs_lead_count)
              const csClose = Number(r.cs_closing_count)
              const closeRate = Number(r.close_rate_cs)
              const roas = Number(r.roas_system)
              return (
                <TableRow key={r.product_id}>
                  <TableCell>
                    <div className="text-sm font-medium">{r.product_name || `#${r.product_id}`}</div>
                    {r.category_name && (
                      <Badge variant="outline" className="text-[10px] mt-0.5">{r.category_name}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    {r.has_system_data ? formatRupiah(revenue) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    {r.has_cs_data ? formatNumber(csLead) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    {r.has_cs_data ? formatNumber(csClose) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right">
                    {r.has_cs_data && csLead > 0 ? (
                      <Badge variant="outline" className={`text-[10px] ${closeRate >= 30 ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' : closeRate >= 10 ? 'bg-amber-500/10 text-amber-600 border-amber-500/30' : 'bg-red-500/10 text-red-600 border-red-500/30'}`}>
                        {closeRate.toFixed(1)}%
                      </Badge>
                    ) : <span className="text-[10px] text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right">
                    {r.has_meta_data && roas > 0 ? (
                      <Badge variant="outline" className={`text-[10px] ${roas >= 2 ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' : roas >= 1 ? 'bg-amber-500/10 text-amber-600 border-amber-500/30' : 'bg-red-500/10 text-red-600 border-red-500/30'}`}>
                        {roas.toFixed(2)}x
                      </Badge>
                    ) : <span className="text-[10px] text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={`/analytics/produk/${r.product_id}`}>
                      <Button variant="ghost" size="sm" className="text-violet-500 hover:text-violet-600">
                        Detail <ArrowRight className="w-3.5 h-3.5 ml-1" />
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
