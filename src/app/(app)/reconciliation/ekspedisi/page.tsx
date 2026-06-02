'use client'

import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import { useAuth } from '@/components/providers/auth-provider'
import {
  Scale, ArrowRight, FileSpreadsheet, Wallet, Upload,
  Lock, Sparkles,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { PayoutReconSection } from '@/components/reconciliation/payout-recon-section'

interface FlowLink {
  title: string
  description: string
  href: string
  icon: LucideIcon
}

interface AggregatorCard {
  name: string
  status: 'active' | 'coming-soon'
  description: string
  flows: FlowLink[]
}

const AGGREGATORS: AggregatorCard[] = [
  {
    name: 'SPX (Shopee Express)',
    status: 'active',
    description: 'Dua file rekonsil terpisah dari Shopee Seller Center.',
    flows: [
      {
        title: 'Financial Report',
        description: 'Settlement per-order: shipping_cost_actual + payout per resi.',
        href: '/reconciliation/spx',
        icon: FileSpreadsheet,
      },
      {
        title: 'Cashflow Harian',
        description: 'Account Transaction List: saldo, COD masuk, penarikan.',
        href: '/reconciliation/spx-cashflow',
        icon: Wallet,
      },
    ],
  },
  {
    name: 'Generic Upload (Custom Profile)',
    status: 'active',
    description: 'Upload file rekonsil pakai converter profile yg lo bikin sendiri. Cocok buat Mengantar, JNE manual, atau aggregator lain yg belum punya flow dedicated.',
    flows: [
      {
        title: 'Upload via Converter Profile',
        description: 'Pilih profile INBOUND_REKONSIL → preview → apply ke orders.',
        href: '/reconciliation/upload',
        icon: Upload,
      },
    ],
  },
  {
    name: 'JNE',
    status: 'coming-soon',
    description: 'Dedicated flow untuk file rekonsil JNE — sedang dirancang. Sementara pakai Generic Upload.',
    flows: [],
  },
  {
    name: 'Mengantar',
    status: 'coming-soon',
    description: 'Dedicated flow untuk aggregator Mengantar — sedang dirancang. Sementara pakai Generic Upload.',
    flows: [],
  },
  {
    name: 'Lincah',
    status: 'coming-soon',
    description: 'Dedicated flow untuk aggregator Lincah — sedang dirancang. Sementara pakai Generic Upload.',
    flows: [],
  },
]

export default function ReconEkspedisiLandingPage() {
  const { role } = useAuth()
  const canManage = role === 'owner' || role === 'admin' || role === 'akunting'

  if (!canManage) {
    return (
      <div className="space-y-6">
        <PageHeader icon={Scale} title="Rekonsiliasi Ekspedisi" />
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          Hanya owner / admin / akunting yang bisa akses rekonsiliasi keuangan.
        </CardContent></Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Scale}
        title="Rekonsiliasi Ekspedisi"
        description="Match laporan ekspedisi/agregator dengan order di GrandBook — update biaya aktual, payout, saldo, dan cashflow."
      />

      {/* Sub-brief #17 — payout/pencairan: set CAIR + flip komisi PAID (flow aktif utama) */}
      <PayoutReconSection />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {AGGREGATORS.map((agg) => (
          <Card key={agg.name} className={agg.status === 'coming-soon' ? 'opacity-60' : ''}>
            <CardContent className="pt-5 pb-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold">{agg.name}</h3>
                    {agg.status === 'active' && (
                      <Badge variant="outline" className="text-[10px] bg-emerald-500/10 border-emerald-500/30 text-emerald-600">
                        <Sparkles className="w-3 h-3 mr-0.5" /> Aktif
                      </Badge>
                    )}
                    {agg.status === 'coming-soon' && (
                      <Badge variant="outline" className="text-[10px] bg-zinc-500/10 border-zinc-500/30 text-zinc-500">
                        <Lock className="w-3 h-3 mr-0.5" /> Coming soon
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{agg.description}</p>
                </div>
              </div>

              {agg.flows.length > 0 && (
                <div className="space-y-2 pt-1">
                  {agg.flows.map((flow) => (
                    <Link
                      key={flow.href}
                      href={flow.href}
                      className="group flex items-start gap-3 p-3 rounded-lg border border-border/60 hover:border-violet-500/40 hover:bg-violet-500/5 transition-colors"
                    >
                      <div className="shrink-0 mt-0.5 size-8 rounded-md bg-gradient-to-br from-violet-500/15 to-indigo-500/15 ring-1 ring-violet-500/20 flex items-center justify-center">
                        <flow.icon className="size-4 text-violet-400" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium group-hover:text-violet-400 transition-colors">{flow.title}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">{flow.description}</div>
                      </div>
                      <ArrowRight className="size-4 text-muted-foreground/60 group-hover:text-violet-400 transition-colors shrink-0 mt-1.5" />
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="pt-4 pb-4 text-xs text-muted-foreground space-y-1.5">
          <div className="font-medium text-foreground">💡 Cara nentuin pakai flow yang mana</div>
          <ul className="list-disc list-inside space-y-1">
            <li><span className="text-foreground font-medium">SPX Financial</span> — wajib buat closing harian SPX. Update shipping cost aktual + payout per order.</li>
            <li><span className="text-foreground font-medium">SPX Cashflow</span> — track saldo SPX, COD masuk, dan withdraw ke rekening.</li>
            <li><span className="text-foreground font-medium">Generic Upload</span> — buat aggregator/ekspedisi yang belum ada flow dedicated. Wajib udah ada converter profile yg di-setup di Settings → Converter Profiles.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
