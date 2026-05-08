// TODO Phase 3: refactor ad-spend dengan join ke schema orders baru.
// CPA real harus computed dari orders.cs_id + status DITERIMA (bukan
// SELESAI lama). Settings UI di Phase 2 akan handle CRUD ad_spend yang
// terhubung ke channel/campaign baru.
import { RefactorBanner } from '@/components/ui/refactor-banner'
export default function AdSpendPage() {
  return <RefactorBanner phase="Phase 2/3 (Settings + Analytics Engine)" pageTitle="Ad Spend" />
}
