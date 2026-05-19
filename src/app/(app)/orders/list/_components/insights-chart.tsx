'use client'

import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, LabelList, Cell,
} from 'recharts'
import { Loader2 } from 'lucide-react'
import type { OrderDimensionStat } from '@/lib/types'

/**
 * Phase 8I-Followup Part 4F — Bar chart horizontal (vertical layout) untuk
 * top 10 dimension. Bar color violet-500 dengan opacity scaled (top 1 full,
 * bottom = 0.5) supaya highlight ranking. Recharts ResponsiveContainer
 * supaya scale ke width drawer.
 */
export function InsightsChart({
  data,
  loading,
}: {
  data: OrderDimensionStat[]
  loading?: boolean
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm">Memuat chart...</span>
      </div>
    )
  }

  const top10 = data.slice(0, 10).map((d, i) => ({
    name: truncateLabel(d.dimension_value, 28),
    full: d.dimension_value,
    count: Number(d.order_count),
    rank: i + 1,
  }))

  if (top10.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Tidak ada data untuk ditampilkan.
      </div>
    )
  }

  const maxCount = Math.max(...top10.map(d => d.count), 1)

  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          layout="vertical"
          data={top10}
          margin={{ top: 8, right: 32, bottom: 8, left: 0 }}
        >
          <XAxis type="number" tick={{ fontSize: 10 }} stroke="currentColor" className="text-muted-foreground" />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fontSize: 10 }}
            width={140}
            stroke="currentColor"
            className="text-muted-foreground"
          />
          <RechartsTooltip
            content={({ active, payload }) => {
              if (!active || !payload || !payload[0]) return null
              const item = payload[0].payload as { full: string; count: number; rank: number }
              return (
                <div className="rounded-md bg-foreground text-background px-3 py-1.5 text-xs">
                  <div className="font-medium">#{item.rank} · {item.full}</div>
                  <div className="opacity-80">{item.count.toLocaleString('id-ID')} order</div>
                </div>
              )
            }}
            cursor={{ fill: 'rgba(139, 92, 246, 0.05)' }}
          />
          <Bar dataKey="count" radius={[0, 4, 4, 0]}>
            {top10.map((d) => (
              <Cell
                key={d.rank}
                fill="rgb(139, 92, 246)"
                fillOpacity={Math.max(0.5, d.count / maxCount)}
              />
            ))}
            <LabelList
              dataKey="count"
              position="right"
              className="fill-foreground"
              style={{ fontSize: 10, fontWeight: 500 }}
              formatter={(v: unknown) => (typeof v === 'number' ? v.toLocaleString('id-ID') : String(v))}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function truncateLabel(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + '…'
}
