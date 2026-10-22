'use client'
import { useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { CsRegionPerformance } from '@/lib/types'

export function CsRegions({ rows }: { rows: CsRegionPerformance[] }) {
  const [sort, setSort] = useState('delivered')
  const sorted = useMemo(() => [...rows].sort((a, b) => sort === 'returned'
    ? b.returned - a.returned || b.returned_rate - a.returned_rate
    : b.delivered - a.delivered || b.delivered_rate - a.delivered_rate), [rows, sort])
  return <Card><CardContent className="p-4 space-y-3">
    <div className="flex flex-wrap justify-between gap-3">
      <h2 className="font-semibold">Performa wilayah</h2>
      <select aria-label="Urutan performa wilayah" className="rounded border bg-background p-2 text-sm" value={sort} onChange={e => setSort(e.target.value)}>
        <option value="delivered">Delivered terbanyak</option><option value="returned">Returned terbanyak</option>
      </select>
    </div>
    <p className="text-xs text-muted-foreground">Persentase memakai seluruh resi di wilayah tersebut, termasuk yang masih berjalan. Urutan terbaik memakai jumlah delivered; bandingkan juga jumlah sampel dan returned. Returning belum dihitung sebagai Returned.</p>
    {sorted.length === 0 ? <p className="text-sm">Belum ada pengiriman pada periode ini.</p> : <div className="overflow-x-auto"><Table>
      <TableHeader><TableRow><TableHead>Provinsi / Kota</TableHead><TableHead>Resi</TableHead><TableHead>Delivered</TableHead><TableHead>Delivered %</TableHead><TableHead>Returned</TableHead><TableHead>Returned %</TableHead><TableHead>Berjalan / lainnya</TableHead></TableRow></TableHeader>
      <TableBody>{sorted.map(r => <TableRow key={JSON.stringify([r.province,r.city])}><TableCell>{r.city}<div className="text-xs text-muted-foreground">{r.province}</div></TableCell><TableCell>{r.total_orders}</TableCell><TableCell>{r.delivered}</TableCell><TableCell>{r.delivered_rate}%</TableCell><TableCell>{r.returned}</TableCell><TableCell>{r.returned_rate}%</TableCell><TableCell>{r.ongoing}</TableCell></TableRow>)}</TableBody>
    </Table></div>}
  </CardContent></Card>
}
