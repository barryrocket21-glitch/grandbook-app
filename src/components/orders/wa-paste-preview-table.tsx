'use client'
// =============================================================
// WA Paste Preview Table — compact inline-editable (konorder-style)
// =============================================================
// Single-line per row biar banyak order tetap muat tanpa scroll heavy:
// - Tiap cell input 1 baris (no badge below)
// - Border-warna langsung mark status:
//     ok    = emerald (produk match / HP valid / CS resolved)
//     warn  = amber (CS belum match)
//     bad   = red (produk no match / HP invalid / field wajib kosong)
// - Hover title= attribute utk info verbose (productMatchedName, phoneReason)
// - Per-row tombol × utk hapus
// - Sticky thead + tfoot grand total
// =============================================================
import { Button } from '@/components/ui/button'
import { X } from 'lucide-react'
import type { AdaptedOrder } from '@/lib/converter/wa-paste-adapter'
import type { ParsedWaOrder } from '@/lib/converter/wa-paste-v3'

type Kind = 'text' | 'number'
type StatusTone = 'ok' | 'warn' | 'bad' | null

interface ColumnSpec {
  field: keyof ParsedWaOrder
  label: string
  kind: Kind
  width: string
  required?: boolean
  align?: 'left' | 'right'
}

const COLUMNS: ColumnSpec[] = [
  { field: 'nama', label: 'Nama', kind: 'text', width: 'min-w-[130px]', required: true },
  { field: 'hp', label: 'HP', kind: 'text', width: 'min-w-[110px]', required: true },
  { field: 'alamat', label: 'Alamat', kind: 'text', width: 'min-w-[200px]', required: true },
  { field: 'kelurahan', label: 'Kel.', kind: 'text', width: 'min-w-[90px]' },
  { field: 'kecamatan', label: 'Kec.', kind: 'text', width: 'min-w-[90px]' },
  { field: 'kota', label: 'Kota', kind: 'text', width: 'min-w-[90px]' },
  { field: 'provinsi', label: 'Provinsi', kind: 'text', width: 'min-w-[90px]' },
  { field: 'kodePos', label: 'Pos', kind: 'text', width: 'min-w-[55px]' },
  { field: 'produk', label: 'Produk', kind: 'text', width: 'min-w-[150px]', required: true },
  { field: 'variation', label: 'Variasi', kind: 'text', width: 'min-w-[110px]' },
  { field: 'qty', label: 'Qty', kind: 'number', width: 'min-w-[50px]', align: 'right' },
  { field: 'hargaTotal', label: 'Total', kind: 'number', width: 'min-w-[95px]', required: true, align: 'right' },
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
          <thead className="bg-muted/60 border-b">
            <tr>
              <th className="px-1.5 py-1.5 text-left font-medium text-muted-foreground w-8 text-[10px]">#</th>
              {COLUMNS.map((c) => (
                <th
                  key={c.field}
                  className={`px-1.5 py-1.5 font-medium text-muted-foreground whitespace-nowrap text-[10px] ${
                    c.align === 'right' ? 'text-right' : 'text-left'
                  } ${c.width}`}
                >
                  {c.label}
                  {c.required && <span className="text-red-500 ml-0.5">*</span>}
                </th>
              ))}
              <th className="px-1.5 py-1.5 text-right font-medium text-muted-foreground min-w-[100px] whitespace-nowrap text-[10px]">
                Total COD
              </th>
              <th className="px-1 py-1.5 w-7"></th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o, i) => {
              const totalCod = o.parsed.hargaTotal ?? 0
              return (
                <tr key={i} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="px-1.5 py-0.5 text-muted-foreground text-[10px] tabular-nums whitespace-nowrap">
                    {i + 1}
                  </td>
                  {COLUMNS.map((c) => {
                    const raw = o.parsed[c.field]
                    const isEmpty = raw === null || raw === undefined || raw === ''
                    const flagRequired = !!c.required && isEmpty

                    // Per-cell status tone + tooltip (GrandBook-specific resolvers)
                    let statusTone: StatusTone = null
                    let tooltip: string | undefined
                    if (c.field === 'produk') {
                      if (o.productMatchedName) {
                        statusTone = 'ok'
                        tooltip = `Match master: ${o.productMatchedName}`
                      } else if (!isEmpty) {
                        statusTone = 'bad'
                        tooltip = 'Produk tidak match ke master'
                      }
                    } else if (c.field === 'hp' && !isEmpty) {
                      if (o.phoneValid) {
                        statusTone = 'ok'
                        tooltip = 'HP valid'
                      } else {
                        statusTone = 'bad'
                        tooltip = `HP invalid: ${o.phoneReason ?? 'unknown'}`
                      }
                    } else if (c.field === 'csName' && !isEmpty) {
                      if (o.csMatched) {
                        statusTone = 'ok'
                        tooltip = `CS resolved: ${o.parsed.csName}`
                      } else {
                        statusTone = 'warn'
                        tooltip = `CS "${o.parsed.csName}" tidak ada di profiles`
                      }
                    }

                    return (
                      <td key={c.field} className={`px-0.5 py-0.5 ${c.width}`}>
                        <CellEditor
                          value={raw}
                          kind={c.kind}
                          align={c.align ?? 'left'}
                          flagRequired={flagRequired}
                          statusTone={statusTone}
                          tooltip={tooltip}
                          onChange={(v) => onUpdate(i, c.field, v)}
                        />
                      </td>
                    )
                  })}
                  <td className="px-1.5 py-0.5 text-right tabular-nums whitespace-nowrap font-medium text-[11px]">
                    Rp {totalCod.toLocaleString('id-ID')}
                  </td>
                  <td className="px-1 py-0.5 text-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0 hover:bg-red-500/10 hover:text-red-500"
                      onClick={() => onRemove(i)}
                      title="Hapus order ini"
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
          {orders.length > 0 && (
            <tfoot className="bg-muted/30 border-t">
              <tr>
                <td
                  colSpan={COLUMNS.length + 1}
                  className="px-1.5 py-1.5 text-right font-medium text-muted-foreground text-[11px]"
                >
                  Grand Total COD · {orders.length} order
                </td>
                <td className="px-1.5 py-1.5 text-right font-bold tabular-nums whitespace-nowrap text-[11px]">
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
  flagRequired,
  statusTone,
  tooltip,
  onChange,
}: {
  value: unknown
  kind: Kind
  align: 'left' | 'right'
  flagRequired: boolean
  statusTone: StatusTone
  tooltip?: string
  onChange: (v: string | number | null) => void
}) {
  const isEmpty = value === null || value === undefined || value === ''
  const displayValue = isEmpty ? '' : String(value)

  // Border + bg color resolution priority:
  // 1. Required field empty → red strong
  // 2. Explicit status tone (ok/warn/bad)
  // 3. Default (transparent, hover hint)
  let borderClass = 'border-transparent hover:border-border focus:border-violet-500'
  if (flagRequired) {
    borderClass = 'border-red-500/60 bg-red-500/5 focus:border-red-500'
  } else if (statusTone === 'ok') {
    borderClass = 'border-emerald-500/30 bg-emerald-500/5 focus:border-emerald-500'
  } else if (statusTone === 'warn') {
    borderClass = 'border-amber-500/40 bg-amber-500/5 focus:border-amber-500'
  } else if (statusTone === 'bad') {
    borderClass = 'border-red-500/40 bg-red-500/5 focus:border-red-500'
  }

  // Title attribute prefers tooltip (status info), falls back to full value
  // supaya user bisa hover liat alamat panjang yg ter-truncate di cell.
  const titleAttr = tooltip ?? (displayValue.length > 20 ? displayValue : undefined)

  return (
    <input
      type="text"
      value={displayValue}
      placeholder={flagRequired ? 'wajib' : ''}
      title={titleAttr}
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
      className={`w-full px-1.5 py-1 text-[11px] rounded border bg-transparent placeholder:text-red-500/70 focus:outline-none focus:ring-1 focus:ring-violet-500/40 ${borderClass} ${
        align === 'right' ? 'text-right tabular-nums' : ''
      }`}
    />
  )
}
