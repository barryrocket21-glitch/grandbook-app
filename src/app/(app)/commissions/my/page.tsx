// TODO Phase 3: refactor sesuai commission engine v2 yang akan dibangun
// ulang di Phase 3 (status enum baru — DITERIMA gantikan SELESAI sebagai
// trigger EARNED, RETUR cancel, status_history sebagai source of truth).
import { RefactorBanner } from '@/components/ui/refactor-banner'
export default function MyCommissionsPage() {
  return <RefactorBanner phase="Phase 3 (Commission Engine v2)" pageTitle="Komisi Saya" />
}
