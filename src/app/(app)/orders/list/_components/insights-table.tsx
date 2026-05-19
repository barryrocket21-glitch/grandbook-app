'use client'

import { useMemo, useState } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { ArrowUp, ArrowDown, ArrowUpDown, Search, Loader2 } from 'lucide-react'
import { formatRupiah } from '@/lib/format'
import type { OrderDimensionStat, OrderDimension } from '@/lib/types'
import { ORDER_DIMENSION_LABEL } from '@/lib/types'

type SortKey = 'rank' | 'value' | 'order_count' | 'pct_of_total' | 'total_value' | 'total_payout' | 'total_est_profit'
type SortDir = 'asc' | 'desc'

/**
 * Phase 8I-Followup Part 4F — Table dengan sortable header + searchable.
 * Default sort: order_count DESC. Click row → onSelect(dimension_value).
 */
export function InsightsTable({
  data,
  dimension,
  loading,
  onSelect,
}: {
  data: OrderDimensionStat[]
  dimension: OrderDimension
  loading?: boolean
  onSelect: (dimensionValue: string) => void
}) {
  const [sortKey, setSortKey] = useState<SortKey>('order_count')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [search, setSearch] = useState('')

  const sorted = useMemo(() => {
    const filtered = search.trim()
      ? data.filter(d => d.dimension_value.toLowerCase().includes(search.toLowerCase().trim()))
      : data
    const arr = [...filtered]
    arr.sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'value':
        case 'rank':
          cmp = a.dimension_value.localeCompare(b.dimension_value)
          break
        case 'order_count':
          cmp = Number(a.order_count) - Number(b.order_count)
          break
        case 'pct_of_total':
          cmp = Number(a.pct_of_total) - Number(b.pct_of_total)
          break
        case 'total_value':
          cmp = Number(a.total_value || 0) - Number(b.total_value || 0)
          break
        case 'total_payout':
          cmp = Number(a.total_payout || 0) - Number(b.total_payout || 0)
          break
        case 'total_est_profit':
          cmp = Number(a.total_est_profit || 0) - Number(b.total_est_profit || 0)
          break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return arr
  }, [data, search, sortKey, sortDir])

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setSortDir(k === 'value' ? 'asc' : 'desc') }
  }

  const sortIcon = (k: SortKey) => {
    if (sortKey !== k) return <ArrowUpDown className="w-3 h-3 inline ml-1 text-muted-foreground/50" />
    return sortDir === 'asc'
      ? <ArrowUp className="w-3 h-3 inline ml-1 text-violet-500" />
      : <ArrowDown className="w-3 h-3 inline ml-1 text-violet-500" />
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={`Cari ${ORDER_DIMENSION_LABEL[dimension].toLowerCase()}...`}
          className="pl-9 h-8 text-xs"
        />
      </div>

      <div className="border rounded-md overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-center cursor-pointer hover:bg-muted/50" onClick={() => toggleSort('rank')}>
                #
              </TableHead>
              <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => toggleSort('value')}>
                {ORDER_DIMENSION_LABEL[dimension]} {sortIcon('value')}
              </TableHead>
              <TableHead className="text-right cursor-pointer hover:bg-muted/50" onClick={() => toggleSort('order_count')}>
                Order {sortIcon('order_count')}
              </TableHead>
              <TableHead className="text-right cursor-pointer hover:bg-muted/50 w-16" onClick={() => toggleSort('pct_of_total')}>
                % {sortIcon('pct_of_total')}
              </TableHead>
              <TableHead className="text-right cursor-pointer hover:bg-muted/50" onClick={() => toggleSort('total_value')}>
                Total Value {sortIcon('total_value')}
              </TableHead>
              <TableHead className="text-right cursor-pointer hover:bg-muted/50" onClick={() => toggleSort('total_payout')}>
                Payout {sortIcon('total_payout')}
              </TableHead>
              <TableHead className="text-right cursor-pointer hover:bg-muted/50" onClick={() => toggleSort('total_est_profit')}>
                Est. Profit {sortIcon('total_est_profit')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground text-xs">
                  <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Memuat data...
                </TableCell>
              </TableRow>
            ) : sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground text-xs">
                  {search ? 'Tidak ada match untuk pencarian' : 'Tidak ada data'}
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((row, idx) => (
                <TableRow
                  key={row.dimension_value}
                  className="cursor-pointer hover:bg-violet-500/5"
                  onClick={() => onSelect(row.dimension_value)}
                >
                  <TableCell className="text-center text-xs text-muted-foreground tabular-nums">{idx + 1}</TableCell>
                  <TableCell className="text-xs font-medium truncate max-w-[200px]" title={row.dimension_value}>
                    {row.dimension_value}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {Number(row.order_count).toLocaleString('id-ID')}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                    {Number(row.pct_of_total).toFixed(1)}%
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {formatRupiah(Number(row.total_value || 0))}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                    {row.total_payout != null ? formatRupiah(Number(row.total_payout)) : <span className="italic">—</span>}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {formatRupiah(Number(row.total_est_profit || 0))}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
