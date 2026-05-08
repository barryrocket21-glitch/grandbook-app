import { redirect } from 'next/navigation'
// Default landing for /settings → Couriers (Phase 2A entry).
// Owner-specific tools (users, commission-rules, reset-data) tetap accessible
// langsung via path masing-masing dan dari sidebar.
export default function SettingsPage() { redirect('/settings/couriers') }
