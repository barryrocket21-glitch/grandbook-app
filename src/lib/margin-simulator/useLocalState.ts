'use client'
// =============================================================
// Phase 7 v2 — localStorage hook per user
// =============================================================
// Storage key = `gb_margin_simulator_v1:${userId}` supaya state per-user
// tidak clobber kalau owner + ADV pakai browser yang sama.
//
// Hydration guard: first paint = DEFAULT_STATE, post-effect load dari
// localStorage. Save effect skip sebelum hydrated supaya tidak nge-overwrite
// stored state dengan DEFAULT_STATE.
// =============================================================
import { useEffect, useState } from 'react'
import { DEFAULT_STATE, type SimulatorState } from '@/lib/types'

const STORAGE_PREFIX = 'gb_margin_simulator_v1'

function isValidState(value: unknown): value is SimulatorState {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (!(v.periode_days === 1 || v.periode_days === 7 || v.periode_days === 30)) return false
  if (!Array.isArray(v.scenarios) || v.scenarios.length === 0) return false
  return true
}

export function useLocalState(userId: string | null) {
  const key = userId ? `${STORAGE_PREFIX}:${userId}` : null
  const [state, setState] = useState<SimulatorState>(DEFAULT_STATE)
  const [hydrated, setHydrated] = useState(false)

  // Load on mount / userId change
  useEffect(() => {
    if (!key) return
    setHydrated(false)
    try {
      const raw = localStorage.getItem(key)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (isValidState(parsed)) {
          setState(parsed)
        } else {
          setState(DEFAULT_STATE)
        }
      } else {
        setState(DEFAULT_STATE)
      }
    } catch {
      setState(DEFAULT_STATE)
    }
    setHydrated(true)
  }, [key])

  // Persist on change (post-hydrate only — skip first paint)
  useEffect(() => {
    if (!hydrated || !key) return
    try {
      localStorage.setItem(key, JSON.stringify(state))
    } catch {
      // localStorage full / disabled — silently ignore (calc still works in memory)
    }
  }, [state, key, hydrated])

  function reset() {
    setState(DEFAULT_STATE)
    if (key) {
      try { localStorage.removeItem(key) } catch {}
    }
  }

  return { state, setState, reset, hydrated }
}
