'use client'
// =============================================================
// Brief #2 — /crm/[order_id] : detail kasus + timeline + follow-up + resolve.
// =============================================================
import { useCallback, useEffect, useState } from 'react'
import { getErrorMessage } from '@/lib/errors'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { ArrowLeft, MessageCircle, Loader2, Send, ShieldAlert, CheckCircle2, AlertOctagon } from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState } from '@/components/ui/empty-state'
import { formatDate } from '@/lib/format'
import { crmActivitySchema, CRM_ACTIVITY_CHANNELS } from '@/lib/schemas/crm'
import { listCrmActivities, resolveCrmCase, buildWaLink, DEFAULT_WA_TEMPLATES } from '@/lib/supabase/queries/crm'
import {
  CRM_PROBLEM_TYPE_LABEL, CRM_PROBLEM_TYPE_COLOR, CRM_STATUS_LABEL, CRM_STATUS_COLOR, CRM_RESOLVE_OUTCOMES,
  type CrmActivity, type CrmProblemType, type CrmResolveOutcome,
} from '@/lib/types'

const supabase = createClient()

interface CaseOrder {
  id: number; order_number: string; customer_name: string | null; customer_phone: string | null
  status: string; problem_type: CrmProblemType | null; crm_status: string | null
  reject_reason: string | null; cs_id: string | null; cs_name: string | null
  assigned_to: string | null; sla_due_at: string | null; problem_opened_at: string | null
  last_contact_at: string | null; cs_attempts: number | null; resi: string | null; total: number
}

export default function CrmDetailPage() {
  const params = useParams<{ order_id: string }>()
  const orderId = Number(params.order_id)
  const router = useRouter()
  const { user, role } = useAuth()

  const [order, setOrder] = useState<CaseOrder | null>(null)
  const [activities, setActivities] = useState<CrmActivity[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // add-activity form
  const [channel, setChannel] = useState<'WA' | 'TELEPON' | 'EKSPEDISI' | 'LAIN'>('WA')
  const [result, setResult] = useState('')
  const [note, setNote] = useState('')
  const [nextAction, setNextAction] = useState('')

  const [resolveOpen, setResolveOpen] = useState(false)
  const [outcome, setOutcome] = useState<CrmResolveOutcome>('DITERIMA')

  const isOwnerAdmin = role === 'owner' || role === 'admin'
  const canAct = isOwnerAdmin || (!!order && order.cs_id === user?.id && order.problem_type === 'PEMBELI')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await supabase.from('orders')
        .select('id, order_number, customer_name, customer_phone, status, problem_type, crm_status, reject_reason, cs_id, cs_name, assigned_to, sla_due_at, problem_opened_at, last_contact_at, cs_attempts, resi, total')
        .eq('id', orderId).maybeSingle()
      setOrder((data as CaseOrder) || null)
      if (data) setActivities(await listCrmActivities(supabase, orderId))
    } catch {
      setOrder(null)
    } finally {
      setLoading(false)
    }
  }, [orderId])

  useEffect(() => { load() }, [load])

  const addActivity = async () => {
    const parsed = crmActivitySchema.safeParse({
      orderId, channel, result: result.trim() || null, note: note.trim() || null, nextAction: nextAction.trim() || null,
    })
    if (!parsed.success) { toast.error(parsed.error.issues[0]?.message ?? 'Validasi gagal'); return }
    setSaving(true)
    try {
      const { error } = await supabase.from('crm_activities').insert({
        organization_id: 1, order_id: orderId, channel,
        result: result.trim() || null, note: note.trim() || null, next_action: nextAction.trim() || null,
        created_by: user?.id ?? null,
      })
      if (error) throw error
      toast.success('Aktivitas dicatat')
      setResult(''); setNote(''); setNextAction('')
      await load()
    } catch (err) {
      toast.error('Gagal catat aktivitas', { description: getErrorMessage(err) })
    } finally { setSaving(false) }
  }

  const setProblemType = async (pt: CrmProblemType) => {
    if (!order) return
    setSaving(true)
    try {
      const { error } = await supabase.from('orders').update({ problem_type: pt }).eq('id', orderId)
      if (error) throw error
      toast.success(`Tipe diubah ke ${CRM_PROBLEM_TYPE_LABEL[pt]}`)
      await load()
    } catch (err) {
      toast.error('Gagal ubah tipe', { description: getErrorMessage(err) })
    } finally { setSaving(false) }
  }

  const escalate = async () => {
    if (!order) return
    setSaving(true)
    try {
      const { error } = await supabase.from('orders').update({ crm_status: 'ESCALATED' }).eq('id', orderId)
      if (error) throw error
      // notif ke owner/admin (best-effort)
      try {
        const { data: admins } = await supabase.from('profiles').select('id').in('role', ['owner', 'admin'])
        if (admins?.length) {
          await supabase.from('notifications').insert(admins.map((a: { id: string }) => ({
            organization_id: 1, recipient_id: a.id, type: 'crm_escalated',
            title: 'Kasus CRM di-eskalasi', body: `Order ${order.order_number} butuh perhatian.`, link: `/crm/${orderId}`,
          })))
        }
      } catch { /* notif best-effort */ }
      toast.success('Kasus di-eskalasi ke admin/owner')
      await load()
    } catch (err) {
      toast.error('Gagal eskalasi', { description: getErrorMessage(err) })
    } finally { setSaving(false) }
  }

  const doResolve = async () => {
    setSaving(true)
    try {
      await resolveCrmCase(supabase, orderId, outcome, note.trim() || null)
      toast.success(`Kasus selesai → ${outcome}`)
      router.push('/crm')
    } catch (err) {
      toast.error('Gagal resolve', { description: getErrorMessage(err) })
    } finally { setSaving(false); setResolveOpen(false) }
  }

  if (loading) return <div className="p-4 text-sm text-muted-foreground">Memuat...</div>
  if (!order) return (
    <div className="space-y-4">
      <Link href="/crm" className="text-sm text-muted-foreground flex items-center gap-1"><ArrowLeft className="w-3.5 h-3.5" />Kembali</Link>
      <EmptyState icon={ShieldAlert} title="Kasus tidak ditemukan" description="Order ini tidak ada atau bukan kasus PROBLEM." />
    </div>
  )

  const overdue = order.sla_due_at && new Date(order.sla_due_at) < new Date() && order.crm_status !== 'RESOLVED'
  const wa = buildWaLink(order.customer_phone, DEFAULT_WA_TEMPLATES[order.problem_type ?? 'PEMBELI'],
    { nama: order.customer_name, order_number: order.order_number, resi: order.resi })

  return (
    <div className="space-y-4 max-w-3xl">
      <Link href="/crm" className="text-sm text-muted-foreground flex items-center gap-1 hover:text-foreground"><ArrowLeft className="w-3.5 h-3.5" />Kembali ke antrian</Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold font-mono">{order.order_number}</h1>
          <p className="text-sm text-muted-foreground">{order.customer_name} · {order.customer_phone}</p>
          <div className="flex items-center gap-2 mt-1.5">
            {order.problem_type && <Badge variant="outline" className={CRM_PROBLEM_TYPE_COLOR[order.problem_type]}>{CRM_PROBLEM_TYPE_LABEL[order.problem_type]}</Badge>}
            {order.crm_status && <Badge variant="outline" className={CRM_STATUS_COLOR[order.crm_status as keyof typeof CRM_STATUS_COLOR]}>{CRM_STATUS_LABEL[order.crm_status as keyof typeof CRM_STATUS_LABEL]}</Badge>}
            {overdue && <Badge variant="outline" className="bg-red-500/15 text-red-700 dark:text-red-400">Overdue</Badge>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {wa && <a href={wa} target="_blank" rel="noopener noreferrer">
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white"><MessageCircle className="w-3.5 h-3.5 mr-1.5" />WhatsApp</Button>
          </a>}
        </div>
      </div>

      <Card>
        <CardContent className="pt-4 pb-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div><p className="text-xs text-muted-foreground">Masalah</p><p>{order.reject_reason || '—'}</p></div>
          <div><p className="text-xs text-muted-foreground">CS asal</p><p>{order.cs_name || '—'}</p></div>
          <div><p className="text-xs text-muted-foreground">Attempt</p><p>{order.cs_attempts ?? 0}×</p></div>
          <div><p className="text-xs text-muted-foreground">Kontak terakhir</p><p>{order.last_contact_at ? formatDate(order.last_contact_at) : '—'}</p></div>
        </CardContent>
      </Card>

      {/* Actions */}
      {canAct ? (
        <Card>
          <CardContent className="pt-4 pb-4 flex flex-wrap items-center gap-2">
            {isOwnerAdmin && (
              <Select value={order.problem_type ?? undefined} onValueChange={(v) => v && setProblemType(v as CrmProblemType)}>
                <SelectTrigger className="w-40"><SelectValue placeholder="Tipe masalah">
                  {(v: string | null) => v ? CRM_PROBLEM_TYPE_LABEL[v as CrmProblemType] : 'Tipe masalah'}
                </SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PEMBELI">Pembeli</SelectItem>
                  <SelectItem value="EKSPEDISI">Ekspedisi</SelectItem>
                </SelectContent>
              </Select>
            )}
            <Button variant="outline" size="sm" onClick={escalate} disabled={saving} className="text-red-600 border-red-300">
              <AlertOctagon className="w-3.5 h-3.5 mr-1.5" />Eskalasi
            </Button>
            <Button size="sm" onClick={() => setResolveOpen(true)} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />Resolve
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="text-xs p-2.5 rounded border bg-muted/30 text-muted-foreground">
          Kasus EKSPEDISI — read-only buat lu. Admin yang handle koordinasi ekspedisi.
        </div>
      )}

      {/* Add activity */}
      {canAct && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Catat Follow-Up</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Select value={channel} onValueChange={(v) => v && setChannel(v as typeof channel)}>
                <SelectTrigger className="w-40"><SelectValue>
                  {(v: string | null) => CRM_ACTIVITY_CHANNELS.find(c => c.value === v)?.label ?? 'Channel'}
                </SelectValue></SelectTrigger>
                <SelectContent>
                  {CRM_ACTIVITY_CHANNELS.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input value={result} onChange={(e) => setResult(e.target.value)} placeholder="Hasil (mis. tidak respon / setuju reschedule)" className="flex-1 min-w-[200px]" />
            </div>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Catatan detail..." />
            <div className="flex flex-wrap items-center gap-2">
              <Input value={nextAction} onChange={(e) => setNextAction(e.target.value)} placeholder="Next action (opsional)" className="flex-1 min-w-[200px]" />
              <Button size="sm" onClick={addActivity} disabled={saving}>
                {saving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1.5" />}Catat
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Timeline */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Timeline Aktivitas ({activities.length})</CardTitle></CardHeader>
        <CardContent>
          {activities.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Belum ada aktivitas follow-up.</p>
          ) : (
            <div className="space-y-3">
              {activities.map((a) => (
                <div key={a.id} className="flex gap-3 text-sm border-l-2 border-violet-500/30 pl-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">{CRM_ACTIVITY_CHANNELS.find(c => c.value === a.channel)?.label ?? a.channel}</Badge>
                      {a.result && <span className="text-xs font-medium">{a.result}</span>}
                      <span className="text-[11px] text-muted-foreground ml-auto">{formatDate(a.created_at)}</span>
                    </div>
                    {a.note && <p className="text-xs text-muted-foreground mt-1">{a.note}</p>}
                    {a.next_action && <p className="text-[11px] text-blue-600 mt-0.5">→ {a.next_action}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Resolve dialog */}
      <Dialog open={resolveOpen} onOpenChange={setResolveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve Kasus</DialogTitle>
            <DialogDescription>Pilih hasil akhir. Order bakal pindah ke status yang sesuai + kasus ditutup.</DialogDescription>
          </DialogHeader>
          <Select value={outcome} onValueChange={(v) => v && setOutcome(v as CrmResolveOutcome)}>
            <SelectTrigger><SelectValue>
              {(v: string | null) => CRM_RESOLVE_OUTCOMES.find(o => o.value === v)?.label ?? 'Pilih outcome'}
            </SelectValue></SelectTrigger>
            <SelectContent>
              {CRM_RESOLVE_OUTCOMES.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveOpen(false)} disabled={saving}>Batal</Button>
            <Button onClick={doResolve} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              {saving && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}Resolve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
