import { Card, CardContent } from '@/components/ui/card'
import { Construction } from 'lucide-react'

interface Props {
  /** Phase mana yang akan refactor page ini, e.g. "Phase 2 (Settings UI)" */
  phase: string
  /** Optional: ringkas apa yang halaman ini lakukan, biar user nginget */
  pageTitle?: string
}

/**
 * Placeholder banner untuk halaman yang sementara di-disable
 * setelah Phase 1 schema migration. Render full-page card.
 */
export function RefactorBanner({ phase, pageTitle }: Props) {
  return (
    <div className="max-w-2xl mx-auto py-12">
      <Card className="border-amber-500/40 bg-gradient-to-br from-amber-500/5 to-transparent">
        <CardContent className="pt-8 pb-8 text-center space-y-3">
          <div className="inline-flex size-14 items-center justify-center rounded-2xl bg-amber-500/15 ring-1 ring-amber-500/30">
            <Construction className="size-7 text-amber-500" />
          </div>
          <h2 className="text-lg font-semibold">🚧 Page sedang di-refactor untuk schema baru</h2>
          {pageTitle && <p className="text-sm text-muted-foreground">{pageTitle}</p>}
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Akan tersedia kembali di <strong className="text-amber-500">{phase}</strong>.
          </p>
          <p className="text-xs text-muted-foreground">
            Phase 1 fokus ke fondasi database (Orders schema baru, courier channels, converter profiles, master wilayah).
            UI ini perlu di-rewrite untuk schema baru.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
