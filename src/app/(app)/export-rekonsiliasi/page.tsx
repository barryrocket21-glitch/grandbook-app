'use client'
// =============================================================
// Export Rekonsiliasi — 1 tombol dump transaksi (order-grain) ke CSV/XLSX buat
// double-check di spreadsheet. Tiap baris ada Kode Atribusi ("Pavio F.A.1"),
// CS, campaign, channel + angka duit GrandBook + kolom eksternal KOSONG yang
// diisi manual dari bank/SPX/Meta. Sumber: RPC export_reconciliation_rows (135).
// =============================================================
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { DateRangePicker, thisMonth, type DateRange } from '@/components/ui/date-range-picker'
import { Download, Loader2, FileSpreadsheet, Info } from 'lucide-react'
import { ORDER_STATUSES } from '@/lib/constants'
import { serializeCsv, serializeXlsx, downloadBlob } from '@/lib/converter/serializer'
import { fetchReconExportRows, buildReconExportTable } from '@/lib/supabase/queries/reconciliation-export'
import { toast } from 'sonner'

const supabase = createClient()

export default function ExportRekonsiliasiPage() {
  const { role, loading: authLoading } = useAuth()
  const canView = role === 'owner' || role === 'admin' || role === 'akunting'

  const [range, setRange] = useState<DateRange>(thisMonth)
  const [rangeReady, setRangeReady] = useState(false)
  const [statuses, setStatuses] = useState<string[]>([])
  const [format, setFormat] = useState<'xlsx' | 'csv'>('xlsx')
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    setRange(thisMonth())
    setRangeReady(true)
  }, [])

  const toggleStatus = (v: string) =>
    setStatuses((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]))

  const handleExport = useCallback(async () => {
    if (!rangeReady) return
    setExporting(true)
    try {
      const rows = await fetchReconExportRows(supabase, {
        from: range.from,
        to: range.to,
        statuses,
      })
      if (!rows.length) {
        toast.info('Gak ada order di rentang & status itu.')
        return
      }
      const { headers, data } = buildReconExportTable(rows)
      const blob =
        format === 'xlsx'
          ? serializeXlsx(data, headers, 'Rekonsiliasi')
          : serializeCsv(data, headers, ',', 'utf-8-sig')
      downloadBlob(blob, `rekonsiliasi_${range.from}_sd_${range.to}.${format}`)
      toast.success(`${rows.length} order di-export ke ${format.toUpperCase()}.`)
    } catch (err) {
      console.warn('export_reconciliation_rows failed:', err)
      toast.error('Gagal export. Coba lagi.')
    } finally {
      setExporting(false)
    }
  }, [rangeReady, range.from, range.to, statuses, format])

  if (authLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Memeriksa akses…</div>
  }
  if (!canView) {
    return (
      <Card className="max-w-md mx-auto mt-8">
        <CardContent className="p-6 text-sm text-muted-foreground">
          Akses dibatasi. Halaman ini untuk owner, admin, atau akunting.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Export Rekonsiliasi"
        description="Dump transaksi per-order (ada Kode Atribusi, CS, campaign + angka duit) buat dicocokin di spreadsheet."
        icon={Download}
        badge="BARU"
      />

      <Card>
        <CardContent className="p-5 space-y-5">
          {/* Rentang tanggal */}
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Rentang Tanggal Order</p>
            <DateRangePicker value={range} onChange={setRange} />
          </div>

          {/* Filter status (opsional) */}
          <div className="space-y-1.5">
            <p className="text-sm font-medium">
              Status <span className="text-muted-foreground font-normal">(kosongin = semua)</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {ORDER_STATUSES.map((s) => {
                const active = statuses.includes(s.value)
                return (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => toggleStatus(s.value)}
                    className={
                      'rounded-md px-2.5 py-1 text-xs font-medium border transition-colors ' +
                      (active
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background text-muted-foreground border-border hover:bg-muted')
                    }
                  >
                    {s.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Format */}
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Format</p>
            <div className="flex gap-2">
              <Button
                variant={format === 'xlsx' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFormat('xlsx')}
              >
                <FileSpreadsheet className="size-4" /> Excel (.xlsx)
              </Button>
              <Button
                variant={format === 'csv' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFormat('csv')}
              >
                CSV
              </Button>
            </div>
          </div>

          <Button onClick={handleExport} disabled={exporting} className="w-full sm:w-auto">
            {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            {exporting ? 'Menyiapkan…' : 'Export Sekarang'}
          </Button>

          <div className="flex gap-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            <Info className="size-4 shrink-0 mt-0.5" />
            <p>
              3 kolom terakhir (<b>Payout Aktual</b>, <b>Selisih vs GrandBook</b>, <b>Status Cek</b>)
              sengaja dikosongin — isi manual dari mutasi bank / SPX Seller Center, terus pakai
              rumus selisih di spreadsheet buat nandain yang gak cocok. Sumber data: order final
              (arsip) di rentang yang dipilih.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
