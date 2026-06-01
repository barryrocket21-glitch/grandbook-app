'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Plus, Package, Pencil, Trash2, Search, ShieldOff, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { canManageSettings } from '@/lib/auth/permissions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatRupiah } from '@/lib/format'
import {
  listProductsWithCounts,
  deleteProduct as deleteProductQuery,
} from '@/lib/supabase/queries/variants'
import type { Product } from '@/lib/types'

const supabase = createClient()

type Row = Product & {
  variant_count: number
  active_variants: number
  price_min: number | null
  price_max: number | null
}

export default function ProductsListPage() {
  const { profile, role, loading: authLoading } = useAuth()
  const orgId = profile?.organization_id ?? null
  const canManage = canManageSettings(role)

  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      const data = await listProductsWithCounts(supabase, orgId)
      setRows(data as Row[])
    } catch (err) {
      toast.error('Gagal load produk', { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    if (!search.trim()) return rows
    const q = search.toLowerCase().trim()
    return rows.filter(r => r.name.toLowerCase().includes(q) || (r.sku || '').toLowerCase().includes(q))
  }, [rows, search])

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteProductQuery(supabase, deleteTarget.id)
      toast.success(`Produk "${deleteTarget.name}" dihapus`)
      setDeleteTarget(null)
      load()
    } catch (err) {
      toast.error('Gagal hapus produk', { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setDeleting(false)
    }
  }

  if (authLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>
  if (role !== 'owner' && role !== 'admin' && role !== 'akunting') {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-500">
              <ShieldOff className="size-5" /> Akses ditolak
            </CardTitle>
            <CardDescription>Manage produk hanya untuk owner/admin/akunting.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 space-y-5">
      <PageHeader
        title="Produk"
        description="Master produk + variant (size × color × dst). Klik produk untuk edit variant."
        icon={Package}
        actions={
          canManage ? (
            <Link href="/products/new">
              <Button>
                <Plus className="size-4 mr-2" />
                Tambah Produk
              </Button>
            </Link>
          ) : null
        }
      />

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="Cari nama produk atau SKU..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading produk...</div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Package}
              title={rows.length === 0 ? 'Belum ada produk' : 'Tidak ditemukan'}
              description={
                rows.length === 0
                  ? 'Mulai dengan tambah produk pertama (simple atau variable).'
                  : 'Coba kata kunci lain.'
              }
              action={
                canManage && rows.length === 0 ? (
                  <Link href="/products/new" className="text-violet-500 hover:underline text-sm">
                    + Tambah produk pertama
                  </Link>
                ) : null
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama Produk</TableHead>
                  <TableHead className="text-center">Tipe</TableHead>
                  <TableHead className="text-center">Variant</TableHead>
                  <TableHead className="text-right">Harga Range</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(r => (
                  <TableRow key={r.id} className="cursor-pointer hover:bg-muted/40">
                    <TableCell className="font-medium">
                      <Link href={`/products/${r.id}/edit`} className="hover:underline">
                        {r.name}
                      </Link>
                      {/* Brief #10 — flag berat belum diisi (jangan export 0 diam-diam) */}
                      {(r.weight_kg == null) && (
                        <span className="ml-1.5 inline-flex items-center gap-0.5 rounded border border-orange-500/40 bg-orange-500/10 px-1 py-0.5 text-[9px] text-orange-600 align-middle" title="Berat (kg) belum diisi — export SPX bisa salah berat">
                          <AlertTriangle className="w-2.5 h-2.5" /> berat?
                        </span>
                      )}
                      {r.sku && <div className="text-[10px] font-mono text-muted-foreground">{r.sku}</div>}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={r.has_variants ? 'bg-violet-500/10 text-violet-600' : 'bg-zinc-500/10 text-zinc-500'}>
                        {r.has_variants ? 'Variable' : 'Simple'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center tabular-nums">
                      {r.active_variants}/{r.variant_count}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.price_min !== null && r.price_max !== null
                        ? r.price_min === r.price_max
                          ? formatRupiah(r.price_min)
                          : `${formatRupiah(r.price_min)} – ${formatRupiah(r.price_max)}`
                        : '—'}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={r.active ? 'bg-emerald-500/10 text-emerald-600' : 'bg-zinc-500/10 text-zinc-500'}>
                        {r.active ? 'Aktif' : 'Nonaktif'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Link href={`/products/${r.id}/edit`}>
                          <Button size="sm" variant="ghost"><Pencil className="size-3.5" /></Button>
                        </Link>
                        {canManage && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-500"
                            onClick={() => setDeleteTarget(r)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!deleteTarget} onOpenChange={v => !v && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-500">
              <AlertTriangle className="size-5" /> Hapus produk?
            </DialogTitle>
            <DialogDescription>
              Hapus <span className="font-semibold">{deleteTarget?.name}</span> beserta {deleteTarget?.variant_count} variant.
              Order yang sudah pakai produk ini tetap aman (snapshot di order_items.hpp_snapshot). Tidak bisa di-undo.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>Batal</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Menghapus...' : 'Hapus permanen'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
