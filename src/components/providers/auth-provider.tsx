'use client'

import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef, type ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'
import { type Profile, type UserRole } from '@/lib/types'
import type { User } from '@supabase/supabase-js'

interface AuthContextType {
  user: User | null
  profile: Profile | null
  role: UserRole | null
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  role: null,
  loading: true,
  signOut: async () => {},
})

const supabase = createClient()

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const lastUserIdRef = useRef<string | null>(null)

  useEffect(() => {
    let mounted = true

    const fetchProfile = async (userId: string) => {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()
      if (mounted) setProfile(data)
    }

    // Get initial session synchronously then fetch profile async
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return
      const u = session?.user ?? null
      setUser(u)
      lastUserIdRef.current = u?.id ?? null
      if (u) fetchProfile(u.id).finally(() => mounted && setLoading(false))
      else setLoading(false)
    })

    // CRITICAL: callback must NOT be async (Supabase deadlock warning)
    // Defer async work via setTimeout to avoid blocking auth state machine
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const u = session?.user ?? null
      const newId = u?.id ?? null

      // Skip if same user (prevents re-fetch on TOKEN_REFRESHED)
      if (newId === lastUserIdRef.current && event !== 'SIGNED_OUT') return

      lastUserIdRef.current = newId
      setUser(u)

      if (u) {
        setTimeout(() => { if (mounted) fetchProfile(u.id) }, 0)
      } else {
        setProfile(null)
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }, [])

  const value = useMemo(() => ({
    user,
    profile,
    role: profile?.role ?? null,
    loading,
    signOut,
  }), [user, profile, loading, signOut])

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
