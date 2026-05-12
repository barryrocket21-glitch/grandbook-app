import { redirect } from 'next/navigation'

// Daftar CS legacy path → /settings/users dengan filter role=cs.
// Data CS sudah lengkap di Users & Roles (owner-only). Sidebar item Daftar
// CS sudah dihapus; redirect ini cuma untuk bookmark lama.
export default function CsListLegacyRedirect() {
  redirect('/settings/users?role=cs')
}
