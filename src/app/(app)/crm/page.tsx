'use client'
// =============================================================
// Brief #2 — /crm : antrian follow-up order PROBLEM.
// Role: owner/admin (semua kasus), cs (order sendiri; PEMBELI actionable,
// EKSPEDISI read-only). Tombol WA klik-langsung ke pembeli.
// =============================================================
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Headset, ShieldAlert, MessageCircle, Clock, ChevronLeft, ChevronRight } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { formatDate } from '@/lib/format'
import { listCrmCases, buildWaLink, DEFAULT_WA_TEMPLATES } from '@/lib/supabase/queries/crm'
import {
  CRM_PROBLEM_TYPE_LABEL, CRM_PROBLEM_TYPE_COLOR, CRM_STATUS_LABEL, CRM_STATUS_COLOR,
  type CrmCase, type CrmProblemType, type CrmStatus,
} from '@/lib/types'

const supabase = createClient()
const PAGE_SIZE = 100

export default function CrmPage() {
  const { role } = useAuth()
  const allowed = role === 'owner' || role === 'admin' || role === 'cs'

  const [problemType, setProblemType] = useState<'ALL' | CrmProblemType>('ALL')
  const [crmStatus, setCrmStatus] = useState<'ALL' | CrmStatus>('ALL')
  const [scope, setScope] = useState<'all' | 'mine'>('all')
  const [overdue, setOverdue] = useState(false)
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<CrmCase[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { rows, total } = await listCrmCases(supabase, {
        problemType: problemType === 'ALL' ? null : problemType,
        crmStatus: crmStatus === 'ALL' ? null : crmStatus,
        scope, overdue: overdue ? true : null,
        limit: PAGE_SIZE, offset: page * PAGE_SIZE,
      })
      setRows(rows); setTotal(total)
    } catch {
      setRows([]); setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [problemType, crmStatus, scope, overdue, page])

  useEffect(() => { if (allowed) load() }, [load, allowed])
  useEffect(() => { setPage(0) }, [problemType, crmStatus, scope, overdue])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const waFor = (c: CrmCase) => buildWaLink(c.customer_phone, DEFAULT_WA_TEMPLATES[c.problem_type ?? 'PEMBELI'], {
    nama: c.customer_name, order_number: c.order_number, resi: null,
  })

  if (!allowed) {
    return (
      <div className="space-y-4">
        <PageHeader icon={Headset} title="Follow Up (CRM)" />
        <EmptyState icon={ShieldAlert} title="Akses Dibatasi" description="Hanya owner, admin & CS." />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader icon={Headset} title="Follow Up (CRM)"
        description="Antrian order bermasalah. Hubungi pembeli (kasus Pembeli) atau ekspedisi (kasus Ekspedisi), catat hasilnya, lalu resolve." />

      <Card>
        <CardContent className="pt-4 pb-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={problemType} onValueChange={(v) => v && setProblemType(v as 'ALL' | CrmProblemType)}>
              <SelectTrigger className="w-40"><SelectValue>
                {(v: string | null) => v === 'PEMBELI' ? 'Pembeli' : v === 'EKSPEDISI' ? 'Ekspedisi' : 'Semua Tipe'}
              </SelectValue></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Semua Tipe</SelectItem>
                <SelectItem value="PEMBELI">Pembeli</SelectItem>
                <SelectItem value="EKSPEDISI">Ekspedisi</SelectItem>
              </SelectContent>
            </Select>
            <Select value={crmStatus} onValueChange={(v) => v && setCrmStatus(v as 'ALL' | CrmStatus)}>
              <SelectTrigger className="w-40"><SelectValue>
                {(v: string | null) => (!v || v === 'ALL') ? 'Semua Status' : CRM_STATUS_LABEL[v as CrmStatus]}
              </SelectValue></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Semua Status</SelectItem>
                <SelectItem value="OPEN">Open</SelectItem>
                <SelectItem value="IN_PROGRESS">Dikerjakan</SelectItem>
                <SelectItem value="ESCALATED">Eskalasi</SelectItem>
              </SelectContent>
            </Select>
            {(role === 'owner' || role === 'admin') && (
              <Button type="button" variant={scope === 'mine' ? 'default' : 'outline'} size="sm"
                onClick={() => setScope(s => s === 'mine' ? 'all' : 'mine')}>Punya gw</Button>
            )}
            <Button type="button" variant={overdue ? 'default' : 'outline'} size="sm"
              onClick={() => setOverdue(o => !o)}
              className={overdue ? 'bg-red-600 hover:bg-red-700 text-white' : ''}>
              <Clock className="w-3.5 h-3.5 mr-1.5" />Overdue
            </Button>
            <span className="text-xs text-muted-foreground ml-auto">{total} kasus</span>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order#</TableHead>
                  <TableHead>Pembeli</TableHead>
                  <TableHead className="text-center">Tipe</TableHead>
                  <TableHead>Masalah</TableHead>
                  <TableHead className="text-right">Hari</TableHead>
                  <TableHead className="text-center">SLA</TableHead>
                  <TableHead className="text-right">Attempt</TableHead>
                  <TableHead>CS</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">Memuat...</TableCell></TableRow>
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={9} className="py-8"><EmptyState icon={Headset} title="Bersih" description="Tidak ada kasus sesuai filter." /></TableCell></TableRow>
                ) : rows.map((c) => {
                  const wa = waFor(c)
                  return (
                    <TableRow key={c.id} className={c.is_overdue ? 'bg-red-500/5' : ''}>
                      <TableCell className="text-xs font-mono">
                        <Link href={`/crm/${c.id}?source=${c.source ?? 'draft'}`} className="hover:underline">{c.order_number}</Link>
                      </TableCell>
                      <TableCell className="text-sm">
                        {c.customer_name || '—'}
                        <span className="block text-[11px] text-muted-foreground font-mono">{c.customer_phone || '—'}</span>
                      </TableCell>
                      <TableCell className="text-center">
                        {c.problem_type && <Badge variant="outline" className={CRM_PROBLEM_TYPE_COLOR[c.problem_type]}>{CRM_PROBLEM_TYPE_LABEL[c.problem_type]}</Badge>}
                      </TableCell>
                      <TableCell className="text-xs max-w-[180px] truncate">{c.reject_reason || '—'}</TableCell>
                      <TableCell className="text-right text-sm">{c.days_in_problem}h</TableCell>
                      <TableCell className="text-center">
                        {c.is_overdue
                          ? <Badge variant="outline" className="bg-red-500/15 text-red-700 dark:text-red-400">Overdue</Badge>
                          : c.crm_status && <Badge variant="outline" className={CRM_STATUS_COLOR[c.crm_status]}>{CRM_STATUS_LABEL[c.crm_status]}</Badge>}
                      </TableCell>
                      <TableCell className="text-right text-sm">{c.cs_attempts ?? 0}</TableCell>
                      <TableCell className="text-xs">{c.cs_name || '—'}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {wa && (
                          <a href={wa} target="_blank" rel="noopener noreferrer">
                            <Button variant="outline" size="sm" className="text-emerald-600 border-emerald-300 mr-1">
                              <MessageCircle className="w-3.5 h-3.5 mr-1" />WA
                            </Button>
                          </a>
                        )}
                        <Link href={`/crm/${c.id}?source=${c.source ?? 'draft'}`}><Button variant="ghost" size="sm">Detail →</Button></Link>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{total} kasus</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" disabled={page === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft className="w-4 h-4" /></Button>
              <span>Hal {page + 1} / {totalPages}</span>
              <Button variant="outline" size="icon" disabled={page + 1 >= totalPages} onClick={() => setPage(p => p + 1)}><ChevronRight className="w-4 h-4" /></Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
