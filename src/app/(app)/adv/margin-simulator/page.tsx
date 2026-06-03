'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getErrorMessage } from '@/lib/errors'
import { Calculator, Plus, RotateCcw, ShieldOff } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { canAccessMarginSimulator } from '@/lib/auth/permissions'
import { fetchProductsForSimulator } from '@/lib/supabase/queries/margin-simulator'
import { useLocalState } from '@/lib/margin-simulator/useLocalState'
import {
  DEFAULT_SCENARIO,
  PERIODE_OPTIONS,
  type PeriodeDays,
  type ProductForSimulator,
  type SimulatorScenario,
} from '@/lib/types'
import { ScenarioCard } from '@/components/margin-simulator/scenario-card'
import { cn } from '@/lib/utils'

const MAX_SCENARIOS = 3
const supabase = createClient()

export default function MarginSimulatorPage() {
  const { user, profile, role, loading: authLoading } = useAuth()
  const allowed = canAccessMarginSimulator(role)
  const orgId = profile?.organization_id ?? null
  const userId = user?.id ?? null

  const { state, setState, reset, hydrated } = useLocalState(userId)
  const [products, setProducts] = useState<ProductForSimulator[]>([])
  const [productsLoading, setProductsLoading] = useState(true)
  const [resetOpen, setResetOpen] = useState(false)
  const productsLoadedRef = useRef(false)

  const loadProducts = useCallback(async () => {
    if (!orgId) return
    setProductsLoading(true)
    try {
      const data = await fetchProductsForSimulator(supabase, orgId)
      setProducts(data)
    } catch (err) {
      toast.error('Gagal load produk', {
        description: getErrorMessage(err),
      })
    } finally {
      setProductsLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    if (!allowed || !orgId || productsLoadedRef.current) return
    productsLoadedRef.current = true
    loadProducts()
  }, [allowed, orgId, loadProducts])

  function setPeriode(days: PeriodeDays) {
    setState(s => ({ ...s, periode_days: days }))
  }

  function addScenario() {
    setState(s => {
      if (s.scenarios.length >= MAX_SCENARIOS) return s
      const letter = String.fromCharCode('A'.charCodeAt(0) + s.scenarios.length)
      return {
        ...s,
        scenarios: [...s.scenarios, { ...DEFAULT_SCENARIO, name: `Scenario ${letter}` }],
      }
    })
  }

  function updateScenario(idx: number, next: SimulatorScenario) {
    setState(s => ({
      ...s,
      scenarios: s.scenarios.map((sc, i) => (i === idx ? next : sc)),
    }))
  }

  function removeScenario(idx: number) {
    setState(s =>
      s.scenarios.length <= 1
        ? s
        : { ...s, scenarios: s.scenarios.filter((_, i) => i !== idx) }
    )
  }

  function handleReset() {
    reset()
    setResetOpen(false)
    toast.success('Simulator di-reset ke default')
  }

  // Auth still resolving — show loader
  if (authLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>
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

  // Wait for both products + localStorage to settle for stable first paint
  const isFullyLoaded = hydrated && !productsLoading

  return (
    <div className="p-4 md:p-6 space-y-5">
      <PageHeader
        title="Margin Simulator"
        description="Calculator margin & ROI per produk — decide CPR maks sebelum jalan campaign."
        icon={Calculator}
      />

      {/* Toolbar: periode toggle + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
            Periode
          </span>
          <div className="inline-flex rounded-md border border-border p-0.5 bg-muted/30">
            {PERIODE_OPTIONS.map(opt => {
              const active = state.periode_days === opt.days
              return (
                <button
                  key={opt.days}
                  type="button"
                  onClick={() => setPeriode(opt.days)}
                  className={cn(
                    'px-3 py-1 text-xs rounded transition-colors',
                    active
                      ? 'bg-background shadow-sm font-semibold text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  aria-pressed={active}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setResetOpen(true)}>
            <RotateCcw className="size-4 mr-2" />
            Reset
          </Button>
          <Button
            size="sm"
            onClick={addScenario}
            disabled={state.scenarios.length >= MAX_SCENARIOS}
          >
            <Plus className="size-4 mr-2" />
            Tambah scenario {state.scenarios.length >= MAX_SCENARIOS ? `(maks ${MAX_SCENARIOS})` : ''}
          </Button>
        </div>
      </div>

      {/* Scenario cards */}
      {!isFullyLoaded ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">Loading…</CardContent>
        </Card>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0 md:flex-wrap md:overflow-visible">
          {state.scenarios.map((sc, idx) => (
            <ScenarioCard
              key={idx}
              scenario={sc}
              periode={state.periode_days}
              products={products}
              onChange={next => updateScenario(idx, next)}
              onRemove={() => removeScenario(idx)}
              canRemove={state.scenarios.length > 1}
            />
          ))}
          {state.scenarios.length < MAX_SCENARIOS && (
            <button
              type="button"
              onClick={addScenario}
              className="w-full md:w-[360px] shrink-0 min-h-[200px] rounded-xl border-2 border-dashed border-border hover:border-foreground/40 transition-colors flex flex-col items-center justify-center gap-2 text-muted-foreground hover:text-foreground"
            >
              <Plus className="size-6" />
              <span className="text-sm">Tambah scenario</span>
            </button>
          )}
        </div>
      )}

      {/* Reset confirm */}
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reset simulator?</DialogTitle>
            <DialogDescription>
              Semua scenario dan periode toggle akan dikembalikan ke default. Data simulasi
              sekarang (tersimpan di browser ini) akan hilang.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)}>
              Batal
            </Button>
            <Button variant="destructive" onClick={handleReset}>
              Reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
