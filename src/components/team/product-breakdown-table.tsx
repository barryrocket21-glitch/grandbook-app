'use client'
import { useMemo, useState } from 'react'
import { ArrowUpDown } from 'lucide-react'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/components/ui/empty-state'
import { Package } from 'lucide-react'
import type { ProductBreakdownRow } from '@/lib/types'
import { formatRupiah } from '@/lib/format'
import { cn } from '@/lib/utils'

interface Props {
  rows: ProductBreakdownRow[]
}

type SortKey = 'product_name' | 'total_orders' | 'closing_count' | 'conv_rate' | 'revenue'
type SortDir = 'asc' | 'desc'

export function ProductBreakdownTable({ rows }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('total_orders')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const enriched = useMemo(
    () =>
      rows.map(r => ({
        ...r,
        conv_rate: r.total_orders > 0 ? (r.closing_count / r.total_orders) * 100 : 0,
      })),
    [rows]
  )

  const sorted = useMemo(() => {
    const arr = [...enriched]
    arr.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey]
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      }
      const an = Number(av) || 0, bn = Number(bv) || 0
      return sortDir === 'asc' ? an - bn : bn - an
    })
    return arr
  }, [enriched, sortKey, sortDir])

  const total = useMemo(() => {
    const o = rows.reduce((s, r) => s + r.total_orders, 0)
    const c = rows.reduce((s, r) => s + r.closing_count, 0)
    const rev = rows.reduce((s, r) => s + r.revenue, 0)
    return { orders: o, closing: c, conv: o > 0 ? (c / o) * 100 : 0, revenue: rev }
  }, [rows])

  function clickSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  if (rows.length === 0) {
    return <EmptyState icon={Package} title="Belum ada data produk di periode ini" description="Coba ganti date range." />
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortableHead label="Produk"      col="product_name"   sortKey={sortKey} sortDir={sortDir} onClick={clickSort} />
          <SortableHead label="Total Order" col="total_orders"   sortKey={sortKey} sortDir={sortDir} onClick={clickSort} align="right" />
          <SortableHead label="Closing"     col="closing_count"  sortKey={sortKey} sortDir={sortDir} onClick={clickSort} align="right" />
          <SortableHead label="Conv %"      col="conv_rate"      sortKey={sortKey} sortDir={sortDir} onClick={clickSort} align="right" />
          <SortableHead label="Revenue"     col="revenue"        sortKey={sortKey} sortDir={sortDir} onClick={clickSort} align="right" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map(r => (
          <TableRow key={r.product_id}>
            <TableCell className="font-medium">{r.product_name}</TableCell>
            <TableCell className="text-right tabular-nums">{r.total_orders.toLocaleString('id-ID')}</TableCell>
            <TableCell className="text-right tabular-nums">{r.closing_count.toLocaleString('id-ID')}</TableCell>
            <TableCell className={cn('text-right tabular-nums', r.conv_rate >= 50 ? 'text-emerald-500' : r.conv_rate >= 30 ? 'text-amber-500' : 'text-muted-foreground')}>
              {r.conv_rate.toFixed(1)}%
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatRupiah(r.revenue)}</TableCell>
          </TableRow>
        ))}
        <TableRow className="font-semibold border-t-2 bg-muted/30">
          <TableCell>Total</TableCell>
          <TableCell className="text-right tabular-nums">{total.orders.toLocaleString('id-ID')}</TableCell>
          <TableCell className="text-right tabular-nums">{total.closing.toLocaleString('id-ID')}</TableCell>
          <TableCell className="text-right tabular-nums">{total.conv.toFixed(1)}%</TableCell>
          <TableCell className="text-right tabular-nums">{formatRupiah(total.revenue)}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
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
