// TODO Phase 3: refactor untuk schema orders baru (Phase 1).
// Field 'ekspedisi' & 'resi_status' lama digantikan oleh channel_id +
// resi mapping di courier_channel_statuses. Status enum berubah:
// DIPROSES/SAMPAI/SELESAI → SIAP_KIRIM/DIKIRIM/DITERIMA/PROBLEM.
import { RefactorBanner } from '@/components/ui/refactor-banner'
export default function OrdersListPage() {
  return <RefactorBanner phase="Phase 3 (Converter Engine + Status Sync)" pageTitle="Daftar Order" />
}
