'use client'
import { Users } from 'lucide-react'
import { PersonalDashboard } from '@/components/analytics/personal-dashboard'

export default function CsDashboardPage() {
  return (
    <PersonalDashboard
      role="cs"
      icon={Users}
      pageTitle="Performance CS — Saya"
      pageDescription="Order yang Anda handle sebagai CS + komisi yang sudah/akan diterima. Owner bisa pilih CS lain via dropdown."
      emptyHintForOwner="Pilih CS dari dropdown atas untuk lihat performance individual"
    />
  )
}
