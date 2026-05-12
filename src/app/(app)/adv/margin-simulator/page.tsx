'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Calculator, Plus, ShieldOff } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { canAccessMarginSimulator } from '@/lib/auth/permissions'
import {
  fetchProductsForSimulator,
  fetchAllPresets,
  savePreset,
  deletePreset,
  setPresetDefault,
} from '@/lib/supabase/queries/margin-simulator'
import { DEFAULT_INPUT } from '@/lib/margin-simulator/calc'
import type {
  MarginSimulatorPreset,
  ProductForSimulator,
  SimulatorInput,
} from '@/lib/types'
import { ScenarioCard, type ScenarioState } from '@/components/margin-simulator/scenario-card'
import { SavedPresetsTable } from '@/components/margin-simulator/saved-presets-table'

const MAX_SCENARIOS = 3
const supabase = createClient()

function makeUid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function presetToScenario(preset: MarginSimulatorPreset): ScenarioState {
  return {
    uid: makeUid(),
    name: preset.scenario_name,
    input: {
      product_id: preset.product_id,
      margin_item: Number(preset.margin_item),
      cpr_max: Number(preset.cpr_max),
      lead_dashboard: preset.lead_dashboard,
      jenis_iklan: preset.jenis_iklan,
      multiplier: Number(preset.multiplier),
      closing_rate: Number(preset.closing_rate),
      rts_rate: Number(preset.rts_rate),
      ppn_rate: Number(preset.ppn_rate),
    },
  }
}

function blankScenario(name = 'Scenario A'): ScenarioState {
  return { uid: makeUid(), name, input: { ...DEFAULT_INPUT } }
}

export default function MarginSimulatorPage() {
  const { profile, role, loading: authLoading } = useAuth()
  const allowed = canAccessMarginSimulator(role)
  const orgId = profile?.organization_id ?? null

  const [products, setProducts] = useState<ProductForSimulator[]>([])
  const [presets, setPresets] = useState<MarginSimulatorPreset[]>([])
  const [loading, setLoading] = useState(true)
  const [scenarios, setScenarios] = useState<ScenarioState[]>([blankScenario('Scenario A')])
  const initRef = useRef(false)

  const loadData = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      const [prods, ps] = await Promise.all([
        fetchProductsForSimulator(supabase, orgId),
        fetchAllPresets(supabase),
      ])
      setProducts(prods)
      setPresets(ps)
    } catch (err) {
      toast.error('Gagal load data', {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    if (!allowed || !orgId || initRef.current) return
    initRef.current = true
    loadData()
  }, [allowed, orgId, loadData])

  function addScenario() {
    if (scenarios.length >= MAX_SCENARIOS) return
    const nameIdx = scenarios.length
    const letter = String.fromCharCode('A'.charCodeAt(0) + nameIdx)
    setScenarios(s => [...s, blankScenario(`Scenario ${letter}`)])
  }

  function updateScenario(uid: string, next: ScenarioState) {
    setScenarios(s => s.map(sc => (sc.uid === uid ? next : sc)))
  }

  function removeScenario(uid: string) {
    setScenarios(s => (s.length <= 1 ? s : s.filter(sc => sc.uid !== uid)))
  }

  function loadPresetIntoNewScenario(preset: MarginSimulatorPreset) {
    if (scenarios.length >= MAX_SCENARIOS) {
      toast.error('Maks 3 scenarios per sesi. Hapus salah satu dulu.')
      return
    }
    setScenarios(s => [...s, presetToScenario(preset)])
    toast.success(`Loaded "${preset.scenario_name}"`)
  }

  async function handleSavePreset(args: {
    scenario: ScenarioState
    scenarioName: string
    isDefault: boolean
    notes: string | null
  }) {
    if (!orgId || !args.scenario.input.product_id) return
    try {
      const inputs: Omit<SimulatorInput, 'product_id'> = {
        margin_item: args.scenario.input.margin_item,
        cpr_max: args.scenario.input.cpr_max,
        lead_dashboard: args.scenario.input.lead_dashboard,
        jenis_iklan: args.scenario.input.jenis_iklan,
        multiplier: args.scenario.input.multiplier,
        closing_rate: args.scenario.input.closing_rate,
        rts_rate: args.scenario.input.rts_rate,
        ppn_rate: args.scenario.input.ppn_rate,
      }
      // If a preset with same (org, product, scenario_name) exists, update via id.
      const existing = presets.find(
        p =>
          p.product_id === args.scenario.input.product_id &&
          p.scenario_name === args.scenarioName
      )
      await savePreset(supabase, {
        id: existing?.id ?? null,
        organization_id: orgId,
        product_id: args.scenario.input.product_id,
        scenario_name: args.scenarioName,
        inputs,
        is_default: args.isDefault,
        notes: args.notes,
        created_by: profile?.id ?? null,
      })
      toast.success(`Preset "${args.scenarioName}" saved`)
      await loadData()
    } catch (err) {
      toast.error('Gagal save preset', {
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  async function handleDeletePreset(preset: MarginSimulatorPreset) {
    try {
      await deletePreset(supabase, preset.id)
      toast.success(`Preset "${preset.scenario_name}" dihapus`)
      await loadData()
    } catch (err) {
      toast.error('Gagal hapus preset', {
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  async function handleSetDefault(preset: MarginSimulatorPreset) {
    if (!orgId) return
    try {
      await setPresetDefault(supabase, {
        presetId: preset.id,
        organizationId: orgId,
        productId: preset.product_id,
      })
      toast.success(`"${preset.scenario_name}" sekarang default`)
      await loadData()
    } catch (err) {
      toast.error('Gagal set default', {
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const canWrite = useMemo(() => role === 'owner' || role === 'advertiser', [role])

  // Auth still resolving
  if (authLoading) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Loading…</div>
    )
  }

  // Role guard
  if (!allowed) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-500">
              <ShieldOff className="size-5" /> Akses ditolak
            </CardTitle>
            <CardDescription>
              Margin Simulator hanya untuk role <span className="font-mono">advertiser</span> atau{' '}
              <span className="font-mono">owner</span>.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader
        title="Margin Simulator"
        description="Calculator margin & ROI per produk — decide CPR maks sebelum jalan campaign."
        icon={Calculator}
        actions={
          <Button onClick={addScenario} disabled={scenarios.length >= MAX_SCENARIOS}>
            <Plus className="size-4 mr-2" />
            Tambah Scenario {scenarios.length >= MAX_SCENARIOS ? `(maks ${MAX_SCENARIOS})` : ''}
          </Button>
        }
      />

      <div className="flex gap-4 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0 md:flex-wrap md:overflow-visible">
        {scenarios.map(sc => (
          <ScenarioCard
            key={sc.uid}
            scenario={sc}
            products={products}
            onChange={next => updateScenario(sc.uid, next)}
            onRemove={() => removeScenario(sc.uid)}
            canRemove={scenarios.length > 1}
            onSavePreset={handleSavePreset}
            canWrite={canWrite}
          />
        ))}
      </div>

      {loading ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Loading presets...
          </CardContent>
        </Card>
      ) : (
        <SavedPresetsTable
          presets={presets}
          products={products}
          onLoad={loadPresetIntoNewScenario}
          onDelete={handleDeletePreset}
          onSetDefault={handleSetDefault}
          canWrite={canWrite}
        />
      )}
    </div>
  )
}
