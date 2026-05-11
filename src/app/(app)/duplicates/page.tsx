'use client'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Archive, ArrowRight, Inbox } from 'lucide-react'

export default function DuplicatesPage() {
  return (
    <div className="max-w-2xl mx-auto py-12">
      <Card className="border-zinc-500/40 bg-gradient-to-br from-zinc-500/5 to-transparent">
        <CardContent className="pt-8 pb-8 text-center space-y-4">
          <div className="inline-flex size-14 items-center justify-center rounded-2xl bg-zinc-500/15 ring-1 ring-zinc-500/30">
            <Archive className="size-7 text-zinc-500" />
          </div>
          <h2 className="text-lg font-semibold">🔒 Page Archived</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Duplicate detection sudah ke-handle <strong>engine inbound</strong>.
          </p>
          <div className="rounded-lg border bg-muted/30 p-4 text-left text-sm space-y-2 max-w-md mx-auto">
            <p className="font-medium">Mekanisme baru:</p>
            <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
              <li>Duplicate by <code className="font-mono text-violet-500">external_order_id</code> otomatis di-skip saat bulk upload</li>
              <li>Order in-doubt masuk{' '}
                <Link href="/inbox/pending-review" className="text-violet-500 hover:underline">/inbox/pending-review</Link>{' '}
                untuk review owner/admin
              </li>
              <li>Resi tidak match order → <Link href="/inbox/unmatched-resi" className="text-violet-500 hover:underline">/inbox/unmatched-resi</Link></li>
            </ul>
          </div>
          <div className="pt-2">
            <Link href="/inbox/pending-review">
              <Button>
                <Inbox className="w-4 h-4 mr-2" />
                Buka Inbox
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
