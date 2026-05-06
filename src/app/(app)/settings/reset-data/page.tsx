'use client'

import { useState } from 'react'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { Trash2, AlertTriangle, Loader2, RotateCcw } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'

interface TableInfo {
  key: string
  title: string
  description: string
  cascades?: string[]
}

const TABLES: TableInfo[] = [
  { key: 'orders', title: 'Orders', description: 'Semua order. Akan cascade ke: order_items, commissions, cs_daily_leads (closing count snapshot).', cascades: ['order_items', 'commissions'] },
  { key: 'cs_daily_leads', title: 'Laporan Harian CS', description: 'Lead/closing/reject report harian per produk. Tidak terkait dengan orders, jadi safe dihapus terpisah.' },
  { key: 'ad_spend', title: 'Ad Spend', description: 'Pengeluaran iklan per campaign per hari (yang advertiser input).' },
  { key: 'expenses', title: 'Biaya Operasional', description: 'Biaya operasional bulanan.' },
  { key: 'ad_reconciliation', title: 'Reconciliation', description: 'Rekon tagihan bulanan Meta/TT/Google.' },
  { key: 'campaigns', title: 'Campaigns', description: 'Daftar campaign. Hapus ini akan break ad_spend yang reference (fail).', cascades: [] },
  { key: 'commission_rules', title: 'Commission Rules', description: 'Aturan komisi per role/produk.' },
  { key: 'products', title: 'Master Produk', description: 'Daftar produk. Akan cascade ke order_items, cs_daily_leads. commission_rules akan SET NULL.', cascades: ['order_items', 'cs_daily_leads'] },
]

export default function ResetDataPage() {
  const { role, loading: authLoading } = useAuth()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState('')
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<Record<string, any> | null>(null)

  const toggle = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleReset = async () => {
    if (selected.size === 0) return toast.error('Pilih minimal 1 tabel')
    if (confirm !== 'HAPUS SEMUA') return toast.error('Ketik "HAPUS SEMUA" persis di kolom konfirmasi')
    if (!window.confirm(`KONFIRMASI AKHIR: hapus permanen ${selected.size} tabel?\n\nIni TIDAK BISA di-undo.`)) return

    setRunning(true)
    setResults(null)
    try {
      const res = await fetch('/api/admin/reset-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tables: Array.from(selected), confirm: 'HAPUS SEMUA' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Gagal')
      setResults(json.results)
      toast.success('Reset selesai')
      setSelected(new Set())
      setConfirm('')
    } catch (err: any) {
      toast.error('Gagal reset', { description: err.message })
    } finally {
      setRunning(false)
    }
  }

  if (authLoading) return <div className="text-sm text-muted-foreground">Memeriksa akses...</div>
  if (role !== 'owner') {
    return (
      <Card className="max-w-md mx-auto mt-8">
        <CardContent className="pt-6 text-center space-y-2">
          <AlertTriangle className="w-10 h-10 text-yellow-500 mx-auto" />
          <h2 className="text-lg font-semibold">Akses Dibatasi</h2>
          <p className="text-sm text-muted-foreground">Halaman reset data hanya untuk Owner.</p>
        </CardContent>
      </Card>
    )
  }

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
            <p className="font-semibold text-red-500">⚠️ DESTRUCTIVE ACTION — tidak bisa di-undo</p>
            <p className="text-muted-foreground">Tabel yang kamu centang akan <strong>dihapus permanen</strong>. Pastikan kamu sudah backup atau memang siap mulai fresh. <strong>User accounts (profiles) tidak ikut terhapus</strong> — yang dihapus cuma data transaksional.</p>
          </div>
        </CardContent>
      </Card>

      {/* Table picker */}
      <Card>
        <CardContent className="pt-4 pb-4 space-y-3">
          <p className="text-sm font-semibold">Pilih tabel yang mau dihapus:</p>
          <div className="space-y-2">
            {TABLES.map(t => (
              <div key={t.key} className="flex items-start gap-3 p-3 rounded-lg border bg-muted/20 hover:bg-muted/40 transition-colors cursor-pointer" onClick={() => toggle(t.key)}>
                <Checkbox checked={selected.has(t.key)} onCheckedChange={() => toggle(t.key)} className="mt-0.5" />
                <div className="flex-1 min-w-0">
                  <Label className="font-medium cursor-pointer">{t.title}</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">{t.description}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Confirm + button */}
      <Card>
        <CardContent className="pt-4 pb-4 space-y-3">
          <div className="space-y-2">
            <Label className="text-sm">Ketik <code className="px-1 py-0.5 rounded bg-zinc-800 text-red-400 font-mono text-xs">HAPUS SEMUA</code> untuk konfirmasi:</Label>
            <Input value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="HAPUS SEMUA" className="font-mono" />
          </div>
          <Button
            onClick={handleReset}
            disabled={running || selected.size === 0 || confirm !== 'HAPUS SEMUA'}
            className="bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-500/20 w-full sm:w-auto"
          >
            {running ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
            Hapus {selected.size} Tabel Terpilih
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
