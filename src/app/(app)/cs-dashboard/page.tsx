// TODO Phase 3+: refactor CS personal dashboard.
// Pipeline aging tetap dari cs_daily_leads (tabel intact). Komisi engine
// di-rebuild di Phase 3 dengan trigger yang merespect status enum baru
// (SIAP_KIRIM/DIKIRIM/DITERIMA/PROBLEM/RETUR).
import { RefactorBanner } from '@/components/ui/refactor-banner'
export default function CsDashboardPage() {
  return <RefactorBanner phase="Phase 3 (Commission Engine v2)" pageTitle="Dashboard CS" />
}
