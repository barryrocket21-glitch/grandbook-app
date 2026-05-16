'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { ShieldCheck, ShieldOff, Search, ChevronLeft, ChevronRight, FileSearch } from 'lucide-react'
import { formatDateTime } from '@/lib/format'
import { ROLE_COLORS, ROLE_LABELS } from '@/lib/constants'
import type { AuditLogRow, UserRole } from '@/lib/types'
import { format, parseISO } from 'date-fns'

const supabase = createClient()
const PAGE_SIZE = 50

const ACTION_OPTIONS = ['ALL', 'INSERT', 'UPDATE', 'DELETE'] as const

export default function AuditLogPage() {
  const { role, loading: authLoading } = useAuth()

  // Filters
  const [from, setFrom] = useState<string>(() => {
    // default: 7 hari terakhir
    const d = new Date()
    d.setDate(d.getDate() - 7)
    return d.toISOString().slice(0, 10)
  })
  const [to, setTo] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [tableName, setTableName] = useState<string>('ALL')
  const [action, setAction] = useState<typeof ACTION_OPTIONS[number]>('ALL')
  const [search, setSearch] = useState('')
  const [userFilter, setUserFilter] = useState<string>('ALL')

  // Data
  const [rows, setRows] = useState<AuditLogRow[]>([])
  const [tableNames, setTableNames] = useState<string[]>([])
  const [users, setUsers] = useState<Array<{ id: string; full_name: string; role: UserRole }>>([])
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [detailTarget, setDetailTarget] = useState<AuditLogRow | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase.rpc('list_audit_logs', {
        p_from: from ? `${from}T00:00:00Z` : null,
        p_to: to ? `${to}T23:59:59Z` : null,
        p_user_id: userFilter === 'ALL' ? null : userFilter,
        p_table_name: tableName === 'ALL' ? null : tableName,
        p_action: action === 'ALL' ? null : action,
        p_search: search.trim() || null,
        p_limit: PAGE_SIZE,
        p_offset: page * PAGE_SIZE,
      })
      if (error) throw error
      const rs = (data || []) as AuditLogRow[]
      setRows(rs)
      setTotalCount(rs[0]?.total_count ? Number(rs[0].total_count) : 0)
    } catch (err) {
      // 42501 = permission denied (non-owner)
      console.warn('list_audit_logs error:', err)
      setRows([])
      setTotalCount(0)
    } finally {
      setLoading(false)
    }
  }, [from, to, userFilter, tableName, action, search, page])

  // Load metadata (distinct table names, users) once
  useEffect(() => {
    if (role !== 'owner') return
    ;(async () => {
      try {
        const [{ data: tableData }, { data: userData }] = await Promise.all([
          supabase.from('audit_log').select('table_name').limit(1000),
          supabase.from('profiles').select('id, full_name, role').eq('active', true).order('full_name'),
        ])
        const distinctTables = Array.from(new Set((tableData || []).map((r: { table_name: string }) => r.table_name).filter(Boolean))).sort()
        setTableNames(distinctTables)
        setUsers((userData || []) as Array<{ id: string; full_name: string; role: UserRole }>)
      } catch (err) {
        console.warn('audit meta load failed', err)
      }
    })()
  }, [role])

  useEffect(() => {
    if (role !== 'owner') return
    load()
  }, [role, load])

  // Reset page saat filter berubah
  useEffect(() => { setPage(0) }, [from, to, userFilter, tableName, action, search])

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  if (authLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>
  }

  if (role !== 'owner') {
    return (
      <div className="space-y-6">
        <PageHeader icon={ShieldCheck} title="Audit Log" />
        <Card className="border-red-500/20 bg-red-500/5">
          <CardContent className="pt-6 pb-6 flex items-center gap-3">
            <ShieldOff className="w-5 h-5 text-red-500 shrink-0" />
            <div>
              <p className="text-sm font-medium text-red-500">Akses Dibatasi</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Halaman audit log hanya bisa diakses oleh role <strong>owner</strong>.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ShieldCheck}
        title="Audit Log"
        description="Riwayat lengkap mutasi data oleh tim. Hanya owner yang bisa lihat."
      />

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Dari</label>
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Sampai</label>
            <Input type="date" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">User</label>
            <Select value={userFilter} onValueChange={v => v && setUserFilter(v)}>
              <SelectTrigger>
                <SelectValue placeholder="Semua user">
                  {(value: string | null) => {
                    if (!value || value === 'ALL') return 'Semua user'
                    return users.find(u => u.id === value)?.full_name ?? value
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Semua user</SelectItem>
                {users.map(u => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.full_name} <span className="text-xs text-muted-foreground">({ROLE_LABELS[u.role] || u.role})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Tabel</label>
            <Select value={tableName} onValueChange={v => v && setTableName(v)}>
              <SelectTrigger><SelectValue placeholder="Semua tabel" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Semua tabel</SelectItem>
                {tableNames.map(t => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Action</label>
            <Select value={action} onValueChange={v => v && setAction(v as typeof ACTION_OPTIONS[number])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Semua</SelectItem>
                <SelectItem value="INSERT">INSERT</SelectItem>
                <SelectItem value="UPDATE">UPDATE</SelectItem>
                <SelectItem value="DELETE">DELETE</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Cari record/tabel</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="record_id..."
                className="pl-9"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">Waktu</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Tabel</TableHead>
                <TableHead>Record ID</TableHead>
                <TableHead>Perubahan</TableHead>
                <TableHead className="text-right">Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={7}><div className="h-4 bg-muted animate-pulse rounded" /></TableCell>
                  </TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="p-0">
                    <EmptyState
                      icon={FileSearch}
                      title="Tidak ada audit log"
                      description="Ubah filter atau perpanjang rentang tanggal."
                    />
                  </TableCell>
                </TableRow>
              ) : rows.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatDateTime(r.created_at)}
                  </TableCell>
                  <TableCell className="text-xs">
                    {r.user_name || <span className="italic text-muted-foreground">—</span>}
                    {r.user_role && (
                      <Badge variant="outline" className={`ml-1 text-[9px] ${ROLE_COLORS[r.user_role as UserRole] || ''}`}>
                        {ROLE_LABELS[r.user_role as UserRole] || r.user_role}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <ActionBadge action={r.action} />
                  </TableCell>
                  <TableCell className="text-xs font-mono">{r.table_name}</TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">{r.record_id}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-xs truncate">
                    {summarizeChanges(r)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setDetailTarget(r)}>
                      Detail
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalCount > PAGE_SIZE && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {totalCount.toLocaleString('id-ID')} entries · halaman {page + 1} dari {totalPages}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>
              <ChevronLeft className="w-3.5 h-3.5 mr-1" /> Prev
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
              Next <ChevronRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* Detail dialog */}
      <Dialog open={!!detailTarget} onOpenChange={v => !v && setDetailTarget(null)}>
        <DialogContent className="sm:max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ActionBadge action={detailTarget?.action || ''} />
              <span className="font-mono text-sm">{detailTarget?.table_name}</span>
              <span className="text-xs text-muted-foreground">id: {detailTarget?.record_id}</span>
            </DialogTitle>
            <DialogDescription>
              {detailTarget && formatDateTime(detailTarget.created_at)}
              {detailTarget?.user_name && <> · oleh <strong>{detailTarget.user_name}</strong></>}
            </DialogDescription>
          </DialogHeader>
          {detailTarget && <AuditDiff entry={detailTarget} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ActionBadge({ action }: { action: string }) {
  const color =
    action === 'INSERT' ? 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30'
    : action === 'UPDATE' ? 'bg-blue-500/15 text-blue-600 border-blue-500/30'
    : action === 'DELETE' ? 'bg-red-500/15 text-red-600 border-red-500/30'
    : 'bg-zinc-500/15 text-zinc-600 border-zinc-500/30'
  return <Badge variant="outline" className={`font-mono text-[10px] ${color}`}>{action}</Badge>
}

function summarizeChanges(r: AuditLogRow): string {
  if (r.action === 'INSERT') {
    const keys = Object.keys(r.new_value || {}).slice(0, 3)
    return keys.length > 0 ? `+ ${keys.join(', ')}…` : 'created'
  }
  if (r.action === 'DELETE') {
    return 'row dihapus'
  }
  // UPDATE → list fields yang berubah
  if (!r.old_value || !r.new_value) return '—'
  const changedFields: string[] = []
  for (const k of Object.keys(r.new_value)) {
    if (JSON.stringify((r.old_value as Record<string, unknown>)[k]) !== JSON.stringify((r.new_value as Record<string, unknown>)[k])) {
      changedFields.push(k)
    }
  }
  if (changedFields.length === 0) return 'no change'
  return changedFields.slice(0, 4).join(', ') + (changedFields.length > 4 ? ` (+${changedFields.length - 4})` : '')
}

function AuditDiff({ entry }: { entry: AuditLogRow }) {
  if (entry.action === 'INSERT') {
    return (
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">New Value</p>
        <pre className="bg-muted/50 p-3 rounded text-[11px] overflow-x-auto whitespace-pre-wrap break-all">
          {JSON.stringify(entry.new_value, null, 2)}
        </pre>
      </div>
    )
  }
  if (entry.action === 'DELETE') {
    return (
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Old Value (sebelum dihapus)</p>
        <pre className="bg-muted/50 p-3 rounded text-[11px] overflow-x-auto whitespace-pre-wrap break-all">
          {JSON.stringify(entry.old_value, null, 2)}
        </pre>
      </div>
    )
  }
  // UPDATE → side-by-side diff
  const oldVal = (entry.old_value || {}) as Record<string, unknown>
  const newVal = (entry.new_value || {}) as Record<string, unknown>
  const allKeys = Array.from(new Set([...Object.keys(oldVal), ...Object.keys(newVal)]))
  const changedKeys = allKeys.filter(k => JSON.stringify(oldVal[k]) !== JSON.stringify(newVal[k]))

  if (changedKeys.length === 0) {
    return <p className="text-xs text-muted-foreground italic">Tidak ada perubahan terdeteksi.</p>
  }

  return (
    <div className="space-y-2">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">
        Diff ({changedKeys.length} field berubah)
      </p>
      <div className="space-y-2">
        {changedKeys.map(k => (
          <div key={k} className="grid grid-cols-[140px_1fr_1fr] gap-2 items-start border-b pb-2">
            <div className="text-xs font-mono text-muted-foreground">{k}</div>
            <div className="text-xs bg-red-500/10 p-2 rounded font-mono break-all whitespace-pre-wrap">
              {formatVal(oldVal[k])}
            </div>
            <div className="text-xs bg-emerald-500/10 p-2 rounded font-mono break-all whitespace-pre-wrap">
              {formatVal(newVal[k])}
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-[140px_1fr_1fr] gap-2 text-[10px] uppercase tracking-wider text-muted-foreground pt-2">
        <span>Field</span>
        <span>Sebelum</span>
        <span>Sesudah</span>
      </div>
    </div>
  )
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return '∅'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v, null, 2)
}
