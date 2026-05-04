'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { UserPlus, Loader2 } from 'lucide-react'
import { ROLE_LABELS, ROLE_COLORS } from '@/lib/constants'
import type { Profile, UserRole } from '@/lib/types'

export default function UsersPage() {
  const supabase = createClient()
  const [users, setUsers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ email: '', password: '', full_name: '', role: 'admin' as UserRole })

  const fetch = async () => {
    setLoading(true)
    const { data } = await supabase.from('profiles').select('*').order('created_at')
    setUsers(data || [])
    setLoading(false)
  }
  useEffect(() => { fetch() }, [])

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.email || !form.full_name || !form.password) return toast.error('Semua field wajib diisi')
    setSaving(true)
    try {
      const { error } = await supabase.auth.signUp({
        email: form.email, password: form.password,
        options: { data: { full_name: form.full_name, role: form.role } },
      })
      if (error) throw error
      toast.success('User berhasil dibuat!', { description: `${form.full_name} (${ROLE_LABELS[form.role]})` })
      setOpen(false); setForm({ email: '', password: '', full_name: '', role: 'admin' }); fetch()
    } catch (err: any) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  const toggleActive = async (user: Profile) => {
    const { error } = await supabase.from('profiles').update({ active: !user.active }).eq('id', user.id)
    if (error) { toast.error(error.message); return }
    toast.success(user.active ? 'User dinonaktifkan' : 'User diaktifkan')
    fetch()
  }

  const roles: UserRole[] = ['owner', 'admin', 'cs', 'advertiser', 'akunting']

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-transparent">Users & Roles</h1>
          <p className="text-muted-foreground mt-1">{users.length} user terdaftar</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white" />}><UserPlus className="w-4 h-4 mr-2" />Tambah User</DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Tambah User Baru</DialogTitle></DialogHeader>
            <form onSubmit={handleInvite} className="space-y-4">
              <div className="space-y-2"><Label>Nama Lengkap *</Label><Input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} required /></div>
              <div className="space-y-2"><Label>Email *</Label><Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required /></div>
              <div className="space-y-2"><Label>Password *</Label><Input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} minLength={8} required /></div>
              <div className="space-y-2"><Label>Role</Label><Select value={form.role} onValueChange={v => setForm({ ...form, role: v as UserRole })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{roles.map(r => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}</SelectContent></Select></div>
              <Button type="submit" className="w-full" disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Buat User</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Nama</TableHead><TableHead>Role</TableHead><TableHead>Status</TableHead><TableHead>Dibuat</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {users.map(u => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.full_name}</TableCell>
                  <TableCell><Badge variant="outline" className={ROLE_COLORS[u.role]}>{ROLE_LABELS[u.role]}</Badge></TableCell>
                  <TableCell><Badge variant="outline" className={u.active ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-600'}>{u.active ? 'Active' : 'Inactive'}</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{new Date(u.created_at).toLocaleDateString('id-ID')}</TableCell>
                  <TableCell><Button variant="ghost" size="sm" onClick={() => toggleActive(u)}>{u.active ? 'Nonaktifkan' : 'Aktifkan'}</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
