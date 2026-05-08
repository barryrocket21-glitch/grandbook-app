// TODO Phase 3: refactor untuk track selisih ongkir per channel
// (bukan per ekspedisi raw). Data diambil dari rekonsil engine
// yang populate shipping_cost_actual via converter INBOUND_REKONSIL.
import { RefactorBanner } from '@/components/ui/refactor-banner'
export default function ShippingDiffPage() {
  return <RefactorBanner phase="Phase 3 (Rekonsil Engine)" pageTitle="Selisih Ongkir" />
}
