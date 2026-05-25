'use client'
// =============================================================
// WA Paste Preview Table — compact inline-editable
// =============================================================
// Port dari konorder convert preview-table.tsx, di-adapt ke GrandBook:
// - Inline edit per cell (input field), red border kalau field wajib kosong
// - Per-row tombol × untuk hapus
// - Total COD column otomatis (= hargaTotal)
// - Inline status indicator per cell (produk match, HP valid, CS resolved)
// - Sticky thead + tfoot grand total
// - Padding compact biar banyak order tetap muat ke layar
// =============================================================
import { Button } from '@/components/ui/button'
import { X } from 'lucide-react'
import type { AdaptedOrder } from '@/lib/converter/wa-paste-adapter'
import type { ParsedWaOrder } from '@/lib/converter/wa-paste-v3'

type Kind = 'text' | 'number'

interface ColumnSpec {
  field: keyof ParsedWaOrder
  label: string
  kind: Kind
  width: string  // tailwind min-w-* class
  required?: boolean
  align?: 'left' | 'right'
}

const COLUMNS: ColumnSpec[] = [
  { field: 'nama', label: 'Nama', kind: 'text', width: 'min-w-[140px]', required: true },
  { field: 'hp', label: 'HP', kind: 'text', width: 'min-w-[120px]', required: true },
  { field: 'alamat', label: 'Alamat', kind: 'text', width: 'min-w-[220px]', required: true },
  { field: 'kelurahan', label: 'Kel.', kind: 'text', width: 'min-w-[100px]' },
  { field: 'kecamatan', label: 'Kec.', kind: 'text', width: 'min-w-[100px]' },
  { field: 'kota', label: 'Kota', kind: 'text', width: 'min-w-[100px]' },
  { field: 'provinsi', label: 'Provinsi', kind: 'text', width: 'min-w-[100px]' },
  { field: 'kodePos', label: 'Pos', kind: 'text', width: 'min-w-[60px]' },
  { field: 'produk', label: 'Produk', kind: 'text', width: 'min-w-[160px]', required: true },
  { field: 'variation', label: 'Variasi', kind: 'text', width: 'min-w-[120px]' },
  { field: 'qty', label: 'Qty', kind: 'number', width: 'min-w-[50px]', align: 'right' },
  { field: 'hargaTotal', label: 'Total', kind: 'number', width: 'min-w-[100px]', required: true, align: 'right' },
  { field: 'ongkir', label: 'Ongkir', kind: 'number', width: 'min-w-[80px]', align: 'right' },
  { field: 'csName', label: 'CS', kind: 'text', width: 'min-w-[80px]' },
]

export interface WaPastePreviewTableProps {
  orders: AdaptedOrder[]
  onUpdate: (index: number, field: keyof ParsedWaOrder, value: string | number | null) => void
  onRemove: (index: number) => void
}

export function WaPastePreviewTable({ orders, onUpdate, onRemove }: WaPastePreviewTableProps) {
  const grandTotal = orders.reduce((sum, o) => sum + (o.parsed.hargaTotal ?? 0), 0)

  return (
    <div className="border rounded-lg overflow-hidden bg-card">
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="bg-muted/60 border-b sticky top-0 z-10">
            <tr>
              <th className="px-2 py-2 text-left font-medium text-muted-foreground w-10">#</th>
              {COLUMNS.map((c) => (
                <th
                  key={c.field}
                  className={`px-2 py-2 font-medium text-muted-foreground whitespace-nowrap ${
                    c.align === 'right' ? 'text-right' : 'text-left'
                  } ${c.width}`}
                >
                  {c.label}
                  {c.required && <span className="text-red-500 ml-0.5">*</span>}
                </th>
              ))}
              <th className="px-2 py-2 text-right font-medium text-muted-foreground min-w-[110px] whitespace-nowrap">
                Total COD
              </th>
              <th className="px-1 py-2 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o, i) => {
              const totalCod = o.parsed.hargaTotal ?? 0
              return (
                <tr key={i} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="px-2 py-1.5 text-muted-foreground align-top text-[10px] tabular-nums">{i + 1}</td>
                  {COLUMNS.map((c) => {
                    const raw = o.parsed[c.field]
                    const isEmpty = raw === null || raw === undefined || raw === ''
                    const flag = !!c.required && isEmpty
                    return (
                      <td key={c.field} className={`px-1 py-1 align-top ${c.width}`}>
                        <CellEditor
                          value={raw}
                          kind={c.kind}
                          align={c.align ?? 'left'}
                          flagged={flag}
                          onChange={(v) => onUpdate(i, c.field, v)}
                        />
                        {c.field === 'produk' && (
                          o.productMatchedName ? (
                            <div className="text-[9px] text-emerald-600 dark:text-emerald-400 mt-0.5 px-1.5">
                              → {o.productMatchedName}
                            </div>
                          ) : (
                            <div className="text-[9px] text-red-500 mt-0.5 px-1.5">no match</div>
                          )
                        )}
                        {c.field === 'hp' && !isEmpty && (
                          <div className={`text-[9px] mt-0.5 px-1.5 ${o.phoneValid ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
                            {o.phoneValid ? '✓ valid' : `✗ ${o.phoneReason ?? 'invalid'}`}
                          </div>
                        )}
                        {c.field === 'csName' && !isEmpty && (
                          <div className={`text-[9px] mt-0.5 px-1.5 ${o.csMatched ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600'}`}>
                            {o.csMatched ? '✓ resolved' : 'belum match'}
                          </div>
                        )}
                      </td>
                    )
                  })}
                  <td className="px-2 py-1.5 text-right align-top tabular-nums whitespace-nowrap font-medium">
                    Rp {totalCod.toLocaleString('id-ID')}
                  </td>
                  <td className="px-1 py-1 align-top text-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 hover:bg-red-500/10 hover:text-red-500"
                      onClick={() => onRemove(i)}
                      title="Hapus order ini"
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
          {orders.length > 0 && (
            <tfoot className="bg-muted/30 border-t">
              <tr>
                <td colSpan={COLUMNS.length + 1} className="px-2 py-2 text-right font-medium text-muted-foreground">
                  Grand Total COD · {orders.length} order
                </td>
                <td className="px-2 py-2 text-right font-bold tabular-nums whitespace-nowrap">
                  Rp {grandTotal.toLocaleString('id-ID')}
                </td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}

function CellEditor({
  value,
  kind,
  align,
  flagged,
  onChange,
}: {
  value: unknown
  kind: Kind
  align: 'left' | 'right'
  flagged: boolean
  onChange: (v: string | number | null) => void
}) {
  const isEmpty = value === null || value === undefined || value === ''
  return (
    <input
      type="text"
      value={isEmpty ? '' : String(value)}
      placeholder={flagged ? 'wajib' : ''}
      inputMode={kind === 'number' ? 'numeric' : undefined}
      onChange={(e) => {
        const v = e.target.value
        if (kind === 'number') {
          const cleaned = v.replace(/[^\d.-]/g, '')
          const n = Number(cleaned)
          onChange(cleaned === '' || !Number.isFinite(n) ? null : n)
        } else {
          onChange(v)
        }
      }}
      className={`w-full px-1.5 py-1 text-xs rounded border bg-transparent placeholder:text-red-500/70 focus:outline-none focus:ring-1 focus:ring-violet-500 ${
        flagged
          ? 'border-red-500/60 bg-red-500/5'
          : 'border-transparent hover:border-border focus:border-violet-500'
      } ${align === 'right' ? 'text-right tabular-nums' : ''}`}
    />
  )
}
