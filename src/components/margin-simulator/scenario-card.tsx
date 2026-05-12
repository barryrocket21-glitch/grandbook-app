'use client'
import { useMemo } from 'react'
import { X, Lightbulb } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Combobox } from '@/components/ui/combobox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  FUNNEL_OPTIONS,
  type Funnel,
  type ProductForSimulator,
  type SimulatorScenario,
  type PeriodeDays,
  PERIODE_OPTIONS,
} from '@/lib/types'
import { calculate, formatIDR, formatPct, getInsight } from '@/lib/margin-simulator/calc'
import { cn } from '@/lib/utils'

interface Props {
  scenario: SimulatorScenario
  periode: PeriodeDays
  products: ProductForSimulator[]
  onChange: (next: SimulatorScenario) => void
  onRemove: () => void
  canRemove: boolean
}

export function ScenarioCard({ scenario, periode, products, onChange, onRemove, canRemove }: Props) {
  const product = useMemo(
    () => products.find(p => p.product_id === scenario.product_id) || null,
    [products, scenario.product_id]
  )

  const output = useMemo(() => calculate(scenario, periode), [scenario, periode])
  const insight = useMemo(() => getInsight(scenario, output), [scenario, output])
  const periodeLabel = useMemo(
    () => PERIODE_OPTIONS.find(p => p.days === periode)?.label ?? `${periode} hari`,
    [periode]
  )

  function update<K extends keyof SimulatorScenario>(key: K, value: SimulatorScenario[K]) {
    onChange({ ...scenario, [key]: value })
  }

  function handleProductPick(value: string) {
    const id = value ? Number(value) : null
    const picked = id ? products.find(p => p.product_id === id) || null : null
    onChange({
      ...scenario,
      product_id: id,
      margin_item: picked ? picked.margin_item : scenario.margin_item,
    })
  }

  const statusColor =
    output.status === 'profit'
      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
      : output.status === 'loss'
        ? 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30'
        : 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30'
  const statusLabel =
    output.status === 'profit' ? 'PROFIT' : output.status === 'loss' ? 'LOSS' : 'BREAKEVEN'

  return (
    <Card className="w-full md:w-[360px] shrink-0">
      <CardContent className="p-4 space-y-3">
        {/* Header: name + remove */}
        <div className="flex items-center justify-between gap-2">
          <Input
            value={scenario.name}
            onChange={e => update('name', e.target.value)}
            className="h-8 font-semibold text-sm"
            maxLength={80}
          />
          <Button
            size="icon"
            variant="ghost"
            onClick={onRemove}
            disabled={!canRemove}
            aria-label="Hapus scenario"
            title={canRemove ? 'Hapus scenario' : 'Minimal 1 scenario'}
            className="shrink-0"
          >
            <X className="size-4" />
          </Button>
        </div>

        {/* Product picker */}
        <div className="space-y-1">
          <Label className="text-xs">Produk</Label>
          <Combobox
            value={scenario.product_id ? String(scenario.product_id) : ''}
            onChange={handleProductPick}
            options={products.map(p => ({
              value: String(p.product_id),
              label: p.product_name,
              hint: p.sku || undefined,
            }))}
            placeholder="Pilih produk"
            searchPlaceholder="Cari produk..."
            emptyHint={{
              message: 'Belum ada produk aktif.',
              actionLabel: 'Buka /products',
              actionHref: '/products',
            }}
          />
          {product && (
            <p className="text-[11px] text-muted-foreground">
              {formatIDR(product.price_default)} − HPP {formatIDR(product.hpp)} = margin {formatIDR(product.margin_item)}
            </p>
          )}
        </div>

        {/* Inputs grid */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <div className="space-y-1 col-span-2">
            <Label className="text-xs">Margin item (Rp)</Label>
            <Input
              type="number"
              inputMode="decimal"
              value={scenario.margin_item}
              onChange={e => update('margin_item', Number(e.target.value) || 0)}
              min={0}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">CPR max (Rp)</Label>
            <Input
              type="number"
              inputMode="decimal"
              value={scenario.cpr_max}
              onChange={e => update('cpr_max', Number(e.target.value) || 0)}
              min={0}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Lead dashboard / hari</Label>
            <Input
              type="number"
              inputMode="numeric"
              value={scenario.lead_dashboard}
              onChange={e => update('lead_dashboard', Math.max(0, Math.floor(Number(e.target.value) || 0)))}
              min={0}
              step={1}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Funnel</Label>
            <Select
              value={scenario.funnel}
              onValueChange={v => v && update('funnel', v as Funnel)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pilih funnel" />
              </SelectTrigger>
              <SelectContent>
                {FUNNEL_OPTIONS.map(f => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Lead real (%)</Label>
            <Input
              type="number"
              inputMode="decimal"
              value={scenario.lead_real_pct}
              onChange={e => update('lead_real_pct', Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
              min={0}
              max={100}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Closing rate (%)</Label>
            <Input
              type="number"
              inputMode="decimal"
              value={scenario.closing_rate}
              onChange={e => update('closing_rate', Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
              min={0}
              max={100}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">RTS rate (%)</Label>
            <Input
              type="number"
              inputMode="decimal"
              value={scenario.rts_rate}
              onChange={e => update('rts_rate', Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
              min={0}
              max={100}
            />
          </div>
          <div className="space-y-1 col-span-2">
            <Label className="text-xs">PPN (%)</Label>
            <Input
              type="number"
              inputMode="decimal"
              value={scenario.ppn_rate}
              onChange={e => update('ppn_rate', Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
              min={0}
              max={100}
            />
          </div>
        </div>

        {/* Output */}
        <div className="pt-2 border-t border-border space-y-1 text-xs">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">
            Output / {periodeLabel}
          </div>
          <Row label="Lead real"     value={output.lead_real.toFixed(0)} />
          <Row label="Closing"       value={output.closing.toFixed(1)} />
          <Row label="Terkirim"      value={output.terkirim.toFixed(1)} />
          <Row label="Budget iklan"  value={formatIDR(output.budget_iklan)} />
          <Row label="Total margin"  value={formatIDR(output.total_margin)} bold />
          <Row
            label="Profit / loss"
            value={formatIDR(output.profit_loss)}
            bold
            valueClass={output.profit_loss > 0 ? 'text-emerald-500' : output.profit_loss < 0 ? 'text-red-500' : ''}
          />
        </div>

        {/* Status badge */}
        <div className={cn('rounded-lg border px-3 py-2 flex items-center justify-between', statusColor)}>
          <span className="text-xs font-semibold">ROI</span>
          <span className="text-base font-bold">{formatPct(output.roi_percent)}</span>
          <span className="text-xs font-bold tracking-wide">{statusLabel}</span>
        </div>

        {/* Insight */}
        <div className="rounded-md bg-muted/50 px-3 py-2 flex gap-2 items-start text-[11px] leading-snug">
          <Lightbulb className="size-3.5 shrink-0 mt-0.5 text-amber-500" />
          <span>{insight}</span>
        </div>
      </CardContent>
    </Card>
  )
}

function Row({
  label,
  value,
  bold,
  valueClass,
}: {
  label: string
  value: string
  bold?: boolean
  valueClass?: string
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn(bold ? 'font-semibold' : '', valueClass)}>{value}</span>
    </div>
  )
}
