'use client'
// =============================================================
// Brief #1 — /customers/[phone] : detail reputasi + riwayat order +
// Toggle Blacklist / Mark VIP / Add Note (owner+admin). Audit via DB trigger.
// =============================================================
import { useCallback, useEffect, useState } from 'react'
import { getErrorMessage } from '@/lib/errors'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { ArrowLeft, Ban, Crown, ShieldAlert, Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { STATUS_BADGE_COLOR, STATUS_LABEL } from '@/lib/schemas/settings'
import { customerBlacklistSchema, customerNoteSchema } from '@/lib/schemas/customer'
import { formatRupiah, formatDate } from '@/lib/format'
import {
  CUSTOMER_RISK_TIER_LABEL, CUSTOMER_RISK_TIER_COLOR,
  type Customer, type OrderStatus,
} from '@/lib/types'

const supabase = createClient()

interface OrderLite {
  id: number; order_number: string; status: OrderStatus; total: number
  order_date: string | null; resi: string | null; cs_name: string | null
}

export default function CustomerDetailPage() {
  const params = useParams<{ phone: string }>()
  const phone = decodeURIComponent(params.phone || '')
  const { user, role } = useAuth()
  const canManage = role === 'owner' || role === 'admin'

  const [cust, setCust] = useState<Customer | null>(null)
  const [orders, setOrders] = useState<OrderLite[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [blacklistOpen, setBlacklistOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data: c } = await supabase.from('customers').select('*').eq('phone_normalized', phone).maybeSingle()
      setCust((c as Customer) || null)
      setNote((c as Customer)?.note || '')
      // Riwayat order: orders.customer_phone bisa "8xxx" atau "08xxx"
      const { data: ords } = await supabase
        .from('orders')
        .select('id, order_number, status, total, order_date, resi, cs_name')
        .in('customer_phone', [phone, '0' + phone])
        .order('order_date', { ascending: false })
        .limit(100)
      setOrders((ords || []) as OrderLite[])
    } catch {
      setCust(null)
    } finally {
      setLoading(false)
    }
  }, [phone])

  useEffect(() => { load() }, [load])

  const toggleBlacklist = async (activate: boolean) => {
    if (!cust) return
    const parsed = customerBlacklistSchema.safeParse({
      customerId: cust.id, isBlacklisted: activate, reason: activate ? reason : null,
    })
    if (!parsed.success) { toast.error(parsed.error.issues[0]?.message ?? 'Validasi gagal'); return }
    setSaving(true)
    try {
      const { error } = await supabase.from('customers').update(
        activate
          ? { is_blacklisted: true, blacklist_reason: reason.trim(), blacklisted_by: user?.id ?? null, blacklisted_at: new Date().toISOString(), updated_at: new Date().toISOString() }
          : { is_blacklisted: false, blacklist_reason: null, blacklisted_by: null, blacklisted_at: null, updated_at: new Date().toISOString() }
      ).eq('id', cust.id)
      if (error) throw error
      toast.success(activate ? 'Nomor di-blacklist' : 'Blacklist dilepas')
      setBlacklistOpen(false); setReason('')
      await load()
    } catch (err) {
      toast.error('Gagal update blacklist', { description: getErrorMessage(err) })
    } finally { setSaving(false) }
  }

  const toggleVip = async () => {
    if (!cust) return
    setSaving(true)
    try {
      const { error } = await supabase.from('customers')
        .update({ is_vip: !cust.is_vip, updated_at: new Date().toISOString() }).eq('id', cust.id)
      if (error) throw error
      toast.success(cust.is_vip ? 'VIP dilepas' : 'Ditandai VIP')
      await load()
    } catch (err) {
      toast.error('Gagal update VIP', { description: getErrorMessage(err) })
    } finally { setSaving(false) }
  }

  const saveNote = async () => {
    if (!cust) return
    const parsed = customerNoteSchema.safeParse({ customerId: cust.id, note: note.trim() || null })
    if (!parsed.success) { toast.error(parsed.error.issues[0]?.message ?? 'Validasi gagal'); return }
    setSaving(true)
    try {
      const { error } = await supabase.from('customers')
        .update({ note: note.trim() || null, updated_at: new Date().toISOString() }).eq('id', cust.id)
      if (error) throw error
      toast.success('Catatan disimpan')
      await load()
    } catch (err) {
      toast.error('Gagal simpan catatan', { description: getErrorMessage(err) })
    } finally { setSaving(false) }
  }

  const pct = (v: number) => `${Math.round(Number(v) * 100)}%`

  if (loading) return <div className="space-y-4"><PageHeader icon={ShieldAlert} title="Detail Pelanggan" /><p className="text-sm text-muted-foreground">Memuat...</p></div>

  if (!cust) {
    return (
      <div className="space-y-4">
        <Link href="/customers" className="text-sm text-muted-foreground flex items-center gap-1"><ArrowLeft className="w-3.5 h-3.5" />Kembali</Link>
        <EmptyState icon={ShieldAlert} title="Pelanggan tidak ditemukan" description={`Nomor ${phone} belum ada di database.`} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Link href="/customers" className="text-sm text-muted-foreground flex items-center gap-1 hover:text-foreground"><ArrowLeft className="w-3.5 h-3.5" />Kembali ke daftar</Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold font-mono">{cust.phone_raw_sample || cust.phone_normalized}</h1>
          <p className="text-sm text-muted-foreground">{cust.name_latest || '—'}</p>
          <div className="flex items-center gap-2 mt-1.5">
            <Badge variant="outline" className={CUSTOMER_RISK_TIER_COLOR[cust.risk_tier]}>{CUSTOMER_RISK_TIER_LABEL[cust.risk_tier]}</Badge>
            {cust.is_blacklisted && <Badge variant="outline" className="bg-red-500/15 text-red-700 dark:text-red-400"><Ban className="w-3 h-3 mr-1" />Blacklist</Badge>}
            {cust.is_vip && <Badge variant="outline" className="bg-amber-500/15 text-amber-700 dark:text-amber-400"><Crown className="w-3 h-3 mr-1" />VIP</Badge>}
          </div>
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={toggleVip} disabled={saving}>
              <Crown className="w-3.5 h-3.5 mr-1.5" />{cust.is_vip ? 'Lepas VIP' : 'Tandai VIP'}
            </Button>
            {cust.is_blacklisted ? (
              <Button variant="outline" size="sm" onClick={() => toggleBlacklist(false)} disabled={saving}>
                <Ban className="w-3.5 h-3.5 mr-1.5" />Lepas Blacklist
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setBlacklistOpen(true)} disabled={saving} className="text-red-600 border-red-300">
                <Ban className="w-3.5 h-3.5 mr-1.5" />Blacklist
              </Button>
            )}
          </div>
        )}
      </div>

      {cust.is_blacklisted && cust.blacklist_reason && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 p-2.5 text-xs text-red-700 dark:text-red-400">
          <span className="font-semibold">Alasan blacklist:</span> {cust.blacklist_reason}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total Order" value={String(cust.total_orders)} />
        <StatCard label="Delivery Rate" value={pct(cust.delivery_rate)} sub={`${cust.delivered_count} diterima`} />
        <StatCard label="Return Rate" value={pct(cust.return_rate)} sub={`${cust.returned_count} retur · ${cust.fake_count} fake`} danger={Number(cust.return_rate) >= 0.3} />
        <StatCard label="LTV Omset" value={formatRupiah(cust.ltv_omset)} sub={`Profit ${formatRupiah(cust.ltv_profit)}`} />
      </div>

      {/* Note */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Catatan</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} disabled={!canManage} placeholder="Catatan internal tentang pelanggan ini..." />
          {canManage && <Button size="sm" onClick={saveNote} disabled={saving}><Save className="w-3.5 h-3.5 mr-1.5" />Simpan Catatan</Button>}
        </CardContent>
      </Card>

      {/* Order history */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Riwayat Order ({orders.length})</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Order#</TableHead>
                  <TableHead>Resi</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead>CS</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">Belum ada order.</TableCell></TableRow>
                ) : orders.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="text-xs">{o.order_date ? formatDate(o.order_date) : '—'}</TableCell>
                    <TableCell className="text-xs font-mono">
                      <Link href={`/orders/${o.id}`} className="hover:underline">{o.order_number}</Link>
                    </TableCell>
                    <TableCell className="text-xs font-mono">{o.resi || '—'}</TableCell>
                    <TableCell className="text-right text-sm">{formatRupiah(o.total)}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={STATUS_BADGE_COLOR[o.status] || ''}>{STATUS_LABEL[o.status] || o.status}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">{o.cs_name || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Blacklist dialog */}
      <Dialog open={blacklistOpen} onOpenChange={setBlacklistOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Blacklist Nomor Ini</DialogTitle>
            <DialogDescription>
              Nomor {cust.phone_raw_sample || cust.phone_normalized} akan diblacklist. Saat input order pakai nomor ini, admin/CS harus override eksplisit.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Alasan (wajib)</label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="mis. 3x retur tanpa alasan, fake order, dll" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBlacklistOpen(false)} disabled={saving}>Batal</Button>
            <Button onClick={() => toggleBlacklist(true)} disabled={saving} className="bg-red-600 hover:bg-red-700 text-white">
              {saving && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}Blacklist
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function StatCard({ label, value, sub, danger }: { label: string; value: string; sub?: string; danger?: boolean }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-lg font-bold ${danger ? 'text-red-600' : ''}`}>{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  )
}
