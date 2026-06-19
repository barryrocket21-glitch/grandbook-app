'use client'

import { useCallback, useEffect, useState } from 'react'
import { getErrorMessage } from '@/lib/errors'
import { useRouter } from 'next/navigation'
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { BarChart3 } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { formatRupiah } from '@/lib/format'
import { InsightsChart } from './insights-chart'
import { InsightsTable } from './insights-table'
import { ORDER_DIMENSION_LABEL } from '@/lib/types'
import type { OrderDimension, OrderDimensionStat, OrderStatus } from '@/lib/types'
import { INTERNAL_STATUSES, STATUS_LABEL } from '@/lib/schemas/settings'

const supabase = createClient()

/**
 * Phase 8I-Followup Part 4F — Insights drawer.
 *
 * Sheet slide-out dari /orders/list dengan group-by visualization:
 *   - Top bar chart (top 10 dimension)
 *   - Sortable + searchable table
 *   - Click row → close drawer + filter URL param di /orders/list
 *
 * Click-through URL params:
 *   - status → ?status=DITERIMA (existing support, full filter)
 *   - day/week/month → ?from=&to= (RPC supports, full filter)
 *   - city/province/product/supplier/channel/payment_method → set URL param
 *     tapi belum di-wire ke RPC filter (Part 4D scope). User dapat toast
 *     "filter detail Part 4D".
 */
export function InsightsDrawer({
  initialFrom,
  initialTo,
  initialStatus,
}: {
  initialFrom?: string | null
  initialTo?: string | null
  initialStatus?: 'ALL' | OrderStatus
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [dimension, setDimension] = useState<OrderDimension>('city')
  const [from, setFrom] = useState<string>(initialFrom ?? '')
  const [to, setTo] = useState<string>(initialTo ?? '')
  const [statusFilter, setStatusFilter] = useState<'ALL' | OrderStatus>(initialStatus ?? 'ALL')
  const [data, setData] = useState<OrderDimensionStat[]>([])
  const [loading, setLoading] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase.rpc('get_orders_by_dimension', {
        p_dimension: dimension,
        p_from: from || null,
        p_to: to || null,
        p_status: statusFilter === 'ALL' ? null : statusFilter,
      })
      if (error) throw error
      setData((data || []) as OrderDimensionStat[])
    } catch (err) {
      toast.error('Gagal load insights', { description: getErrorMessage(err) })
      setData([])
    } finally {
      setLoading(false)
    }
  }, [dimension, from, to, statusFilter])

  // Fetch saat drawer dibuka atau filter berubah
  useEffect(() => {
    if (open) void fetchData()
  }, [open, fetchData])

  const grandCount = data.reduce((sum, d) => sum + Number(d.order_count), 0)
  const grandValue = data.reduce((sum, d) => sum + Number(d.total_value || 0), 0)

  const handleSelect = (dimValue: string) => {
    // Close drawer + push URL param sesuai dimension
    setOpen(false)
    const params = new URLSearchParams()
    // status param yang sudah di-wire di /orders/list page
    if (dimension === 'status') {
      params.set('status', dimValue)
    } else if (dimension === 'day') {
      // dimValue = YYYY-MM-DD
      params.set('from', dimValue)
      params.set('to', dimValue)
    } else if (dimension === 'week') {
      // dimValue = YYYY-WNN — tidak straightforward convert ke date range,
      // skip auto-filter, toast aja
      toast.info('Filter per minggu belum di-wire ke tabel', {
        description: `Group ${dimValue} memiliki ${data.find(d => d.dimension_value === dimValue)?.order_count ?? 0} order`,
      })
      return
    } else if (dimension === 'month') {
      // dimValue = YYYY-MM → set from = YYYY-MM-01, to = last day of month
      const [y, m] = dimValue.split('-').map(Number)
      if (y && m) {
        const fromStr = `${y}-${String(m).padStart(2, '0')}-01`
        const lastDay = new Date(y, m, 0).getDate()
        const toStr = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
        params.set('from', fromStr)
        params.set('to', toStr)
      }
    } else {
      // city/province/product/supplier/channel/payment_method:
      // set URL params (future-proof untuk Part 4D), toast info
      params.set(URL_PARAM_BY_DIMENSION[dimension], dimValue)
      toast.info(`${ORDER_DIMENSION_LABEL[dimension]}: ${dimValue}`, {
        description: 'Filter detail di tabel akan apply setelah Part 4D (per-column filter)',
      })
    }
    const qs = params.toString()
    router.push(qs ? `/orders/list?${qs}` : '/orders/list')
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={
        <Button variant="outline" size="sm" className="gap-1.5">
          <BarChart3 className="w-3.5 h-3.5" />
          Insights
        </Button>
      } />
      <SheetContent className="w-full sm:max-w-2xl p-0 flex flex-col">
        <SheetHeader className="p-4 border-b">
          <SheetTitle className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-zinc-500" />
            Analisa Order
          </SheetTitle>
          <SheetDescription>
            Group by dimension untuk insight cepat. Klik row → filter ke {ORDER_DIMENSION_LABEL[dimension].toLowerCase()} itu di tabel.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
          {/* Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Group by</Label>
              <Select
                value={dimension}
                onValueChange={(v) => v && setDimension(v as OrderDimension)}
              >
                <SelectTrigger className="w-full h-8 text-xs">
                  {/* Fix 3 (4-quick-fixes): render-fn supaya SelectValue display label
                      Indonesia, bukan internal value ('city' → 'Kota' dst). */}
                  <SelectValue>
                    {(v: string | null) => v ? ORDER_DIMENSION_LABEL[v as OrderDimension] ?? v : 'Pilih dimensi'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ORDER_DIMENSION_LABEL) as OrderDimension[]).map((d) => (
                    <SelectItem key={d} value={d}>{ORDER_DIMENSION_LABEL[d]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <Select
                value={statusFilter}
                onValueChange={(v) => v && setStatusFilter(v as 'ALL' | OrderStatus)}
              >
                <SelectTrigger className="w-full h-8 text-xs">
                  <SelectValue>
                    {(v: string | null) => {
                      if (!v || v === 'ALL') return 'Semua status'
                      return STATUS_LABEL[v as OrderStatus] ?? v
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Semua status</SelectItem>
                  {INTERNAL_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tanggal</Label>
              <div className="flex gap-1">
                <Input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="h-8 text-xs"
                />
                <Input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            </div>
          </div>

          {/* Chart */}
          <div className="border rounded-md p-3 bg-card">
            <div className="text-xs font-medium text-muted-foreground mb-2">
              Top 10 {ORDER_DIMENSION_LABEL[dimension]}
            </div>
            <InsightsChart data={data} loading={loading} />
          </div>

          {/* Table */}
          <InsightsTable
            data={data}
            dimension={dimension}
            loading={loading}
            onSelect={handleSelect}
          />
        </div>

        {/* Footer summary */}
        <div className="border-t p-3 flex items-center justify-between bg-muted/30">
          <div className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground tabular-nums">
              {grandCount.toLocaleString('id-ID')}
            </span> order
            {grandValue > 0 && (
              <>
                {' · '}
                <span className="font-medium text-foreground tabular-nums">
                  {formatRupiah(grandValue)}
                </span> total value
              </>
            )}
          </div>
          <Badge variant="outline" className="text-[10px]">
            {data.length} {ORDER_DIMENSION_LABEL[dimension].toLowerCase()} unik
          </Badge>
        </div>
      </SheetContent>
    </Sheet>
  )
}

const URL_PARAM_BY_DIMENSION: Record<OrderDimension, string> = {
  city: 'city',
  province: 'province',
  product: 'product',
  supplier: 'supplier',
  channel: 'channel',
  status: 'status',
  payment_method: 'pm',
  day: 'from',
  week: 'week',
  month: 'from',
}
