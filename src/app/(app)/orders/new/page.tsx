// TODO Phase 4: refactor form input untuk schema orders baru.
// Akan support: alamat struktural (province/city/subdistrict/village/zip)
// dengan dropdown autocomplete dari master_wilayah, channel_id picker,
// auto-snapshot rate dari courier_channel_rates.
import { RefactorBanner } from '@/components/ui/refactor-banner'
export default function NewOrderPage() {
  return <RefactorBanner phase="Phase 4 (Form Input Order)" pageTitle="Input Order Baru" />
}
