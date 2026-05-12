'use client'
import { useState, useMemo } from 'react'
import { X, Save, Lightbulb } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Combobox } from '@/components/ui/combobox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import type {
  SimulatorInput,
  ProductForSimulator,
  JenisIklan,
} from '@/lib/types'
import { calculate, formatIDR, formatPct, getInsight } from '@/lib/margin-simulator/calc'
import { JENIS_IKLAN_OPTIONS } from '@/lib/schemas/settings'
import { cn } from '@/lib/utils'

export interface ScenarioState {
  uid: string
  name: string
  input: SimulatorInput
}

interface Props {
  scenario: ScenarioState
  products: ProductForSimulator[]
  onChange: (next: ScenarioState) => void
  onRemove: () => void
  canRemove: boolean
  onSavePreset: (args: {
    scenario: ScenarioState
    scenarioName: string
    isDefault: boolean
    notes: string | null
  }) => Promise<void>
  canWrite: boolean
}

export function ScenarioCard({
  scenario,
  products,
  onChange,
  onRemove,
  canRemove,
  onSavePreset,
  canWrite,
}: Props) {
  const [saveOpen, setSaveOpen] = useState(false)
  const [savingScenarioName, setSavingScenarioName] = useState('')
  const [savingNotes, setSavingNotes] = useState('')
  const [savingIsDefault, setSavingIsDefault] = useState(false)
  const [saving, setSaving] = useState(false)

  const product = useMemo(
    () => products.find(p => p.product_id === scenario.input.product_id) || null,
    [products, scenario.input.product_id]
  )

  const output = useMemo(() => calculate(scenario.input), [scenario.input])
  const insight = useMemo(() => getInsight(scenario.input, output), [scenario.input, output])

  function updateInput<K extends keyof SimulatorInput>(key: K, value: SimulatorInput[K]) {
    onChange({ ...scenario, input: { ...scenario.input, [key]: value } })
  }

  function handleProductPick(value: string) {
    const id = value ? Number(value) : null
    const picked = id ? products.find(p => p.product_id === id) || null : null
    onChange({
      ...scenario,
      input: {
        ...scenario.input,
        product_id: id,
        margin_item: picked ? picked.margin_item : scenario.input.margin_item,
      },
    })
  }

  function handleJenisIklan(value: JenisIklan) {
    const hint = JENIS_IKLAN_OPTIONS.find(o => o.value === value)
    onChange({
      ...scenario,
      input: {
        ...scenario.input,
        jenis_iklan: value,
        multiplier: hint ? hint.hintMultiplier : scenario.input.multiplier,
      },
    })
  }

  async function handleSave() {
    if (!scenario.input.product_id) return
    if (!savingScenarioName.trim()) return
    setSaving(true)
    try {
      await onSavePreset({
        scenario,
        scenarioName: savingScenarioName.trim(),
        isDefault: savingIsDefault,
        notes: savingNotes.trim() || null,
      })
      setSaveOpen(false)
      setSavingScenarioName('')
      setSavingNotes('')
      setSavingIsDefault(false)
    } finally {
      setSaving(false)
    }
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
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <Input
            value={scenario.name}
            onChange={e => onChange({ ...scenario, name: e.target.value })}
            className="h-8 font-semibold text-sm"
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

        {/* Product */}
        <div className="space-y-1">
          <Label className="text-xs">Produk</Label>
          <Combobox
            value={scenario.input.product_id ? String(scenario.input.product_id) : ''}
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
              {product.has_default_preset && (
                <Badge variant="outline" className="ml-2 text-[10px]">
                  punya default preset
                </Badge>
              )}
            </p>
          )}
        </div>

        {/* Inputs */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <div className="space-y-1 col-span-2">
            <Label className="text-xs">Margin Item (Rp)</Label>
            <Input
              type="number"
              inputMode="decimal"
              value={scenario.input.margin_item}
              onChange={e => updateInput('margin_item', Number(e.target.value) || 0)}
              min={0}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">CPR Max (Rp)</Label>
            <Input
              type="number"
              inputMode="decimal"
              value={scenario.input.cpr_max}
              onChange={e => updateInput('cpr_max', Number(e.target.value) || 0)}
              min={0}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Lead Dashboard</Label>
            <Input
              type="number"
              inputMode="numeric"
              value={scenario.input.lead_dashboard}
              onChange={e => updateInput('lead_dashboard', Math.max(0, Math.floor(Number(e.target.value) || 0)))}
              min={0}
              step={1}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Jenis Iklan</Label>
            <Select
              value={scenario.input.jenis_iklan}
              onValueChange={v => v && handleJenisIklan(v as JenisIklan)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pilih" />
              </SelectTrigger>
              <SelectContent>
                {JENIS_IKLAN_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Multiplier</Label>
            <Input
              type="number"
              inputMode="decimal"
              value={scenario.input.multiplier}
              onChange={e => updateInput('multiplier', Math.min(10, Math.max(0.01, Number(e.target.value) || 0.01)))}
              min={0.01}
              max={10}
              step={0.1}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Closing %</Label>
            <Input
              type="number"
              inputMode="decimal"
              value={scenario.input.closing_rate}
              onChange={e => updateInput('closing_rate', Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
              min={0}
              max={100}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">RTS %</Label>
            <Input
              type="number"
              inputMode="decimal"
              value={scenario.input.rts_rate}
              onChange={e => updateInput('rts_rate', Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
              min={0}
              max={100}
            />
          </div>
          <div className="space-y-1 col-span-2">
            <Label className="text-xs">PPN %</Label>
            <Input
              type="number"
              inputMode="decimal"
              value={scenario.input.ppn_rate}
              onChange={e => updateInput('ppn_rate', Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
              min={0}
              max={100}
            />
          </div>
        </div>

        {/* Outputs */}
        <div className="pt-2 border-t border-border space-y-1 text-xs">
          <Row label="Lead Real"   value={output.lead_real.toFixed(0)} />
          <Row label="Closing"     value={output.closing.toFixed(1)} />
          <Row label="Terkirim"    value={output.terkirim.toFixed(1)} />
          <Row label="Budget"      value={formatIDR(output.budget_iklan)} />
          <Row label="Gross Margin" value={formatIDR(output.gross_margin)} />
          <Row label="PPN"         value={formatIDR(output.ppn_amount)} />
          <Row label="Total Margin" value={formatIDR(output.total_margin)} bold />
          <Row label="Profit / Loss" value={formatIDR(output.profit_loss)} bold
               valueClass={output.profit_loss > 0 ? 'text-emerald-500' : output.profit_loss < 0 ? 'text-red-500' : ''} />
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

        {/* Save */}
        <Button
          variant="outline"
          className="w-full"
          onClick={() => {
            setSavingScenarioName(scenario.name)
            setSavingNotes('')
            setSavingIsDefault(false)
            setSaveOpen(true)
          }}
          disabled={!canWrite || !scenario.input.product_id}
        >
          <Save className="size-4 mr-2" />
          Save Preset
        </Button>
      </CardContent>

      {/* Save dialog */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save Preset</DialogTitle>
            <DialogDescription>
              Simpan asumsi ini supaya bisa di-load ulang nanti. Default preset akan dipakai
              auto saat buka simulator untuk produk ini.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="scenario-name">Nama Scenario</Label>
              <Input
                id="scenario-name"
                value={savingScenarioName}
                onChange={e => setSavingScenarioName(e.target.value)}
                placeholder="Contoh: Form 20% Close 1.0x"
                maxLength={80}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="notes">Catatan (optional)</Label>
              <Input
                id="notes"
                value={savingNotes}
                onChange={e => setSavingNotes(e.target.value)}
                placeholder="Asumsi konservatif untuk produk margin tipis"
                maxLength={500}
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={savingIsDefault}
                onCheckedChange={v => setSavingIsDefault(v === true)}
              />
              <span className="text-sm">Set sebagai default untuk produk ini</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)} disabled={saving}>
              Batal
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !savingScenarioName.trim() || !scenario.input.product_id}
            >
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
