'use client'

import { useState, useEffect, useMemo } from 'react'
import { getErrorMessage } from '@/lib/errors'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Scale, Loader2, Save, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { formatRupiah } from '@/lib/format'

const supabase = createClient()

interface PlatformRow {
  platform: string
  tracked: number
  invoice: number
  notes: string
  reconId: number | null
}

const currentMonth = () => new Date().toISOString().slice(0, 7) // YYYY-MM
const monthToDate = (m: string) => `${m}-01`

export default function ReconciliationPage() {
  const { role, loading: authLoading } = useAuth()
  const [month, setMonth] = useState(currentMonth())
  const [rows, setRows] = useState<PlatformRow[]>([])
  const [history, setHistory] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    setLoading(true)
    const start = `${month}-01`
    const endDate = new Date(start)
    endDate.setMonth(endDate.getMonth() + 1)
    endDate.setDate(0)
    const end = endDate.toISOString().split('T')[0]
    const reconMonth = monthToDate(month)

    const [
      { data: spends },
      { data: campaigns },
      { data: existingRecons },
      { data: allRecons },
    ] = await Promise.all([
      supabase.from('ad_spend').select('spend, campaign_id').gte('spend_date', start).lte('spend_date', end),
      supabase.from('campaigns').select('id, platform'),
      supabase.from('ad_reconciliation').select('*').eq('recon_month', reconMonth),
      supabase.from('ad_reconciliation').select('*, recon_month').order('recon_month', { ascending: false }).limit(20),
    ])

    // Map campaign_id → platform
    const platformByCampaign = new Map<number, string>()
    ;(campaigns || []).forEach((c: any) => platformByCampaign.set(c.id, c.platform))

    // Aggregate tracked spend per platform
    const trackedByPlatform = new Map<string, number>()
    ;(spends || []).forEach((s: any) => {
      const platform = platformByCampaign.get(s.campaign_id) || 'OTHER'
      trackedByPlatform.set(platform, (trackedByPlatform.get(platform) || 0) + Number(s.spend))
    })

    // Build rows: combine tracked + existing recon entries
    const reconByPlatform = new Map<string, any>()
    ;(existingRecons || []).forEach((r: any) => reconByPlatform.set(r.platform, r))

    // Union of platforms (those with spending + those with existing recon)
    const allPlatforms = new Set([...trackedByPlatform.keys(), ...reconByPlatform.keys()])
    const platformRows: PlatformRow[] = Array.from(allPlatforms).sort().map(platform => {
      const recon = reconByPlatform.get(platform)
      return {
        platform,
        tracked: trackedByPlatform.get(platform) || 0,
        invoice: recon ? Number(recon.real_invoice_amount) : 0,
        notes: recon?.notes || '',
        reconId: recon?.id || null,
      }
    })

    setRows(platformRows)
    setHistory(allRecons || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [month])

  const updateRow = (idx: number, field: 'invoice' | 'notes', value: any) => {
    const next = [...rows]
    ;(next[idx] as any)[field] = value
    setRows(next)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const payload = rows
        .filter(r => r.invoice > 0 || r.notes)
        .map(r => ({
          recon_month: monthToDate(month),
          platform: r.platform,
          real_invoice_amount: r.invoice,
          notes: r.notes || null,
        }))
      if (payload.length === 0) {
        toast.error('Belum ada data tagihan yang diisi')
        return
      }
      const { error } = await supabase
        .from('ad_reconciliation')
        .upsert(payload, { onConflict: 'recon_month,platform' })
      if (error) throw error
      toast.success('Reconciliation tersimpan', { description: `${payload.length} platform untuk bulan ${month}` })
      load()
    } catch (err: any) {
      toast.error('Gagal simpan', { description: getErrorMessage(err) })
    } finally {
      setSaving(false)
    }
  }

  const totals = useMemo(() => {
    const tracked = rows.reduce((s, r) => s + r.tracked, 0)
    const invoice = rows.reduce((s, r) => s + r.invoice, 0)
    return { tracked, invoice, diff: invoice - tracked }
  }, [rows])

  if (authLoading) return <div className="text-sm text-muted-foreground">Memeriksa akses...</div>
  // Phase 8H audit — Cross-check reconciliation: owner+admin+akunting.
  if (role !== 'owner' && role !== 'admin' && role !== 'akunting') {
    return (
      <Card className="max-w-md mx-auto mt-8">
        <CardContent className="pt-6 text-center space-y-2">
          <AlertTriangle className="w-10 h-10 text-yellow-500 mx-auto" />
          <h2 className="text-lg font-semibold">Akses Dibatasi</h2>
          <p className="text-sm text-muted-foreground">Halaman reconciliation hanya untuk Owner, Admin, atau Akunting.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Scale}
        title="Reconciliation"
        description="Bandingkan tagihan real dari Meta/TikTok/Google dengan ad spend yang ter-track di GrandBook"
        actions={
          <div className="flex items-center gap-2">
            <Input type="month" value={month} onChange={e => setMonth(e.target.value)} className="w-40" />
            <Button onClick={handleSave} disabled={saving} className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/20">
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              Simpan
            </Button>
          </div>
        }
      />

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 relative">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Tracked di GrandBook</p>
            <p className="text-2xl font-bold mt-1">{formatRupiah(totals.tracked)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">dari ad_spend yang sudah di-input</p>
          </CardContent>
        </Card>
        <Card className="overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 to-transparent" />
          <CardContent className="pt-4 pb-4 relative">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Tagihan Real</p>
            <p className="text-2xl font-bold mt-1 text-violet-500">{formatRupiah(totals.invoice)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">total dari semua platform yang diisi</p>
          </CardContent>
        </Card>
        <Card className={`overflow-hidden relative ${Math.abs(totals.diff) > 0 ? 'border-amber-500/30' : 'border-emerald-500/30'}`}>
          <div className={`absolute inset-0 bg-gradient-to-br ${totals.diff !== 0 ? 'from-amber-500/5' : 'from-emerald-500/5'} to-transparent`} />
          <CardContent className="pt-4 pb-4 relative">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Selisih</p>
            <p className={`text-2xl font-bold mt-1 ${Math.abs(totals.diff) > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>
              {totals.diff > 0 ? '+' : ''}{formatRupiah(totals.diff)}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {totals.tracked > 0 ? `${((totals.diff / totals.tracked) * 100).toFixed(1)}%` : '—'} dari tracked
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Per-platform reconciliation table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Per Platform — {month}</CardTitle>
          <CardDescription>Input tagihan real (dari billing Meta/TikTok/Google) untuk bandingkan dengan tracked spend</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Platform</TableHead>
                <TableHead className="text-right">Tracked di GrandBook</TableHead>
                <TableHead className="text-right">Tagihan Real (input)</TableHead>
                <TableHead className="text-right">Selisih</TableHead>
                <TableHead className="text-center">%</TableHead>
                <TableHead>Catatan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={6} className="py-3"><div className="h-4 bg-muted animate-pulse rounded w-full" /></TableCell></TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="p-0">
                    <EmptyState
                      icon={Scale}
                      title="Belum ada ad spend bulan ini"
                      description={`Belum ada data ad_spend untuk ${month}. Input dulu di menu Ad Spend, lalu balik kemari untuk reconciliation.`}
                    />
                  </TableCell>
                </TableRow>
              ) : rows.map((r, idx) => {
                const diff = r.invoice - r.tracked
                const diffPct = r.tracked > 0 ? (diff / r.tracked) * 100 : 0
                const flagged = Math.abs(diffPct) > 5 && r.invoice > 0
                const ok = r.invoice > 0 && Math.abs(diffPct) <= 5
                return (
                  <TableRow key={r.platform}>
                    <TableCell>
                      <Badge variant="outline" className="font-medium">{r.platform}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">{formatRupiah(r.tracked)}</TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        value={r.invoice || ''}
                        onChange={e => updateRow(idx, 'invoice', Number(e.target.value))}
                        className="text-right font-mono w-40 ml-auto"
                        placeholder="0"
                      />
                    </TableCell>
                    <TableCell className={`text-right font-mono text-sm ${diff > 0 ? 'text-amber-500' : diff < 0 ? 'text-blue-500' : 'text-muted-foreground'}`}>
                      {r.invoice > 0 ? `${diff > 0 ? '+' : ''}${formatRupiah(diff)}` : '—'}
                    </TableCell>
                    <TableCell className="text-center">
                      {r.invoice > 0 ? (
                        <Badge variant="outline" className={
                          flagged ? 'bg-amber-500/10 text-amber-600 border-amber-500/30' :
                          ok ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' :
                          'bg-zinc-500/10 text-muted-foreground'
                        }>
                          {flagged && <AlertTriangle className="w-3 h-3 mr-1 inline" />}
                          {ok && <CheckCircle2 className="w-3 h-3 mr-1 inline" />}
                          {diffPct > 0 ? '+' : ''}{diffPct.toFixed(1)}%
                        </Badge>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <Input
                        value={r.notes}
                        onChange={e => updateRow(idx, 'notes', e.target.value)}
                        placeholder="optional"
                        className="text-sm"
                      />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="border-blue-500/20 bg-blue-500/5">
        <CardContent className="pt-4 pb-4 text-sm space-y-2">
          <p>📊 <strong>Cara baca selisih:</strong></p>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground">
            <li><span className="text-emerald-500">Hijau</span> (≤5%): tracked spend cukup akurat, advertiser input dengan benar</li>
            <li><span className="text-amber-500">Amber</span> (&gt;5%): kemungkinan auto-bid Meta lebih tinggi, atau advertiser miss input. Investigate.</li>
            <li><span className="text-blue-500">Selisih negatif</span> (tagihan &lt; tracked): kemungkinan ada double-input ad_spend atau credit dari platform.</li>
          </ul>
        </CardContent>
      </Card>

      {/* History */}
      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Riwayat Reconciliation</CardTitle>
            <CardDescription>20 entry terakhir, urut dari yang paling baru</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bulan</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead className="text-right">Tagihan Real</TableHead>
                  <TableHead>Catatan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((h: any) => (
                  <TableRow key={h.id}>
                    <TableCell className="font-mono text-xs">{h.recon_month?.slice(0, 7)}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{h.platform}</Badge></TableCell>
                    <TableCell className="text-right font-mono text-sm">{formatRupiah(Number(h.real_invoice_amount))}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{h.notes || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
