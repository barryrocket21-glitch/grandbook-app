'use client'
import type { ReactNode } from 'react'
import type { UserRole } from '@/lib/types'

interface Props {
  role: UserRole | null | undefined
  allowedRoles: UserRole[]
  children: ReactNode
  fallback?: ReactNode
}

/**
 * Hide children kalau role bukan di allowedRoles.
 * Pakai untuk hide tombol Tambah/Edit/Hapus dari role yang gak punya
 * permission. RLS di server tetap enforce — ini cuma UX.
 */
export function PermissionGuard({ role, allowedRoles, children, fallback = null }: Props) {
  if (!role || !allowedRoles.includes(role)) return <>{fallback}</>
  return <>{children}</>
}
