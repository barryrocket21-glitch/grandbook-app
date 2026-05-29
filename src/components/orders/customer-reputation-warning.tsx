'use client'
// =============================================================
// Brief #1 — Warning reputasi pelanggan saat input order (INTI modul).
// Debounce HP → get_customer_reputation. WATCH=amber, HIGH_RISK=merah,
// blacklisted=soft-block (override checkbox; gate submit via onBlockChange).
// =============================================================
import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getCustomerReputation } from '@/lib/supabase/queries/customers'
import type { CustomerReputation } from '@/lib/types'
import { AlertTriangle, Ban, ShieldCheck } from 'lucide-react'

const supabase = createClient()

interface Props {
  phone: string
  /** Dipanggil saat status block berubah (true = submit harus di-block). */
  onBlockChange?: (blocked: boolean) => void
}

export function CustomerReputationWarning({ phone, onBlockChange }: Props) {
  const [rep, setRep] = useState<CustomerReputation | null>(null)
  const [override, setOverride] = useState(false)
  const lastPhone = useRef<string>('')

  // Debounce 500ms; skip kalau < 8 digit.
  useEffect(() => {
    const digits = (phone || '').replace(/\D/g, '')
    if (digits.length < 8) {
      setRep(null)
      setOverride(false)
      return
    }
    const t = setTimeout(async () => {
      try {
        const r = await getCustomerReputation(supabase, phone)
        setRep(r)
        if (r.phone_normalized !== lastPhone.current) {
          setOverride(false)
          lastPhone.current = r.phone_normalized || ''
        }
      } catch {
        setRep(null)
      }
    }, 500)
    return () => clearTimeout(t)
  }, [phone])

  // Lapor status block ke parent.
  const isBlocked = !!rep?.is_blacklisted && rep.blacklist_mode === 'block' && !override
  useEffect(() => {
    onBlockChange?.(isBlocked)
  }, [isBlocked, onBlockChange])

  if (!rep || !rep.found) return null

  const stat = `${rep.total_orders} order · ${rep.delivered_count} diterima · ${rep.returned_count} retur${rep.fake_count > 0 ? ` · ${rep.fake_count} fake` : ''}`

  // Blacklisted → block / warn
  if (rep.is_blacklisted) {
    return (
      <div className="rounded-md border border-red-500/40 bg-red-500/10 p-2.5 text-xs space-y-1.5">
        <p className="flex items-start gap-1.5 font-semibold text-red-700 dark:text-red-400">
          <Ban className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            Nomor ini DIBLACKLIST{rep.blacklist_reason ? ` — ${rep.blacklist_reason}` : ''}.
            <span className="block font-normal opacity-90">{stat}</span>
          </span>
        </p>
        {rep.blacklist_mode === 'block' && (
          <label className="flex items-center gap-1.5 text-red-700 dark:text-red-400 cursor-pointer">
            <input
              type="checkbox"
              checked={override}
              onChange={(e) => setOverride(e.target.checked)}
              className="rounded border-red-400"
            />
            <span>Tetap lanjutkan order ini (override blacklist)</span>
          </label>
        )}
      </div>
    )
  }

  if (rep.risk_tier === 'HIGH_RISK') {
    return (
      <div className="rounded-md border border-red-500/40 bg-red-500/10 p-2.5 text-xs flex items-start gap-1.5 text-red-700 dark:text-red-400">
        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>
          <span className="font-semibold">⚠️ Risiko tinggi:</span> {stat}.
          Saran: minta DP / transfer dulu sebelum kirim.
        </span>
      </div>
    )
  }

  if (rep.risk_tier === 'WATCH') {
    return (
      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>
          <span className="font-semibold">Perhatian:</span> {stat}.
          Pertimbangkan minta DP.
        </span>
      </div>
    )
  }

  if (rep.is_vip) {
    return (
      <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-2.5 text-xs flex items-start gap-1.5 text-emerald-700 dark:text-emerald-400">
        <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span><span className="font-semibold">Pelanggan VIP</span> · {stat}</span>
      </div>
    )
  }

  // GOOD / NEW with history → subtle info
  return (
    <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
      <ShieldCheck className="w-3 h-3 shrink-0 text-emerald-600" />
      {rep.risk_tier === 'GOOD' ? 'Pelanggan bagus' : 'Pelanggan'}: {stat}
    </p>
  )
}
