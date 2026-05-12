import { redirect } from 'next/navigation'

// Daftar Advertiser legacy path → /settings/users dengan filter role=advertiser.
// Data ADV sudah lengkap di Users & Roles (owner-only). Sidebar item Daftar
// Advertiser sudah dihapus; redirect ini cuma untuk bookmark lama.
export default function AdvertisersListLegacyRedirect() {
  redirect('/settings/users?role=advertiser')
}
