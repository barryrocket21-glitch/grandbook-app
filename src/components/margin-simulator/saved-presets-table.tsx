'use client'
import { useMemo, useState } from 'react'
import { Star, Trash2, Upload } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import type { MarginSimulatorPreset, ProductForSimulator } from '@/lib/types'
import { calculate, formatIDR, formatPct } from '@/lib/margin-simulator/calc'

interface Props {
  presets: MarginSimulatorPreset[]
  products: ProductForSimulator[]
  onLoad: (preset: MarginSimulatorPreset) => void
  onDelete: (preset: MarginSimulatorPreset) => Promise<void>
  onSetDefault: (preset: MarginSimulatorPreset) => Promise<void>
  canWrite: boolean
}

export function SavedPresetsTable({
  presets,
  products,
  onLoad,
  onDelete,
  onSetDefault,
  canWrite,
}: Props) {
  const [deleteTarget, setDeleteTarget] = useState<MarginSimulatorPreset | null>(null)
  const [pendingId, setPendingId] = useState<number | null>(null)

  const productById = useMemo(() => {
    const m = new Map<number, ProductForSimulator>()
    for (const p of products) m.set(p.product_id, p)
    return m
  }, [products])

  async function handleConfirmDelete() {
    if (!deleteTarget) return
    setPendingId(deleteTarget.id)
    try {
      await onDelete(deleteTarget)
      setDeleteTarget(null)
    } finally {
      setPendingId(null)
    }
  }

  async function handleSetDefault(preset: MarginSimulatorPreset) {
    setPendingId(preset.id)
    try {
      await onSetDefault(preset)
    } finally {
      setPendingId(null)
    }
  }

  if (presets.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Saved Presets</CardTitle>
          <CardDescription>
            Belum ada preset tersimpan. Save scenario dari card di atas untuk preview cepat
            asumsi ADV untuk produk tertentu.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Saved Presets</CardTitle>
          <CardDescription>
            Click <Upload className="inline size-3 -mt-0.5" /> Load untuk load preset ke
            scenario card baru. Toggle ⭐ untuk set default per produk.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produk</TableHead>
                <TableHead>Scenario</TableHead>
                <TableHead className="text-right">CPR Max</TableHead>
                <TableHead className="text-right">ROI (preview)</TableHead>
                <TableHead className="text-center">Default</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {presets.map(p => {
                const product = productById.get(p.product_id)
                const preview = calculate({
                  product_id: p.product_id,
                  margin_item: p.margin_item,
                  cpr_max: p.cpr_max,
                  lead_dashboard: p.lead_dashboard,
                  jenis_iklan: p.jenis_iklan,
                  multiplier: p.multiplier,
                  closing_rate: p.closing_rate,
                  rts_rate: p.rts_rate,
                  ppn_rate: p.ppn_rate,
                })
                const isPending = pendingId === p.id
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">
                      {product ? product.product_name : <span className="text-muted-foreground">Produk dihapus</span>}
                    </TableCell>
                    <TableCell>
                      {p.scenario_name}
                      {p.notes && (
                        <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{p.notes}</p>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatIDR(p.cpr_max)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span
                        className={
                          preview.status === 'profit'
                            ? 'text-emerald-500'
                            : preview.status === 'loss'
                              ? 'text-red-500'
                              : ''
                        }
                      >
                        {formatPct(preview.roi_percent)}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      {p.is_default ? (
                        <Badge variant="outline" className="text-amber-500 border-amber-500/40">
                          <Star className="size-3 mr-1 fill-current" />
                          default
                        </Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleSetDefault(p)}
                          disabled={!canWrite || isPending}
                          title="Set sebagai default"
                        >
                          <Star className="size-3.5" />
                        </Button>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onLoad(p)}
                          title="Load ke scenario card baru"
                        >
                          <Upload className="size-3.5 mr-1" />
                          Load
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-500 hover:text-red-600"
                          onClick={() => setDeleteTarget(p)}
                          disabled={!canWrite || isPending}
                          title="Hapus preset"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Delete confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={v => !v && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Hapus preset?</DialogTitle>
            <DialogDescription>
              Hapus <span className="font-semibold">{deleteTarget?.scenario_name}</span> dari saved presets.
              Tindakan tidak bisa di-undo.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={pendingId !== null}>
              Batal
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete} disabled={pendingId !== null}>
              {pendingId !== null ? 'Menghapus...' : 'Hapus'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
