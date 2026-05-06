'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Loader2, Save, ClipboardCheck, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import type { Product } from '@/lib/types'

const supabase = createClient()

interface RowState {
  product_id: number
  product_name: string
  leads_count: number
  closing_count: number    // auto from orders
  rejected_count: number
  notes: string
  existing_id?: number
}

const yesterday = () => {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}

export default function CsReportPage() {
  const { profile, role } = useAuth()
  const [reportDate, setReportDate] = useState(yesterday())
  const [products, setProducts] = useState<Product[]>([])
  const [rows, setRows] = useState<RowState[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!profile?.id) return
    const load = async () => {
      setLoading(true)
      // Get all active products
      const { data: prods } = await supabase.from('products').select('*').eq('active', true).order('name')
      const productList = prods || []

      // Get this CS's existing report for the date (if any)
      const { data: existing } = await supabase
        .from('cs_daily_leads')
        .select('*')
        .eq('cs_id', profile.id)
        .eq('report_date', reportDate)

      // Get this CS's order closings on this date per product
      const { data: dayOrders } = await supabase
        .from('orders')
        .select('id, order_items(product_id)')
        .eq('cs_id', profile.id)
        .eq('order_date', reportDate)
        .is('duplicate_of', null)
        .not('status', 'in', '(CANCEL,FAKE)')

      // Build closing count per product
      const closingByProduct = new Map<number, number>()
      ;(dayOrders || []).forEach((o: any) => {
        ;(o.order_items || []).forEach((it: any) => {
          closingByProduct.set(it.product_id, (closingByProduct.get(it.product_id) || 0) + 1)
        })
      })

      const existingMap = new Map<number, any>()
      ;(existing || []).forEach((r: any) => existingMap.set(r.product_id, r))

      const rowState: RowState[] = productList.map(p => {
        const ex = existingMap.get(p.id)
        return {
          product_id: p.id,
          product_name: p.name,
          leads_count: ex?.leads_count ?? 0,
          closing_count: closingByProduct.get(p.id) ?? 0,
          rejected_count: ex?.rejected_count ?? 0,
          notes: ex?.notes ?? '',
          existing_id: ex?.id,
        }
      })

      setProducts(productList)
      setRows(rowState)
      setLoading(false)
    }
    load()
  }, [profile?.id, reportDate])

  const totalLeads = useMemo(() => rows.reduce((s, r) => s + r.leads_count, 0), [rows])
  const totalClosing = useMemo(() => rows.reduce((s, r) => s + r.closing_count, 0), [rows])
  const totalRejected = useMemo(() => rows.reduce((s, r) => s + r.rejected_count, 0), [rows])
  const totalPipeline = totalLeads - totalClosing - totalRejected

  const updateRow = (idx: number, field: keyof RowState, value: any) => {
    const next = [...rows]
    ;(next[idx] as any)[field] = value
    setRows(next)
  }

  const handleSubmit = async () => {
    if (!profile?.id) return
    setSaving(true)
    try {
      const payload = rows
        .filter(r => r.leads_count > 0 || r.closing_count > 0 || r.rejected_count > 0 || r.notes)
        .map(r => ({
          cs_id: profile.id,
          product_id: r.product_id,
          report_date: reportDate,
          leads_count: r.leads_count,
          closing_count: r.closing_count,
          rejected_count: r.rejected_count,
          notes: r.notes || null,
          submitted_at: new Date().toISOString(),
        }))

      if (payload.length === 0) {
        toast.error('Belum ada angka yang diisi')
        return
      }

      const { error } = await supabase
        .from('cs_daily_leads')
        .upsert(payload, { onConflict: 'cs_id,product_id,report_date' })

      if (error) throw error
      toast.success('Laporan tersimpan', { description: `${reportDate} — ${payload.length} produk` })
    } catch (err: any) {
      toast.error('Gagal simpan', { description: err.message })
    } finally {
      setSaving(false)
    }
  }

  const formatPercent = (num: number, denom: number) => {
    if (!denom) return '—'
    return `${((num / denom) * 100).toFixed(0)}%`
  }

  if (role && !['cs', 'owner', 'admin'].includes(role)) {
    return (
      <Card className="max-w-md mx-auto mt-8">
        <CardContent className="pt-6 text-center space-y-2">
          <AlertTriangle className="w-10 h-10 text-yellow-500 mx-auto" />
          <h2 className="text-lg font-semibold">Akses Dibatasi</h2>
          <p className="text-sm text-muted-foreground">Halaman ini untuk role CS, Admin, atau Owner.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <PageHeader
        icon={ClipboardCheck}
        title="Laporan Harian"
        description="Input lead masuk per produk di hari yang dilaporkan"
        actions={
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" onClick={() => {
              const d = new Date(reportDate); d.setDate(d.getDate() - 1); setReportDate(d.toISOString().split('T')[0])
            }} title="Hari sebelumnya"><ChevronLeft className="w-4 h-4" /></Button>
            <Input type="date" value={reportDate} onChange={e => setReportDate(e.target.value)} className="w-40" max={new Date().toISOString().split('T')[0]} />
            <Button variant="outline" size="icon" onClick={() => {
              const d = new Date(reportDate); d.setDate(d.getDate() + 1)
              const todayStr = new Date().toISOString().split('T')[0]
              const next = d.toISOString().split('T')[0]
              if (next <= todayStr) setReportDate(next)
            }} title="Hari berikutnya" disabled={reportDate >= new Date().toISOString().split('T')[0]}><ChevronRight className="w-4 h-4" /></Button>
            <Button onClick={handleSubmit} disabled={saving} className="ml-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/20">
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              Submit
            </Button>
          </div>
        }
      />

      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 relative">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Lead</p>
            <p className="text-2xl font-bold mt-1">{totalLeads}</p>
          </CardContent>
        </Card>
        <Card className="overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 relative">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Closing</p>
            <p className="text-2xl font-bold mt-1 text-emerald-500">{totalClosing}</p>
            <p className="text-xs text-muted-foreground mt-0.5">CR {formatPercent(totalClosing, totalLeads)}</p>
          </CardContent>
        </Card>
        <Card className="overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 relative">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Rejected</p>
            <p className="text-2xl font-bold mt-1 text-red-500">{totalRejected}</p>
          </CardContent>
        </Card>
        <Card className="overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 relative">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Pipeline</p>
            <p className="text-2xl font-bold mt-1 text-amber-500">{totalPipeline}</p>
            <p className="text-xs text-muted-foreground mt-0.5">aktif (carryover)</p>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produk</TableHead>
                <TableHead className="text-center w-32">Lead Masuk</TableHead>
                <TableHead className="text-center w-24">Closing</TableHead>
                <TableHead className="text-center w-32">Rejected</TableHead>
                <TableHead className="text-center w-20">CR</TableHead>
                <TableHead className="text-center w-24">Pipeline</TableHead>
                <TableHead>Catatan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={7} className="py-3"><div className="h-4 bg-muted animate-pulse rounded w-full" /></TableCell></TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                    Tidak ada produk aktif. Tambah produk dulu di Master Produk.
                  </TableCell>
                </TableRow>
              ) : rows.map((r, idx) => {
                const pipeline = r.leads_count - r.closing_count - r.rejected_count
                const cr = r.leads_count ? (r.closing_count / r.leads_count) * 100 : 0
                const hasActivity = r.leads_count > 0 || r.closing_count > 0 || r.rejected_count > 0
                return (
                  <TableRow key={r.product_id} className={hasActivity ? '' : 'opacity-50'}>
                    <TableCell className="font-medium">{r.product_name}</TableCell>
                    <TableCell>
                      <Input type="number" min={0} value={r.leads_count} onChange={e => updateRow(idx, 'leads_count', Number(e.target.value))} className="text-center" />
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="font-semibold text-emerald-500">{r.closing_count}</span>
                      {r.closing_count > 0 && r.leads_count === 0 && (
                        <p className="text-[10px] text-muted-foreground mt-0.5" title="Closing dari lead hari sebelumnya (carryover pipeline)">ℹ️ carryover</p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Input type="number" min={0} value={r.rejected_count} onChange={e => updateRow(idx, 'rejected_count', Number(e.target.value))} className="text-center" />
                    </TableCell>
                    <TableCell className="text-center">
                      {r.leads_count > 0 ? (
                        <Badge variant="outline" className={cr >= 60 ? 'bg-emerald-500/10 text-emerald-600' : cr >= 30 ? 'bg-amber-500/10 text-amber-600' : 'bg-red-500/10 text-red-600'}>
                          {cr.toFixed(0)}%
                        </Badge>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-center">
                      <span className={pipeline > 0 ? 'text-amber-500 font-medium' : 'text-muted-foreground'}>{pipeline}</span>
                    </TableCell>
                    <TableCell>
                      <Input value={r.notes} onChange={e => updateRow(idx, 'notes', e.target.value)} placeholder="catatan reject (opsional)" className="text-sm" />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="border-blue-500/20 bg-blue-500/5">
        <CardContent className="pt-4 pb-4">
          <p className="text-sm">
            💡 <strong>Tips:</strong> "Closing" auto-counted dari order yang kamu input dengan tanggal {reportDate}.
            Kalau lead = 0 tapi closing &gt; 0 (tag <span className="font-mono text-xs">ℹ️ carryover</span>), itu order dari lead hari-hari sebelumnya — normal.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
