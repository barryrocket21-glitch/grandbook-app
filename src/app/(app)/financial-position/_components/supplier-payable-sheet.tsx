'use client'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Building2, Coins, Calendar, Loader2, CheckCircle2, ChevronDown, ChevronRight,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { formatRupiah, formatDate } from '@/lib/format'

const supabase = createClient()

interface SupplierGroup {
  supplier_id: number
  supplier_code: string
  supplier_name: string
  total_owed: number
  order_count: number
  qty_total: number
  oldest_shipped_at: string
}

interface PayableDetail {
  id: number
  order_id: number
  order_number: string
  customer_name: string
  hpp_total: number
  qty_total: number
  shipped_at: string
}

/**
 * Sheet detail HPP terutang per supplier. Klik supplier row → expand list
 * order pending. Owner/admin bisa mark batch as paid.
 */
export function SupplierPayableSheet({
  open, onOpenChange, onChanged,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onChanged: () => void
}) {
  const { role } = useAuth()
  const canManage = role === 'owner' || role === 'admin'

  const [groups, setGroups] = useState<SupplierGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedSupplier, setExpandedSupplier] = useState<number | null>(null)
  const [details, setDetails] = useState<Record<number, PayableDetail[]>>({})
  const [detailLoading, setDetailLoading] = useState(false)
  const [selectedPayables, setSelectedPayables] = useState<Set<number>>(new Set())
  const [marking, setMarking] = useState(false)

  const loadGroups = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase.rpc('list_supplier_payable_groups', { p_status: 'PENDING' })
      if (error) throw error
      setGroups((data || []) as SupplierGroup[])
    } catch (err) {
      console.warn('list_supplier_payable_groups failed:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      loadGroups()
      setSelectedPayables(new Set())
      setExpandedSupplier(null)
    }
  }, [open, loadGroups])

  const loadDetails = async (supplierId: number) => {
    if (details[supplierId]) return // cached
    setDetailLoading(true)
    try {
      const { data, error } = await supabase
        .from('supplier_payable')
        .select(`
          id, order_id, hpp_total, qty_total, shipped_at,
          order:orders(order_number, customer_name)
        `)
        .eq('status', 'PENDING')
        .eq('supplier_id', supplierId)
        .order('shipped_at', { ascending: true })
        .limit(200)
      if (error) throw error
      const mapped: PayableDetail[] = (data || []).map((r: { id: number; order_id: number; hpp_total: number; qty_total: number; shipped_at: string; order: { order_number: string; customer_name: string } | { order_number: string; customer_name: string }[] | null }) => {
        const o = Array.isArray(r.order) ? r.order[0] : r.order
        return {
          id: r.id,
          order_id: r.order_id,
          order_number: o?.order_number || '—',
          customer_name: o?.customer_name || '—',
          hpp_total: Number(r.hpp_total),
          qty_total: Number(r.qty_total),
          shipped_at: r.shipped_at,
        }
      })
      setDetails(prev => ({ ...prev, [supplierId]: mapped }))
    } catch (err) {
      console.warn('Load supplier details failed:', err)
    } finally {
      setDetailLoading(false)
    }
  }

  const toggleExpand = (supplierId: number) => {
    if (expandedSupplier === supplierId) {
      setExpandedSupplier(null)
    } else {
      setExpandedSupplier(supplierId)
      loadDetails(supplierId)
    }
  }

  const togglePayable = (id: number) => {
    setSelectedPayables(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleMarkPaid = async () => {
    if (selectedPayables.size === 0) return
    setMarking(true)
    try {
      const ids = Array.from(selectedPayables)
      const ref = prompt('Reference pembayaran (no rekening / TF ID, optional):') || null
      const note = prompt('Catatan (optional):') || null
      const { data, error } = await supabase.rpc('mark_supplier_payable_paid', {
        p_payable_ids: ids,
        p_payment_reference: ref,
        p_payment_note: note,
      })
      if (error) throw error
      toast.success(`${data} payable ditandai PAID`, {
        description: ref ? `Ref: ${ref}` : undefined,
      })
      setSelectedPayables(new Set())
      setDetails({})
      await loadGroups()
      onChanged()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error('Gagal mark paid', { description: msg })
    } finally {
      setMarking(false)
    }
  }

  const totalSelectedAmount = Array.from(selectedPayables).reduce((sum, id) => {
    for (const sId of Object.keys(details)) {
      const found = details[Number(sId)]?.find(d => d.id === id)
      if (found) return sum + found.hpp_total
    }
    return sum
  }, 0)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Coins className="w-4 h-4 text-orange-500" />
            HPP Terutang per Supplier
          </SheetTitle>
          <SheetDescription>
            Click supplier untuk lihat detail order. Owner/admin bisa select dan mark as paid setelah TF ke supplier.
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-4 space-y-3">
          {loading ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
              Loading...
            </div>
          ) : groups.length === 0 ? (
            <Card>
              <CardContent className="pt-6 pb-6 text-center text-sm text-muted-foreground">
                <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
                Tidak ada HPP terutang. Semua supplier sudah dibayar 🎉
              </CardContent>
            </Card>
          ) : (
            groups.map(g => (
              <Card key={g.supplier_id} className="border-orange-500/20">
                <CardContent className="pt-3 pb-3">
                  <button
                    onClick={() => toggleExpand(g.supplier_id)}
                    className="w-full flex items-center justify-between gap-3 text-left hover:bg-muted/40 -mx-3 px-3 py-1 rounded"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {expandedSupplier === g.supplier_id
                        ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                        : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                      <Building2 className="w-4 h-4 text-orange-600 shrink-0" />
                      <div className="min-w-0">
                        <div className="font-semibold text-sm truncate">{g.supplier_name}</div>
                        <div className="text-[11px] text-muted-foreground font-mono">{g.supplier_code}</div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-bold tabular-nums text-orange-700 dark:text-orange-400">{formatRupiah(Number(g.total_owed))}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {g.order_count} order · {g.qty_total} pcs · sejak {formatDate(g.oldest_shipped_at)}
                      </div>
                    </div>
                  </button>

                  {expandedSupplier === g.supplier_id && (
                    <div className="mt-3 pl-6 space-y-1.5">
                      {detailLoading && !details[g.supplier_id] ? (
                        <div className="text-xs text-muted-foreground py-2">Loading detail...</div>
                      ) : details[g.supplier_id]?.length === 0 ? (
                        <div className="text-xs text-muted-foreground py-2">Tidak ada detail.</div>
                      ) : (
                        details[g.supplier_id]?.map(d => (
                          <label
                            key={d.id}
                            className={`flex items-center gap-2 text-xs py-1.5 px-2 rounded hover:bg-muted/40 cursor-pointer ${selectedPayables.has(d.id) ? 'bg-orange-500/10' : ''}`}
                          >
                            {canManage && (
                              <input
                                type="checkbox"
                                checked={selectedPayables.has(d.id)}
                                onChange={() => togglePayable(d.id)}
                                className="w-3.5 h-3.5"
                              />
                            )}
                            <span className="font-mono text-violet-500 shrink-0">{d.order_number}</span>
                            <span className="truncate flex-1">{d.customer_name}</span>
                            <span className="text-muted-foreground shrink-0">{d.qty_total}pcs</span>
                            <span className="tabular-nums font-semibold shrink-0">{formatRupiah(d.hpp_total)}</span>
                            <span className="text-[10px] text-muted-foreground shrink-0">{formatDate(d.shipped_at)}</span>
                          </label>
                        ))
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>

        {canManage && selectedPayables.size > 0 && (
          <div className="sticky bottom-0 bg-background border-t p-3 -mx-4 px-6 flex items-center justify-between gap-2">
            <div className="text-xs">
              <div className="font-semibold">{selectedPayables.size} payable selected</div>
              <div className="text-orange-600 tabular-nums font-bold">{formatRupiah(totalSelectedAmount)}</div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setSelectedPayables(new Set())} disabled={marking}>
                Clear
              </Button>
              <Button
                size="sm"
                onClick={handleMarkPaid}
                disabled={marking}
                className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
              >
                {marking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Mark as Paid
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
