'use client'
import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { UserPlus, Loader2, KeyRound, Trash2 } from 'lucide-react'
import { ROLE_LABELS, ROLE_COLORS } from '@/lib/constants'
import type { Profile, UserRole } from '@/lib/types'

const roles: UserRole[] = ['owner', 'admin', 'cs', 'advertiser', 'akunting']

export default function UsersPage() {
  const [users, setUsers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ email: '', password: '', full_name: '', role: 'admin' as UserRole })
  const [resetTarget, setResetTarget] = useState<Profile | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [resetting, setResetting] = useState(false)

  const loadUsers = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/users')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Gagal load users')
      setUsers(json.users || [])
    } catch (err: any) {
      toast.error('Gagal load users', { description: err.message })
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { loadUsers() }, [])

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.email || !form.full_name || !form.password) return toast.error('Semua field wajib diisi')
    if (form.password.length < 8) return toast.error('Password minimal 8 karakter')
    setSaving(true)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Gagal membuat user')
      toast.success('User berhasil dibuat!', { description: `${form.full_name} (${ROLE_LABELS[form.role]})` })
      setOpen(false); setForm({ email: '', password: '', full_name: '', role: 'admin' }); loadUsers()
    } catch (err: any) {
      toast.error('Gagal membuat user', { description: err.message })
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (user: Profile) => {
    if (user.active && !confirm(`Nonaktifkan ${user.full_name}? User tidak bisa login lagi.`)) return
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !user.active }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Gagal update')
      toast.success(user.active ? 'User dinonaktifkan' : 'User diaktifkan')
      loadUsers()
    } catch (err: any) {
      toast.error('Gagal', { description: err.message })
    }
  }

  const handleDelete = async (user: Profile) => {
    if (!confirm(`HAPUS PERMANEN ${user.full_name} (${user.email})? Akun akan hilang dari sistem dan tidak bisa dipulihkan.`)) return
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Gagal hapus')
      toast.success('User dihapus')
      loadUsers()
    } catch (err: any) {
      toast.error('Gagal hapus', { description: err.message })
    }
  }

  const changeRole = async (user: Profile, newRole: UserRole) => {
    if (newRole === user.role) return
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Gagal update role')
      toast.success(`Role diubah ke ${ROLE_LABELS[newRole]}`)
      loadUsers()
    } catch (err: any) {
      toast.error('Gagal ubah role', { description: err.message })
    }
  }

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!resetTarget) return
    if (newPassword.length < 8) return toast.error('Password minimal 8 karakter')
    setResetting(true)
    try {
      const res = await fetch(`/api/admin/users/${resetTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Gagal reset password')
      toast.success('Password direset', { description: `Beritahu ${resetTarget.full_name} password baru.` })
      setResetTarget(null); setNewPassword('')
    } catch (err: any) {
      toast.error('Gagal reset password', { description: err.message })
    } finally {
      setResetting(false)
    }
  }

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
              <div className="space-y-2"><Label>Role</Label><Select value={form.role} onValueChange={v => setForm({ ...form, role: v as UserRole })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent className="w-[200px]">{roles.map(r => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}</SelectContent></Select></div>
              <Button type="submit" className="w-full" disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Buat User</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Dibuat</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={6} className="py-3"><div className="h-4 bg-muted animate-pulse rounded w-full" /></TableCell></TableRow>
                ))
              ) : users.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">Belum ada user</TableCell></TableRow>
              ) : users.map(u => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.full_name}</TableCell>
                  <TableCell className="font-mono text-xs">{u.email || '-'}</TableCell>
                  <TableCell>
                    <Select value={u.role} onValueChange={v => v && changeRole(u, v as UserRole)}>
                      <SelectTrigger className="h-7 px-2"><Badge variant="outline" className={ROLE_COLORS[u.role]}>{ROLE_LABELS[u.role]}</Badge></SelectTrigger>
                      <SelectContent className="w-[180px]">{roles.map(r => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell><Badge variant="outline" className={u.active ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-600'}>{u.active ? 'Active' : 'Inactive'}</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{new Date(u.created_at).toLocaleDateString('id-ID')}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => toggleActive(u)}>{u.active ? 'Nonaktifkan' : 'Aktifkan'}</Button>
                      <Button variant="ghost" size="icon" title="Reset password" onClick={() => { setResetTarget(u); setNewPassword('') }}><KeyRound className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="icon" title="Hapus user" className="text-red-500" onClick={() => handleDelete(u)}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!resetTarget} onOpenChange={v => { if (!v) { setResetTarget(null); setNewPassword('') } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleResetPassword} className="space-y-4">
            <p className="text-sm text-muted-foreground">User: <strong>{resetTarget?.full_name}</strong> ({resetTarget?.email})</p>
            <div className="space-y-2">
              <Label>Password Baru *</Label>
              <Input type="text" value={newPassword} onChange={e => setNewPassword(e.target.value)} minLength={8} required placeholder="Minimal 8 karakter" autoFocus />
              <p className="text-xs text-muted-foreground">Catat password ini — kamu harus beritahu user secara manual.</p>
            </div>
            <Button type="submit" className="w-full" disabled={resetting}>{resetting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Reset Password</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
