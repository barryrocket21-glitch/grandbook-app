'use client'

import { useState } from 'react'
import { getErrorMessage } from '@/lib/errors'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { BookOpen, Loader2, Mail, Lock } from 'lucide-react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'

const supabase = createClient()

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const { data: signInData, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) {
        toast.error('Login gagal', { description: error.message })
        return
      }

      // Phase 8H — role-aware default landing. CS + Admin landing ke
      // Antrian Kerja supaya langsung lihat draft yang perlu di-print resi
      // (bukan ke Arsip yang isinya 1067 order historic).
      let landing = '/dashboard'
      if (signInData.user) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', signInData.user.id)
          .maybeSingle()
        switch (prof?.role) {
          case 'cs':
          case 'admin':
            landing = '/orders/draft'
            break
          case 'advertiser':
            landing = '/adv-dashboard'
            break
          case 'akunting':
            landing = '/reconciliation/spx'
            break
          case 'owner':
          default:
            landing = '/dashboard'
        }
      }

      toast.success('Login berhasil!')
      router.push(landing)
      router.refresh()
    } catch (err: unknown) {
      toast.error('Terjadi kesalahan', {
        description: getErrorMessage(err),
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        {/* Wordmark */}
        <div className="flex flex-col items-center mb-10">
          <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-foreground text-background mb-4">
            <BookOpen className="w-5 h-5" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">GrandBook</h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            Sistem pembukuan bisnis online
          </p>
        </div>

        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="nama@perusahaan.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-9"
                  required
                  autoComplete="email"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-9"
                  required
                  autoComplete="current-password"
                />
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Masuk
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          © 2026 GrandBook · Hubungi owner untuk dapat akun
        </p>
      </div>
    </div>
  )
}
