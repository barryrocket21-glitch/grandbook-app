'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BookOpen, Loader2, Mail, Lock, Sparkles } from 'lucide-react'
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
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) {
        toast.error('Login gagal', { description: error.message })
        return
      }

      toast.success('Login berhasil!')
      router.push('/dashboard')
      router.refresh()
    } catch (err: any) {
      toast.error('Terjadi kesalahan', { description: err?.message })
    } finally {
      setLoading(false)
    }
  }

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) {
      toast.error('Masukkan email terlebih dahulu')
      return
    }
    setLoading(true)

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      })

      if (error) {
        toast.error('Gagal mengirim magic link', { description: error.message })
        return
      }

      toast.success('Magic link terkirim!', {
        description: 'Cek email kamu untuk login.',
      })
    } catch (err: any) {
      toast.error('Terjadi kesalahan', { description: err?.message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-950 via-violet-950/20 to-zinc-950 p-4">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-violet-600/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl animate-pulse delay-1000" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-violet-600/5 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-md relative z-10">
        {/* Logo & Title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-violet-600 to-indigo-600 rounded-2xl shadow-lg shadow-violet-500/25 mb-4">
            <BookOpen className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-400 to-indigo-400 bg-clip-text text-transparent">
            GrandBook
          </h1>
          <p className="text-muted-foreground mt-1">Sistem Pembukuan Bisnis Online</p>
        </div>

        <Card className="border-white/10 bg-zinc-900/80 backdrop-blur-xl shadow-2xl shadow-violet-500/10">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-xl text-white">Masuk ke Akun</CardTitle>
            <CardDescription>
              Login untuk mengakses dashboard
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="password" className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-4">
                <TabsTrigger value="password">
                  <Lock className="w-4 h-4 mr-2" />
                  Password
                </TabsTrigger>
                <TabsTrigger value="magic-link">
                  <Sparkles className="w-4 h-4 mr-2" />
                  Magic Link
                </TabsTrigger>
              </TabsList>

              <TabsContent value="password">
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email-password">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="email-password"
                        type="email"
                        placeholder="nama@perusahaan.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="pl-10 bg-zinc-800/50 border-white/10 focus:border-violet-500/50"
                        required
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
                        className="pl-10 bg-zinc-800/50 border-white/10 focus:border-violet-500/50"
                        required
                      />
                    </div>
                  </div>
                  <Button
                    type="submit"
                    className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/25 transition-all duration-300"
                    disabled={loading}
                  >
                    {loading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    Masuk
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="magic-link">
                <form onSubmit={handleMagicLink} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email-magic">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="email-magic"
                        type="email"
                        placeholder="nama@perusahaan.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="pl-10 bg-zinc-800/50 border-white/10 focus:border-violet-500/50"
                        required
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Kami akan mengirim link login ke email kamu. Tidak perlu password.
                  </p>
                  <Button
                    type="submit"
                    className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/25 transition-all duration-300"
                    disabled={loading}
                  >
                    {loading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    Kirim Magic Link
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-6">
          © 2026 GrandBook. Hubungi Owner untuk mendapatkan akun.
        </p>
      </div>
    </div>
  )
}
