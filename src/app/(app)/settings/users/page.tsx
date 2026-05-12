'use client'
import { Suspense, useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { UserPlus, Loader2, KeyRound, Trash2, Pencil, Wrench, AlertTriangle, Users, X } from 'lucide-react'
import { ROLE_LABELS, ROLE_COLORS } from '@/lib/constants'
import type { Profile, UserRole } from '@/lib/types'
import { useAuth } from '@/components/providers/auth-provider'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'

const roles: UserRole[] = ['owner', 'admin', 'cs', 'advertiser', 'akunting']

export default function UsersPage() {
  return (
    <Suspense fallback={<div className="text-sm text-muted-foreground">Loading...</div>}>
      <UsersPageInner />
    </Suspense>
  )
}

function UsersPageInner() {
  const { role, loading: authLoading } = useAuth()
  const searchParams = useSearchParams()
  const roleFilterRaw = searchParams.get('role')
  const roleFilter: UserRole | null = roleFilterRaw && (roles as string[]).includes(roleFilterRaw)
    ? (roleFilterRaw as UserRole)
    : null
  const [users, setUsers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [repairing, setRepairing] = useState(false)
  const [showSqlHelp, setShowSqlHelp] = useState(false)
  const [form, setForm] = useState({ email: '', password: '', full_name: '', role: 'admin' as UserRole })
  const [resetTarget, setResetTarget] = useState<Profile | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [resetting, setResetting] = useState(false)
  const [editTarget, setEditTarget] = useState<Profile | null>(null)
  const [editForm, setEditForm] = useState({ full_name: '', email: '', role: 'admin' as UserRole })
  const [editing, setEditing] = useState(false)

  const filteredUsers = useMemo(
    () => (roleFilter ? users.filter(u => u.role === roleFilter) : users),
    [users, roleFilter]
  )

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
      if (!res.ok) {
        // Detect the specific trigger crash and offer the auto-fix
        if (typeof json.error === 'string' && /database error|trigger|new user/i.test(json.error)) {
          setShowSqlHelp(true)
        }
        throw new Error(json.error || 'Gagal membuat user')
      }
      toast.success('User berhasil dibuat!', { description: `${form.full_name} (${ROLE_LABELS[form.role]})` })
      setOpen(false); setForm({ email: '', password: '', full_name: '', role: 'admin' }); loadUsers()
    } catch (err: any) {
      toast.error('Gagal membuat user', { description: err.message })
    } finally {
      setSaving(false)
    }
  }

  const handleAutoFix = async () => {
    setRepairing(true)
    try {
      const res = await fetch('/api/admin/repair', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) {
        if (json.hint) toast.error(json.error, { description: json.hint, duration: 15000 })
        else toast.error('Auto-fix gagal', { description: json.error })
        return
      }
      toast.success('Database diperbaiki!', { description: 'Coba tambah user lagi sekarang.' })
      setShowSqlHelp(false)
    } catch (err: any) {
      toast.error('Auto-fix gagal', { description: err.message })
    } finally {
      setRepairing(false)
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

  const openEdit = (u: Profile) => {
    setEditTarget(u)
    setEditForm({ full_name: u.full_name, email: u.email || '', role: u.role })
  }

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editTarget) return
    if (!editForm.full_name.trim()) return toast.error('Nama wajib diisi')
    if (!editForm.email.trim()) return toast.error('Email wajib diisi')
    setEditing(true)
    try {
      const payload: Record<string, unknown> = { full_name: editForm.full_name, role: editForm.role }
      if (editForm.email !== editTarget.email) payload.email = editForm.email
      const res = await fetch(`/api/admin/users/${editTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Gagal update')
      toast.success('User diupdate')
      setEditTarget(null); loadUsers()
    } catch (err: any) {
      toast.error('Gagal update', { description: err.message })
    } finally {
      setEditing(false)
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

  // Strict owner-only gate
  if (authLoading) {
    return <div className="text-sm text-muted-foreground">Memeriksa akses...</div>
  }
  if (role !== 'owner') {
    return (
      <Card className="max-w-md mx-auto mt-8">
        <CardContent className="pt-6 text-center space-y-2">
          <AlertTriangle className="w-10 h-10 text-yellow-500 mx-auto" />
          <h2 className="text-lg font-semibold">Akses Dibatasi</h2>
          <p className="text-sm text-muted-foreground">Hanya Owner yang dapat mengelola users. Hubungi Owner jika kamu butuh akses.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Users}
        title="Users & Roles"
        description={
          roleFilter
            ? `${filteredUsers.length} dari ${users.length} user (filter: ${ROLE_LABELS[roleFilter]})`
            : `${users.length} user terdaftar`
        }
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/20" />}><UserPlus className="w-4 h-4 mr-2" />Tambah User</DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Tambah User Baru</DialogTitle></DialogHeader>
            <form onSubmit={handleInvite} className="space-y-4">
              <div className="space-y-2"><Label>Nama Lengkap *</Label><Input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} required /></div>
              <div className="space-y-2"><Label>Email *</Label><Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required /></div>
              <div className="space-y-2"><Label>Password *</Label><Input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} minLength={8} required /></div>
              <div className="space-y-2"><Label>Role</Label><Select value={form.role} onValueChange={v => setForm({ ...form, role: v as UserRole })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent className="w-[200px]">{roles.map(r => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}</SelectContent></Select></div>
              <Button type="submit" className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/20" disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Buat User</Button>
            </form>
          </DialogContent>
        </Dialog>
        }
      />

      {roleFilter && (
        <div className="flex items-center gap-2 -mt-2">
          <span className="text-xs text-muted-foreground">Filter aktif:</span>
          <Badge variant="outline" className={ROLE_COLORS[roleFilter]}>
            {ROLE_LABELS[roleFilter]}
          </Badge>
          <Link
            href="/settings/users"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <X className="size-3" />
            Hapus filter
          </Link>
        </div>
      )}

      {showSqlHelp && (
        <Card className="border-yellow-500/40 bg-yellow-500/5">
          <CardContent className="pt-4 pb-4 space-y-3">
            <div className="flex items-start gap-3">
              <Wrench className="w-5 h-5 text-yellow-500 mt-0.5 shrink-0" />
              <div className="flex-1 space-y-2">
                <p className="font-semibold text-sm">Database error terdeteksi</p>
                <p className="text-sm text-muted-foreground">
                  Supabase project ini punya trigger SQL bawaan yang crash saat user baru dibuat.
                  Klik <strong>Auto-Fix</strong> di bawah untuk drop trigger-nya. Aman — kita sudah handle pembuatan profile sendiri di API.
                </p>
                <p className="text-xs text-muted-foreground">
                  <strong>Catatan:</strong> Auto-Fix butuh function <code className="px-1 py-0.5 rounded bg-zinc-800 text-yellow-300 font-mono">repair_user_creation()</code> yang sudah di-install.
                  Kalau belum, copy SQL dari file <code className="px-1 py-0.5 rounded bg-zinc-800 font-mono">migrations/003_install_repair_function.sql</code> ke Supabase SQL Editor dan Run.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleAutoFix} disabled={repairing} className="bg-yellow-600 hover:bg-yellow-700 text-white">
                {repairing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wrench className="w-4 h-4 mr-2" />}
                Auto-Fix Database
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowSqlHelp(false)}>Tutup</Button>
            </div>
          </CardContent>
        </Card>
      )}

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
              ) : filteredUsers.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="p-0"><EmptyState icon={Users} title={roleFilter ? `Tidak ada user dengan role ${ROLE_LABELS[roleFilter]}` : 'Belum ada user lain'} description={roleFilter ? 'Hapus filter atau tambah user dengan role ini.' : "Klik 'Tambah User' untuk mengundang teammate."} /></TableCell></TableRow>
              ) : filteredUsers.map(u => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.full_name}</TableCell>
                  <TableCell className="font-mono text-xs">{u.email || '-'}</TableCell>
                  <TableCell><Badge variant="outline" className={ROLE_COLORS[u.role]}>{ROLE_LABELS[u.role]}</Badge></TableCell>
                  <TableCell><Badge variant="outline" className={u.active ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-600'}>{u.active ? 'Active' : 'Inactive'}</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{new Date(u.created_at).toLocaleDateString('id-ID')}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" title="Edit user" onClick={() => openEdit(u)}><Pencil className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="icon" title="Reset password" onClick={() => { setResetTarget(u); setNewPassword('') }}><KeyRound className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="sm" onClick={() => toggleActive(u)}>{u.active ? 'Nonaktifkan' : 'Aktifkan'}</Button>
                      <Button variant="ghost" size="icon" title="Hapus user" className="text-red-500" onClick={() => handleDelete(u)}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!editTarget} onOpenChange={v => { if (!v) setEditTarget(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit User</DialogTitle></DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4">
            <div className="space-y-2"><Label>Nama Lengkap *</Label><Input value={editForm.full_name} onChange={e => setEditForm({ ...editForm, full_name: e.target.value })} required /></div>
            <div className="space-y-2"><Label>Email *</Label><Input type="email" value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })} required /><p className="text-xs text-muted-foreground">Mengubah email akan mengirim email konfirmasi ke alamat baru.</p></div>
            <div className="space-y-2"><Label>Role</Label><Select value={editForm.role} onValueChange={v => v && setEditForm({ ...editForm, role: v as UserRole })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent className="w-[200px]">{roles.map(r => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}</SelectContent></Select></div>
            <Button type="submit" className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/20" disabled={editing}>{editing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Simpan Perubahan</Button>
          </form>
        </DialogContent>
      </Dialog>

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
            <Button type="submit" className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/20" disabled={resetting}>{resetting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Reset Password</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
