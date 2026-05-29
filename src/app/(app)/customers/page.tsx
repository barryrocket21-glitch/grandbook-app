'use client'
// =============================================================
// Brief #1 — /customers : daftar reputasi pelanggan + blacklist.
// Role: owner, admin (akunting read-only). RPC list_customers_enriched.
// =============================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Users, Search, ChevronLeft, ChevronRight, Ban, Crown, ShieldAlert } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { listCustomers } from '@/lib/supabase/queries/customers'
import {
  CUSTOMER_RISK_TIER_LABEL, CUSTOMER_RISK_TIER_COLOR,
  type CustomerEnriched, type CustomerRiskTier,
} from '@/lib/types'

const supabase = createClient()
const PAGE_SIZE = 50
const TIERS: CustomerRiskTier[] = ['HIGH_RISK', 'WATCH', 'GOOD', 'NEW']

export default function CustomersPage() {
  const { role } = useAuth()
  const allowed = role === 'owner' || role === 'admin' || role === 'akunting'

  const [search, setSearch] = useState('')
  const [tier, setTier] = useState<'ALL' | CustomerRiskTier>('ALL')
  const [blacklisted, setBlacklisted] = useState(false)
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<CustomerEnriched[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { rows, total } = await listCustomers(supabase, {
        search: search.trim() || null,
        tier: tier === 'ALL' ? null : tier,
        blacklisted: blacklisted ? true : null,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
      setRows(rows)
      setTotal(total)
    } catch {
      setRows([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [search, tier, blacklisted, page])

  useEffect(() => { if (allowed) load() }, [load, allowed])
  useEffect(() => { setPage(0) }, [search, tier, blacklisted])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pct = (v: number) => `${Math.round(Number(v) * 100)}%`

  if (!allowed) {
    return (
      <div className="space-y-4">
        <PageHeader icon={Users} title="Pelanggan" />
        <EmptyState icon={ShieldAlert} title="Akses Dibatasi" description="Hanya owner & admin yang bisa melihat data pelanggan." />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader icon={Users} title="Pelanggan" description="Reputasi pelanggan per nomor HP. Blacklist nomor bermasalah agar muncul warning saat input order." />

      <Card>
        <CardContent className="pt-4 pb-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari HP atau nama..." className="pl-8" />
            </div>
            <Select value={tier} onValueChange={(v) => v && setTier(v as 'ALL' | CustomerRiskTier)}>
              <SelectTrigger className="w-44">
                <SelectValue>
                  {(v: string | null) => (!v || v === 'ALL' ? 'Semua Tier' : CUSTOMER_RISK_TIER_LABEL[v as CustomerRiskTier])}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Semua Tier</SelectItem>
                {TIERS.map((t) => <SelectItem key={t} value={t}>{CUSTOMER_RISK_TIER_LABEL[t]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant={blacklisted ? 'default' : 'outline'}
              size="sm"
              onClick={() => setBlacklisted((b) => !b)}
              className={blacklisted ? 'bg-red-600 hover:bg-red-700 text-white' : ''}
            >
              <Ban className="w-3.5 h-3.5 mr-1.5" />Blacklist
            </Button>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>HP</TableHead>
                  <TableHead>Nama</TableHead>
                  <TableHead className="text-right">Order</TableHead>
                  <TableHead className="text-right">Delivery</TableHead>
                  <TableHead className="text-right">Retur</TableHead>
                  <TableHead className="text-center">Tier</TableHead>
                  <TableHead className="text-center">Flag</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Memuat...</TableCell></TableRow>
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="py-8"><EmptyState icon={Users} title="Tidak ada data" description="Belum ada pelanggan yang cocok filter." /></TableCell></TableRow>
                ) : rows.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs">{c.phone_raw_sample || c.phone_normalized}</TableCell>
                    <TableCell className="text-sm">{c.name_latest || '—'}</TableCell>
                    <TableCell className="text-right text-sm">{c.total_orders}</TableCell>
                    <TableCell className="text-right text-sm">{pct(c.delivery_rate)}</TableCell>
                    <TableCell className="text-right text-sm">
                      <span className={Number(c.return_rate) >= 0.3 ? 'text-red-600 font-medium' : ''}>{pct(c.return_rate)}</span>
                      <span className="text-muted-foreground"> ({c.returned_count})</span>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={CUSTOMER_RISK_TIER_COLOR[c.risk_tier]}>{CUSTOMER_RISK_TIER_LABEL[c.risk_tier]}</Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        {c.is_blacklisted && <Ban className="w-3.5 h-3.5 text-red-600" />}
                        {c.is_vip && <Crown className="w-3.5 h-3.5 text-amber-500" />}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/customers/${encodeURIComponent(c.phone_normalized)}`}>
                        <Button variant="ghost" size="sm">Detail →</Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{total} pelanggan</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" disabled={page === 0} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="w-4 h-4" /></Button>
              <span>Hal {page + 1} / {totalPages}</span>
              <Button variant="outline" size="icon" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="w-4 h-4" /></Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
