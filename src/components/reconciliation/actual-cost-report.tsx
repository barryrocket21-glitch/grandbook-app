'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cents, rupiah, parseReferences, validateCosts, costTotals, latestCostReferences, type CostRow } from '@/lib/financial/actual-cost-report'

const supabase = createClient()
const labels = { VERIFIED_COMPONENTS: 'Aktual terverifikasi', VERIFIED_SETTLEMENT: 'Aktual settlement SPX', ESTIMATE: 'Estimasi', MISSING: 'Belum ada biaya' }
export function ActualCostReport() {
  const [input, setInput] = useState(''), [rows, setRows] = useState<CostRow[]>([])
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [scope, setScope] = useState('')
  const request = useRef(0)
  useEffect(() => () => { request.current++ }, [])
  async function load(latest: boolean) {
    const id = ++request.current
    setBusy(true); setError(''); setRows([]); setScope('')
    try {
      let refs: string[]
      if (latest) {
        const results = await Promise.all(['spx_actual_costs', 'spx_settlement_costs'].map(table =>
          supabase.from(table).select('order_number,external_id,transaction_at').order('transaction_at', { ascending: false }).order('external_id').limit(50)))
        if (results.some(result => result.error)) throw new Error('Biaya aktual belum dapat dimuat. Coba lagi.')
        refs = latestCostReferences(results.map(result => result.data || []))
        if (!refs.length) { if (id === request.current) setScope('Belum ada biaya SPX terverifikasi yang tercatat. Cari nomor GB untuk melihat estimasinya.'); return }
      } else refs = parseReferences(input)
      const result = await supabase.rpc('order_shipping_cost_evidence', { p_order_numbers: refs })
      if (result.error) throw new Error('Rincian biaya gagal dimuat. Periksa nomor GB atau coba lagi; identitas order mungkin berubah.')
      const checked = validateCosts(result.data, refs)
      if (id === request.current) { setRows(checked); setScope(latest ? `${refs.length} transaksi terverifikasi terbaru (maksimal 50).` : `${refs.length} order pilihan. Total hanya untuk order di bawah.`) }
    } catch (e) { if (id === request.current) setError(e instanceof Error ? e.message : 'Rincian biaya gagal dimuat.') }
    finally { if (id === request.current) setBusy(false) }
  }
  const totals = costTotals(rows)
  const amount = (v: number | string | null) => v === null ? '—' : rupiah(cents(v))
  return <Card><CardContent className="space-y-4 pt-6">
    <h2 className="font-semibold">Rincian biaya pengiriman</h2>
    <p className="text-sm text-muted-foreground">Biaya aktual mengikuti bukti transaksi atau settlement SPX. Estimasi ditampilkan terpisah. Rincian ini tidak mengurangi saldo atau pencairan lagi dan belum merupakan laba bersih.</p>
    <label htmlFor="cost-order-refs" className="block text-sm font-medium">Nomor GB (maksimal 500)</label>
    <Textarea id="cost-order-refs" value={input} disabled={busy} onChange={e => { setInput(e.target.value); setRows([]); setScope(''); setError('') }} placeholder="Tempel nomor GB, satu per baris atau dipisahkan koma" />
    <div className="flex flex-wrap gap-2">
      <Button disabled={busy} onClick={() => void load(false)}>{busy ? 'Memuat biaya…' : 'Lihat biaya order'}</Button>
      <Button variant="outline" disabled={busy} onClick={() => void load(true)}>50 transaksi terbaru</Button>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {scope && <p role="status" className="text-sm text-muted-foreground">{scope}</p>}
    {rows.length > 0 && <>
      <div className="grid gap-3 text-sm sm:grid-cols-3">
        <div>Aktual terverifikasi ({totals.actualCount})<strong className="block" data-testid="actual-cost-total">{rupiah(totals.actual)}</strong></div>
        <div>Estimasi ({totals.estimateCount})<strong className="block" data-testid="estimated-cost-total">{rupiah(totals.estimate)}</strong></div>
        <div>Belum ada biaya<strong className="block">{totals.missingCount} order</strong></div>
      </div>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm" aria-label="Rincian biaya order"><thead><tr>{['Nomor GB','Basis','Ongkir','COD','PPN terpisah','Total biaya','Nominal debit','Debit saldo tercatat','Selisih biaya − nominal','Selisih biaya − debit saldo'].map(h => <th key={h} className="whitespace-nowrap p-2">{h}</th>)}</tr></thead><tbody>
        {rows.map(row => <tr key={row.order_number} className="border-t"><td className="p-2">{row.order_number}</td><td className="p-2">{labels[row.basis]}</td>{[row.shipping,row.cod,row.ppn,row.total].map((v,i) => <td key={i} className="whitespace-nowrap p-2 tabular-nums">{amount(v)}</td>)}{(row.basis === 'VERIFIED_SETTLEMENT'
          ? [-cents(row.nominal!), cents(row.balance_before!) - cents(row.balance_after!), cents(row.actual_minus_nominal_debit!), cents(row.actual_minus_balance_debit!)]
          : [null,null,null,null]).map((v,i) => <td key={`evidence-${i}`} className="whitespace-nowrap p-2 tabular-nums">{v === null ? '—' : rupiah(v)}</td>)}</tr>)}
      </tbody></table></div>
      <p className="text-xs text-muted-foreground">— berarti nilai belum dinyatakan terpisah atau belum tersedia, bukan nol. Total aktual mengikuti bukti SPX. Selisih = biaya aktual dikurangi nominal debit atau debit saldo tercatat; selisih tetap ditampilkan dan bukan pernyataan kas sudah cocok.</p>
    </>}
  </CardContent></Card>
}
