'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/components/providers/auth-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Inbox, Search, Wrench, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { getErrorMessage } from '@/lib/errors'
import { inboxResiRequestSchema } from '@/lib/schemas/inbox-resi-request'
import { Choice, CreateOrderFields, initialCreateForm, sourceText, type References } from './_components/create-order-fields'

interface InboxRow {
  id: number; source_profile_id: number | null; raw_resi: string; raw_data: Record<string, unknown>
  resolved: boolean; resolution: 'linked' | 'ignored' | 'created_new' | null
  resolved_to_order_id: number | null; resolved_to_draft_id: number | null; resolved_order_number: string | null
  resolution_note: string | null; created_at: string; updated_at: string
}
interface OrderResult { source: 'draft' | 'final'; id: number; order_number: string; external_order_id: string | null; customer_name: string; resi: string | null; tracking_no: string | null; updated_at: string }
const endpoint = '/api/inbox/unmatched-resi'
const labels = { linked: 'Ditautkan', ignored: 'Diabaikan', created_new: 'Order dibuat' }
async function readResponse(response: Response) {
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.error ?? 'Permintaan belum berhasil. Coba lagi.')
  return data
}

export default function UnmatchedResiPage() {
  const { role } = useAuth()
  const allowed = role === 'owner' || role === 'admin'
  const [rows, setRows] = useState<InboxRow[]>([])
  const [refs, setRefs] = useState<References | null>(null)
  const [refError, setRefError] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [profileFilter, setProfileFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState('PENDING')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [count, setCount] = useState(0)
  const [reload, setReload] = useState(0)
  const [active, setActive] = useState<InboxRow | null>(null)
  const [action, setAction] = useState<'link' | 'create' | 'ignore'>('link')
  const [orderQuery, setOrderQuery] = useState('')
  const [orderResults, setOrderResults] = useState<OrderResult[]>([])
  const [orderSearching, setOrderSearching] = useState(false)
  const [picked, setPicked] = useState<OrderResult | null>(null)
  const [ignoreReason, setIgnoreReason] = useState('')
  const [createForm, setCreateForm] = useState(() => initialCreateForm({}))
  const [submitting, setSubmitting] = useState(false)
  const [resolveError, setResolveError] = useState('')
  const saving = useRef(false)
  const activeId = useRef<number | null>(null)
  const searchRequest = useRef<AbortController | null>(null)
  const receipt = useRef<{ payload: string; id: string } | null>(null)

  useEffect(() => {
    if (!allowed) return
    const controller = new AbortController()
    setRefError('')
    fetch(endpoint + '?mode=references', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) }).then(readResponse).then(data => {
      if (!controller.signal.aborted) setRefs(data)
    }).catch(error => { if (!controller.signal.aborted) setRefError(getErrorMessage(error)) })
    return () => controller.abort()
  }, [allowed, reload])
  useEffect(() => {
    if (!allowed) return
    const controller = new AbortController()
    setLoading(true); setLoadError('')
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ status: statusFilter, profile: profileFilter, q: search, page: String(page) })
        const data = await readResponse(await fetch(endpoint + '?' + params, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) }))
        if (!controller.signal.aborted) { setRows(data.rows); setCount(data.count) }
      } catch (error) { if (!controller.signal.aborted) setLoadError(getErrorMessage(error)) }
      finally { if (!controller.signal.aborted) setLoading(false) }
    }, 250)
    return () => { clearTimeout(timer); controller.abort() }
  }, [allowed, statusFilter, profileFilter, search, page, reload])
  useEffect(() => () => searchRequest.current?.abort(), [])

  const openResolve = (row: InboxRow) => {
    searchRequest.current?.abort(); activeId.current = row.id; receipt.current = null
    setActive(row); setAction('link'); setOrderQuery(row.raw_resi); setOrderResults([]); setOrderSearching(false)
    setPicked(null); setIgnoreReason(''); setResolveError(''); setCreateForm(initialCreateForm(row.raw_data ?? {}))
  }
  const close = () => {
    if (saving.current) return
    activeId.current = null; searchRequest.current?.abort(); setActive(null)
  }
  const searchOrders = async () => {
    const query = orderQuery.trim()
    if (query.length < 2) return
    searchRequest.current?.abort()
    const controller = new AbortController(); searchRequest.current = controller
    const inboxId = activeId.current
    setOrderSearching(true); setPicked(null); setOrderResults([]); setResolveError('')
    try {
      const data = await readResponse(await fetch(endpoint + '?' + new URLSearchParams({ mode: 'orders', q: query }), { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) }))
      if (!controller.signal.aborted && activeId.current === inboxId) {
        setOrderResults(data.rows)
        if (!data.rows.length) setResolveError('Tidak ada order yang cocok. Periksa nomor referensi sebelum membuat order baru.')
      }
    } catch (error) { if (!controller.signal.aborted) setResolveError(getErrorMessage(error)) }
    finally { if (!controller.signal.aborted) setOrderSearching(false) }
  }
  const submitResolve = async () => {
    if (!active || saving.current) return
    const payload = action === 'create' ? createForm : action === 'ignore' ? { reason: ignoreReason }
      : picked ? { source: picked.source, orderId: picked.id, updatedAt: picked.updated_at } : null
    const serialized = JSON.stringify({ action, payload, inboxId: active.id, updatedAt: active.updated_at })
    if (receipt.current?.payload !== serialized) receipt.current = { payload: serialized, id: crypto.randomUUID() }
    const request = { inboxId: active.id, updatedAt: active.updated_at, requestId: receipt.current.id, action, payload }
    if (!inboxResiRequestSchema.safeParse(request).success) {
      setResolveError(action === 'link' ? 'Cari dan pilih order tujuan.' : action === 'ignore' ? 'Isi alasan pengabaian.' : 'Lengkapi nama, alamat, tanggal, ekspedisi, pembayaran dan produk. Periksa telepon, jumlah serta harga.'); return
    }
    saving.current = true; setSubmitting(true); setResolveError('')
    try {
      const data = await readResponse(await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(25000) }))
      toast.success(data.resolution === 'ignored' ? 'Resi diabaikan; alasan tersimpan.' : `${data.orderNumber} ${data.resolution === 'created_new' ? 'dibuat beserta itemnya di Antrian.' : 'ditautkan ke inbox.'}`)
      activeId.current = null; setActive(null); setReload(n => n + 1)
    } catch (error) {
      const interrupted = error instanceof Error && ['TypeError', 'TimeoutError', 'AbortError'].includes(error.name)
      setResolveError(interrupted ? 'Penyimpanan belum dikonfirmasi. Coba lagi dengan data yang sama; permintaan tidak akan digandakan.' : getErrorMessage(error))
    }
    finally { saving.current = false; setSubmitting(false) }
  }

  if (role && !allowed) return <p role="alert">Halaman ini hanya untuk owner dan admin.</p>
  return <div className="space-y-6">
    <PageHeader icon={Inbox} title="Resi Nyangkut" description="Periksa resi yang belum cocok. Tautkan ke order yang ada, lengkapi order baru, atau abaikan dengan alasan." />
    {(refError || loadError) && <div role="alert" className="rounded-md border border-destructive p-3 text-sm">{loadError || refError} <Button variant="outline" size="sm" onClick={() => setReload(n => n + 1)}>Muat ulang</Button></div>}
    <Card><CardContent className="flex flex-wrap gap-3 py-4">
      <Input className="min-w-48 flex-1" aria-label="Cari resi inbox" placeholder="Cari resi..." maxLength={200} value={search} onChange={e => { setSearch(e.target.value); setPage(0) }} />
      <Choice className="sm:w-44" aria-label="Status inbox" value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(0) }}><option value="PENDING">Belum diselesaikan</option><option value="RESOLVED">Sudah diselesaikan</option><option value="ALL">Semua status</option></Choice>
      <Choice className="sm:w-52" aria-label="Sumber inbox" value={profileFilter} onChange={e => { setProfileFilter(e.target.value); setPage(0) }}><option value="ALL">Semua sumber</option>{refs?.profiles.map(p => <option key={p.id} value={p.id}>{p.code}</option>)}</Choice>
    </CardContent></Card>
    <Card><CardContent className="p-0"><Table>
      <TableHeader><TableRow>{['Dibuat', 'Sumber', 'Resi', 'Penerima', 'Penyelesaian', 'Order terkait', 'Aksi'].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{loading ? <TableRow><TableCell colSpan={7}><Loader2 className="mx-auto my-6 animate-spin" aria-label="Memuat inbox" /></TableCell></TableRow>
        : loadError ? <TableRow><TableCell colSpan={7}>Data belum berhasil dimuat.</TableCell></TableRow>
          : !rows.length ? <TableRow><TableCell colSpan={7}><EmptyState icon={Inbox} title="Tidak ada resi pada filter ini" description="Resi yang belum cocok akan muncul setelah rekonsil ekspedisi." /></TableCell></TableRow>
            : rows.map(row => <TableRow key={row.id}>
              <TableCell className="text-xs whitespace-nowrap">{new Date(row.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</TableCell>
              <TableCell className="text-xs">{refs?.profiles.find(p => p.id === row.source_profile_id)?.code ?? '—'}</TableCell>
              <TableCell className="font-mono text-xs"><span className="block max-w-56 whitespace-normal break-all">{row.raw_resi}</span></TableCell>
              <TableCell className="max-w-40 truncate text-xs">{sourceText(row.raw_data ?? {}, 'customer_name', 'receiver_name', 'recipient_name', 'Nama Penerima') || '—'}</TableCell>
              <TableCell><Badge variant="outline">{!row.resolved ? 'Belum' : row.resolution === 'created_new' && !row.resolved_to_order_id && !row.resolved_to_draft_id ? 'Perlu diperiksa' : row.resolution ? labels[row.resolution] : 'Selesai'}</Badge>{row.resolution_note && <p className="mt-1 max-w-60 whitespace-pre-wrap break-words text-xs text-muted-foreground">{row.resolution_note}</p>}</TableCell>
              <TableCell className="text-xs">{row.resolved_order_number ? <Link className="underline" href={row.resolved_to_order_id ? `/orders/${row.resolved_to_order_id}` : `/orders/draft?search=${encodeURIComponent(row.resolved_order_number)}`}>{row.resolved_order_number}{row.resolved_to_draft_id ? ' · Antrian' : ''}</Link> : '—'}</TableCell>
              <TableCell>{!row.resolved && <Button variant="outline" size="sm" disabled={!refs || !!refError} onClick={() => openResolve(row)}><Wrench className="mr-1 h-3.5 w-3.5" />Resolve</Button>}</TableCell>
            </TableRow>)}</TableBody>
    </Table></CardContent></Card>
    <div className="flex items-center justify-between gap-3 text-sm"><span>{count} resi sesuai filter · Halaman {page + 1}</span><div className="flex gap-2"><Button variant="outline" disabled={loading || page === 0} onClick={() => setPage(p => p - 1)}>Sebelumnya</Button><Button variant="outline" disabled={loading || (page + 1) * 100 >= count} onClick={() => setPage(p => p + 1)}>Berikutnya</Button></div></div>
    <Dialog open={!!active} onOpenChange={open => { if (!open) close() }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>Resolve Resi “{active?.raw_resi}”</DialogTitle></DialogHeader>
      {active && refs && <div className="space-y-4">
        <details><summary className="cursor-pointer text-sm">Lihat data sumber</summary><pre className="mt-2 max-h-48 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(active.raw_data, null, 2)}</pre></details>
        <fieldset disabled={submitting} className="space-y-4">
          <div className="space-y-2">{([['link', 'Link ke order yang sudah ada'], ['create', 'Buat order baru beserta item'], ['ignore', 'Abaikan resi ini']] as const).map(([value, label]) => <label key={value} className="flex items-center gap-2 text-sm"><input type="radio" name="resolution" checked={action === value} onChange={() => { setAction(value); setResolveError('') }} />{label}</label>)}</div>
          {action === 'link' && <div className="space-y-3 border-t pt-3"><Label htmlFor="inbox-order-search">Cari di Antrian dan arsip order</Label><div className="flex gap-2"><Input id="inbox-order-search" value={orderQuery} maxLength={200} placeholder="Nomor order, referensi, resi, atau nama" onChange={e => { searchRequest.current?.abort(); setOrderQuery(e.target.value); setPicked(null); setOrderResults([]); setOrderSearching(false) }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); searchOrders() } }} /><Button type="button" variant="outline" disabled={orderSearching || orderQuery.trim().length < 2} onClick={searchOrders} aria-label="Cari order">{orderSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}</Button></div><div className="max-h-56 overflow-auto">{orderResults.map(order => <button key={order.source + order.id} type="button" aria-pressed={picked?.source === order.source && picked.id === order.id} onClick={() => setPicked(order)} className={`mb-1 w-full rounded border p-2 text-left text-sm ${picked?.source === order.source && picked.id === order.id ? 'border-primary bg-muted' : ''}`}><strong>{order.order_number}</strong> · {order.source === 'draft' ? 'Antrian' : 'Arsip'}<p className="text-xs text-muted-foreground">{order.customer_name} · {order.resi || order.tracking_no || 'Belum ada resi'}</p></button>)}</div><p className="text-xs text-muted-foreground">Resi yang sudah terisi berbeda akan ditolak. Nilai keuangan dan status order tetap perlu rekonsil.</p></div>}
          {action === 'create' && <CreateOrderFields value={createForm} onChange={setCreateForm} refs={refs} />}
          {action === 'ignore' && <div className="space-y-2"><Label htmlFor="inbox-ignore-reason">Alasan pengabaian *</Label><Textarea id="inbox-ignore-reason" maxLength={2000} value={ignoreReason} onChange={e => setIgnoreReason(e.target.value)} placeholder="Alasan ini disimpan bersama penyelesaian inbox." /></div>}
        </fieldset>
        {resolveError && <p role="alert" className="text-sm text-destructive">{resolveError}</p>}
        <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" disabled={submitting} onClick={close}>Batal</Button><Button disabled={submitting || (action === 'link' && !picked)} onClick={submitResolve}>{submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{action === 'create' ? 'Buat order & selesaikan inbox' : 'Konfirmasi'}</Button></div>
      </div>}
    </DialogContent></Dialog>
  </div>
}
