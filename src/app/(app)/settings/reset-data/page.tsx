'use client'

import { useEffect, useState } from 'react'
import { getErrorMessage } from '@/lib/errors'
import { useAuth } from '@/components/providers/auth-provider'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Trash2, AlertTriangle, Loader2, RotateCcw } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'

const supabase = createClient()

interface TableInfo {
  key: string
  title: string
  description: string
  cascades?: string[]
}

const TABLES: TableInfo[] = [
  { key: 'orders', title: 'Orders', description: 'Semua order. Akan cascade ke: order_items, commissions.', cascades: ['order_items', 'commissions'] },
  { key: 'daily_cs_report', title: 'Laporan Harian CS', description: 'Lead/closing/reject report harian per produk (daily_cs_report, Phase 6 aktif).' },
  { key: 'ad_spend', title: 'Ad Spend', description: 'Pengeluaran iklan per campaign per hari (yang advertiser input).' },
  { key: 'operational_expenses', title: 'Biaya Operasional', description: 'Biaya operasional bulanan (operational_expenses, Phase 5A aktif).' },
  { key: 'ad_reconciliation', title: 'Reconciliation', description: 'Rekon tagihan bulanan Meta/TT/Google.' },
  { key: 'customers', title: 'Pelanggan (Reputasi)', description: 'Reputasi pelanggan per nomor HP (blacklist/VIP/counters). OTOMATIS ikut terhapus saat reset Orders — datanya di-derive dari orders, biar gak jadi ghost data.' },
  // CATATAN: Master/config (produk, campaign, commission rules, supplier, courier,
  // converter, wilayah) SENGAJA gak ada di sini — gak boleh di-wipe via reset.
  // Kelola via Settings masing-masing. Mencegah ke-hapus gak sengaja.
]

const CONFIRM_TOKEN = 'RESET'

export default function ResetDataPage() {
  const { role, loading: authLoading } = useAuth()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState('')
  const [understood, setUnderstood] = useState(false)
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<Record<string, number | string> | null>(null)

  // Phase 8I-Followup Fix 4.1 — pre-fetch row counts untuk preview impact sebelum
  // user check tabel. Bisa pakai PostgREST head:true + count:exact (1 query per table).
  const [counts, setCounts] = useState<Record<string, number | null>>({})
  const [countsLoading, setCountsLoading] = useState(true)

  useEffect(() => {
    if (role !== 'owner') return
    let cancelled = false
    ;(async () => {
      setCountsLoading(true)
      const entries = await Promise.all(
        TABLES.map(async (t) => {
          const { count } = await supabase.from(t.key).select('*', { head: true, count: 'exact' })
          return [t.key, count ?? null] as const
        })
      )
      if (cancelled) return
      setCounts(Object.fromEntries(entries))
      setCountsLoading(false)
    })()
    return () => { cancelled = true }
  }, [role])

  const toggle = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const totalRowsToDelete = Array.from(selected).reduce((sum, k) => sum + (counts[k] ?? 0), 0)

  const handleReset = async () => {
    if (selected.size === 0) return toast.error('Pilih minimal 1 tabel')
    if (confirm !== CONFIRM_TOKEN) return toast.error(`Ketik "${CONFIRM_TOKEN}" persis di kolom konfirmasi`)
    if (!understood) return toast.error('Centang konfirmasi "Saya paham"')

    // Final guardrail — native confirm dengan total count
    const summary = Array.from(selected)
      .map(k => {
        const t = TABLES.find(x => x.key === k)
        return `  • ${t?.title ?? k} (${(counts[k] ?? 0).toLocaleString('id-ID')} baris)`
      })
      .join('\n')
    const confirmMsg = `KONFIRMASI AKHIR — TIDAK BISA DI-UNDO\n\nAkan menghapus ${totalRowsToDelete.toLocaleString('id-ID')} baris dari ${selected.size} tabel:\n${summary}\n\nLanjutkan?`
    if (!window.confirm(confirmMsg)) return

    setRunning(true)
    setResults(null)
    try {
      const res = await fetch('/api/admin/reset-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tables: Array.from(selected), confirm: CONFIRM_TOKEN }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Gagal')
      setResults(json.results)
      toast.success('Reset selesai — log tersimpan di audit_log')
      setSelected(new Set())
      setConfirm('')
      setUnderstood(false)
      // Re-fetch counts
      const entries = await Promise.all(
        TABLES.map(async (t) => {
          const { count } = await supabase.from(t.key).select('*', { head: true, count: 'exact' })
          return [t.key, count ?? null] as const
        })
      )
      setCounts(Object.fromEntries(entries))
    } catch (err) {
      const msg = getErrorMessage(err)
      toast.error('Gagal reset', { description: msg })
    } finally {
      setRunning(false)
    }
  }

  if (authLoading) return <div className="text-sm text-muted-foreground">Memeriksa akses...</div>
  if (role !== 'owner') {
    return (
      <Card className="max-w-md mx-auto mt-8">
        <CardContent className="pt-6 text-center space-y-2">
          <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto" />
          <h2 className="text-lg font-semibold">Akses Dibatasi</h2>
          <p className="text-sm text-muted-foreground">Halaman reset data hanya untuk Owner.</p>
        </CardContent>
      </Card>
    )
  }

  const canSubmit = selected.size > 0 && confirm === CONFIRM_TOKEN && understood && !running

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <PageHeader
        icon={RotateCcw}
        title="Reset Data"
        description="Hapus dummy data atau bersihkan tabel tertentu untuk start fresh"
      />

      {/* Big warning */}
      <Card className="border-red-500/40 bg-red-500/5">
        <CardContent className="pt-4 pb-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
          <div className="text-sm space-y-1">
            <p className="font-semibold text-red-500">DESTRUCTIVE ACTION — TIDAK BISA DI-UNDO</p>
            <p className="text-muted-foreground">
              Tabel yang kamu centang akan <strong>dihapus permanen</strong> (HARD DELETE).
              Pastikan kamu sudah backup atau memang siap mulai fresh.{' '}
              <strong>User accounts (profiles) tidak ikut terhapus</strong> — yang dihapus
              cuma data transaksional.
            </p>
            <p className="text-muted-foreground text-xs mt-1">
              Phase 8I-Followup Fix 4: setiap reset sekarang ke-log ke <code>audit_log</code> table
              (siapa, kapan, total baris). Trigger DB juga capture per-row DELETE untuk recovery.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Table picker — show row count per table */}
      <Card>
        <CardContent className="pt-4 pb-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Pilih tabel yang mau dihapus:</p>
            {countsLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
          </div>
          <div className="space-y-2">
            {TABLES.map(t => {
              const cnt = counts[t.key]
              const isEmpty = cnt === 0
              return (
                <div
                  key={t.key}
                  className={`flex items-start gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
                    selected.has(t.key) ? 'bg-red-500/10 border-red-500/40' : 'bg-muted/20 hover:bg-muted/40'
                  } ${isEmpty ? 'opacity-60' : ''}`}
                  onClick={() => toggle(t.key)}
                >
                  <Checkbox checked={selected.has(t.key)} onCheckedChange={() => toggle(t.key)} className="mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Label className="font-medium cursor-pointer">{t.title}</Label>
                      {/* cnt bisa undefined selama counts belum ke-load (race) —
                          pakai != null (loose) supaya undefined ikut ke-skip, gak
                          crash di undefined.toLocaleString(). */}
                      {cnt != null && (
                        <Badge variant="outline" className={`text-[10px] tabular-nums ${cnt > 0 ? 'border-red-500/30 text-red-600' : ''}`}>
                          {cnt.toLocaleString('id-ID')} baris
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{t.description}</p>
                  </div>
                </div>
              )
            })}
          </div>
          {selected.size > 0 && (
            <div className="mt-2 p-3 rounded-md bg-red-500/10 border border-red-500/30 text-sm">
              <strong className="text-red-600">Total akan dihapus:</strong>{' '}
              <span className="tabular-nums font-bold">{totalRowsToDelete.toLocaleString('id-ID')}</span> baris
              dari <span className="font-bold">{selected.size}</span> tabel
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirm + button */}
      <Card>
        <CardContent className="pt-4 pb-4 space-y-3">
          <div className="space-y-2">
            <Label className="text-sm">
              Ketik <code className="px-1 py-0.5 rounded bg-zinc-800 text-red-400 font-mono text-xs">{CONFIRM_TOKEN}</code> untuk konfirmasi:
            </Label>
            <Input
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder={CONFIRM_TOKEN}
              className="font-mono"
              autoComplete="off"
            />
          </div>

          <div className="flex items-start gap-2 pt-1">
            <Checkbox
              id="understood-cb"
              checked={understood}
              onCheckedChange={(v) => setUnderstood(!!v)}
              className="mt-0.5"
            />
            <Label htmlFor="understood-cb" className="text-sm cursor-pointer leading-snug">
              Saya paham tindakan ini <strong>permanen</strong> dan <strong>tidak bisa di-undo</strong>.
              Data yang dihapus tidak bisa di-restore tanpa backup eksternal.
            </Label>
          </div>

          <Button
            onClick={handleReset}
            disabled={!canSubmit}
            className="bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-500/20 w-full sm:w-auto"
          >
            {running ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
            Hapus {selected.size} Tabel ({totalRowsToDelete.toLocaleString('id-ID')} baris)
          </Button>
        </CardContent>
      </Card>

      {/* Results */}
      {results && (
        <Card>
          <CardContent className="pt-4 pb-4 space-y-2">
            <p className="text-sm font-semibold">Hasil:</p>
            <div className="space-y-1 text-sm font-mono">
              {Object.entries(results).map(([table, result]) => (
                <div key={table} className="flex justify-between p-2 rounded bg-muted/30">
                  <span>{table}</span>
                  <span className={typeof result === 'string' && result.includes('error') ? 'text-red-500' : 'text-emerald-500'}>{String(result)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
