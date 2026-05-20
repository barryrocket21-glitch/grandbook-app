'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Loader2, RefreshCw, History } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { id as localeId } from 'date-fns/locale'
import { toast } from 'sonner'
import type { ReconciliationBatch } from '@/lib/types'

const supabase = createClient()

const STATUS_BADGE_CLASS: Record<string, string> = {
  PREVIEW:   'bg-amber-500/10 text-amber-600 border-amber-500/30',
  APPLIED:   'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
  CANCELLED: 'bg-zinc-500/10 text-zinc-600 border-zinc-500/30',
  FAILED:    'bg-red-500/10 text-red-600 border-red-500/30',
}

const STATUS_LABEL_ID: Record<string, string> = {
  PREVIEW:   'Preview',
  APPLIED:   'Applied',
  CANCELLED: 'Cancelled',
  FAILED:    'Failed',
}

interface CashflowBatchView extends ReconciliationBatch {
  withdrawal_count_view?: number
}

export function CashflowHistory({ onResume }: { onResume?: (batchId: number) => void }) {
  const [batches, setBatches] = useState<CashflowBatchView[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    // Filter by profile_id = spx_account_transaction (id=5 di production seed)
    const { data: profile } = await supabase
      .from('converter_profiles')
      .select('id')
      .eq('code', 'spx_account_transaction')
      .single()
    const profileId = profile?.id
    if (!profileId) {
      setBatches([])
      setLoading(false)
      return
    }
    const { data, error } = await supabase
      .from('reconciliation_batches')
      .select('*, uploaded_by_profile:profiles!uploaded_by(full_name)')
      .eq('profile_id', profileId)
      .order('uploaded_at', { ascending: false })
      .limit(10)
    if (error) {
      console.warn('Load cashflow history failed:', error)
      setBatches([])
    } else {
      const rows = ((data || []) as unknown as CashflowBatchView[]).map((b) => ({
        ...b,
        withdrawal_count_view: typeof b.preview_payload === 'object' && b.preview_payload
          ? Number((b.preview_payload as unknown as { withdrawal_count?: number }).withdrawal_count || 0)
          : 0,
      }))
      setBatches(rows)
    }
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const cancel = async (id: number) => {
    if (!confirm(`Batal kan batch #${id}? Status akan jadi CANCELLED, tidak ada perubahan DB.`)) return
    const { error } = await supabase
      .from('reconciliation_batches')
      .update({ status: 'CANCELLED' })
      .eq('id', id)
    if (error) toast.error('Gagal cancel', { description: error.message })
    else { toast.success('Batch ' + id + ' di-cancel'); await load() }
  }

  return (
    <Card>
      <CardContent className="pt-4 pb-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">History Cashflow (10 terbaru)</h3>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} className="gap-1.5">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>

        {loading ? (
          <div className="py-8 text-center text-muted-foreground text-xs">
            <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Memuat history...
          </div>
        ) : batches.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground text-xs">
            Belum ada history cashflow.
          </div>
        ) : (
          <div className="border rounded-md overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Tanggal</TableHead>
                  <TableHead className="text-xs">File</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs text-right">Total</TableHead>
                  <TableHead className="text-xs text-right">COD Match</TableHead>
                  <TableHead className="text-xs text-right">Variance</TableHead>
                  <TableHead className="text-xs text-right">Unmatch</TableHead>
                  <TableHead className="text-xs text-right">Penarikan</TableHead>
                  <TableHead className="text-xs text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="text-xs whitespace-nowrap">
                      {(() => {
                        try { return format(parseISO(b.uploaded_at), 'dd MMM HH:mm', { locale: localeId }) }
                        catch { return b.uploaded_at }
                      })()}
                    </TableCell>
                    <TableCell className="text-xs max-w-[200px] truncate font-mono" title={b.file_name || ''}>
                      {b.file_name || <span className="text-muted-foreground italic">—</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] ${STATUS_BADGE_CLASS[b.status] || ''}`}>
                        {STATUS_LABEL_ID[b.status] || b.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-right tabular-nums">{b.total_rows.toLocaleString('id-ID')}</TableCell>
                    <TableCell className="text-xs text-right tabular-nums text-emerald-600">{b.matched_count.toLocaleString('id-ID')}</TableCell>
                    <TableCell className="text-xs text-right tabular-nums text-amber-600">{b.variance_count.toLocaleString('id-ID')}</TableCell>
                    <TableCell className="text-xs text-right tabular-nums text-red-600">{b.unmatched_count.toLocaleString('id-ID')}</TableCell>
                    <TableCell className="text-xs text-right tabular-nums text-blue-600">{(b.withdrawal_count_view ?? 0).toLocaleString('id-ID')}</TableCell>
                    <TableCell className="text-xs text-right">
                      {b.status === 'PREVIEW' && onResume && (
                        <Button variant="link" size="sm" className="text-xs h-6 px-2" onClick={() => onResume(b.id)}>
                          Resume
                        </Button>
                      )}
                      {b.status === 'PREVIEW' && (
                        <Button variant="link" size="sm" className="text-xs h-6 px-2 text-zinc-500" onClick={() => void cancel(b.id)}>
                          Cancel
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
