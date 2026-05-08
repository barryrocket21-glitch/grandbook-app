// TODO Phase 3: refactor CS daily report.
// Tabel cs_daily_leads tetap utuh, tapi closing_count auto-derive dari
// orders.cs_id pakai schema baru (no more duplicate_of, status enum baru).
import { RefactorBanner } from '@/components/ui/refactor-banner'
export default function CsReportPage() {
  return <RefactorBanner phase="Phase 3 (Status Sync Engine)" pageTitle="Laporan Harian CS" />
}
