// TODO Phase 3: refactor bulk-upload menggunakan converter engine.
// Engine akan baca converter_profiles + field_mappings + value_mappings
// untuk parse file dynamic (Orderonline, SPX rekonsil, Mengantar outbound,
// dll. — semua via tabel converter_profiles, gak ada hardcode template).
import { RefactorBanner } from '@/components/ui/refactor-banner'
export default function BulkUploadPage() {
  return <RefactorBanner phase="Phase 3 (Converter Engine)" pageTitle="Upload Massal" />
}
