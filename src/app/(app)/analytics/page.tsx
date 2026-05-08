// TODO Phase 3+: refactor analytics matrix untuk schema baru.
// Engine harus pakai status enum baru, channel_id (bukan ekspedisi raw),
// dan rate_snapshot per order untuk hitungan margin yang akurat.
import { RefactorBanner } from '@/components/ui/refactor-banner'
export default function AnalyticsPage() {
  return <RefactorBanner phase="Phase 3 (Converter Engine + Status Sync)" pageTitle="Analytics — Profit Dashboard, Matrix Produk × CS" />
}
