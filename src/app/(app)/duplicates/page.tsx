// TODO Phase 3: rebuild sebagai inbox unmatched_resi + unmapped_statuses.
// Field 'duplicate_of' lama dihapus — dedup sekarang via UNIQUE
// (organization_id, external_order_id) constraint.
import { RefactorBanner } from '@/components/ui/refactor-banner'
export default function DuplicatesPage() {
  return <RefactorBanner phase="Phase 3 (Inbox Review)" pageTitle="Duplicate Inbox" />
}
