'use client'
import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const supabase = createClient()

export interface SidebarCounts {
  drafts_total: number
  drafts_baru: number
  drafts_problem: number
  supplier_payable_pending: number
  inbox_pending_review: number
  inbox_unmatched_resi: number
  inbox_unmapped_statuses: number
  inbox_address_review: number
  inbox_phone_review: number
  commissions_earned: number
  attribution_required: number
  crm_my_cases: number
  crm_overdue: number
}

const EMPTY_COUNTS: SidebarCounts = {
  drafts_total: 0,
  drafts_baru: 0,
  drafts_problem: 0,
  supplier_payable_pending: 0,
  inbox_pending_review: 0,
  inbox_unmatched_resi: 0,
  inbox_unmapped_statuses: 0,
  inbox_address_review: 0,
  inbox_phone_review: 0,
  commissions_earned: 0,
  attribution_required: 0,
  crm_my_cases: 0,
  crm_overdue: 0,
}

const POLL_INTERVAL_MS = 60_000

/**
 * Phase 8L — Sidebar count badges fetcher.
 * - Fetch on mount + every 60s saat tab visible
 * - Pause polling saat tab hidden
 * - Immediate refresh saat tab returns visible
 * - Silent fail (RPC error → return last known counts)
 */
export function useSidebarCounts(userId: string | null): SidebarCounts {
  const [counts, setCounts] = useState<SidebarCounts>(EMPTY_COUNTS)

  const fetchCounts = useCallback(async () => {
    if (!userId) return
    try {
      const { data, error } = await supabase.rpc('get_sidebar_counts')
      if (error) {
        console.warn('get_sidebar_counts:', error.message)
        return
      }
      if (data && data[0]) {
        const row = data[0] as Record<string, number | string>
        setCounts({
          drafts_total: Number(row.drafts_total) || 0,
          drafts_baru: Number(row.drafts_baru) || 0,
          drafts_problem: Number(row.drafts_problem) || 0,
          supplier_payable_pending: Number(row.supplier_payable_pending) || 0,
          inbox_pending_review: Number(row.inbox_pending_review) || 0,
          inbox_unmatched_resi: Number(row.inbox_unmatched_resi) || 0,
          inbox_unmapped_statuses: Number(row.inbox_unmapped_statuses) || 0,
          inbox_address_review: Number(row.inbox_address_review) || 0,
          inbox_phone_review: Number(row.inbox_phone_review) || 0,
          commissions_earned: Number(row.commissions_earned) || 0,
          attribution_required: Number(row.attribution_required) || 0,
          crm_my_cases: Number(row.crm_my_cases) || 0,
          crm_overdue: Number(row.crm_overdue) || 0,
        })
      }
    } catch (err) {
      console.warn('sidebar counts fetch error:', err)
    }
  }, [userId])

  useEffect(() => {
    if (!userId) return
    fetchCounts()
    let intervalId: ReturnType<typeof setInterval> | null = null
    const startPolling = () => {
      if (intervalId) return
      intervalId = setInterval(() => {
        if (document.visibilityState === 'visible') fetchCounts()
      }, POLL_INTERVAL_MS)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') fetchCounts()
    }
    startPolling()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      if (intervalId) clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [userId, fetchCounts])

  return counts
}

/**
 * Map nav child href → counts key. Render badge value berdasarkan map.
 */
export function getCountForHref(href: string, counts: SidebarCounts): number {
  switch (href) {
    case '/orders/draft':            return counts.drafts_total
    case '/financial-position':      return counts.supplier_payable_pending
    case '/inbox/pending-review':    return counts.inbox_pending_review
    case '/inbox/unmatched-resi':    return counts.inbox_unmatched_resi
    case '/inbox/unmapped-statuses': return counts.inbox_unmapped_statuses
    case '/inbox/address-review':    return counts.inbox_address_review
    case '/inbox/phone-review':      return counts.inbox_phone_review
    case '/commissions/manage':      return counts.commissions_earned
    case '/inbox/atribusi-required':  return counts.attribution_required
    case '/crm':                      return counts.crm_my_cases
    default: return 0
  }
}
