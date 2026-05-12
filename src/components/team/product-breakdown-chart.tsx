'use client'
import { useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer, Legend,
} from 'recharts'
import type { ProductBreakdownRow } from '@/lib/types'

interface Props {
  rows: ProductBreakdownRow[]
  topN?: number
}

const TRUNCATE = 22

/**
 * Horizontal bar chart per produk dengan 2 bar: total orders (light) +
 * closing (dark). Sort by total_orders DESC. Top N produk ditampilkan
 * utuh; sisanya di-aggregate sebagai "Lainnya" supaya chart tetap clean.
 */
export function ProductBreakdownChart({ rows, topN = 10 }: Props) {
  const data = useMemo(() => {
    if (rows.length === 0) return []
    const sorted = [...rows].sort((a, b) => b.total_orders - a.total_orders)
    const top = sorted.slice(0, topN)
    const rest = sorted.slice(topN)
    const top_orders = top.map(r => ({
      name: r.product_name.length > TRUNCATE ? r.product_name.slice(0, TRUNCATE - 1) + '…' : r.product_name,
      fullName: r.product_name,
      total_orders: r.total_orders,
      closing: r.closing_count,
    }))
    if (rest.length > 0) {
      top_orders.push({
        name: `Lainnya (${rest.length})`,
        fullName: `Aggregate dari ${rest.length} produk sisanya`,
        total_orders: rest.reduce((s, r) => s + r.total_orders, 0),
        closing: rest.reduce((s, r) => s + r.closing_count, 0),
      })
    }
    return top_orders
  }, [rows, topN])

  if (data.length === 0) {
    return (
      <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">
        Belum ada data produk di periode ini
      </div>
    )
  }

  const height = Math.max(220, data.length * 36 + 64)

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, left: 16, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgb(148 163 184 / 0.2)" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={140} />
        <RechartsTooltip
          contentStyle={{ background: 'rgb(15 23 42 / 0.95)', border: '1px solid rgb(148 163 184 / 0.3)', borderRadius: 6, fontSize: 12 }}
          labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName ?? ''}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="total_orders" name="Total order"   fill="#a78bfa" radius={[0, 4, 4, 0]} />
        <Bar dataKey="closing"      name="Closing"        fill="#10b981" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
