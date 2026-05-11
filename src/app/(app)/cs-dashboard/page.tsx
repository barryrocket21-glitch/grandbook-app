'use client'
import { Users } from 'lucide-react'
import { PersonalDashboard } from '@/components/analytics/personal-dashboard'
import { CsLeadSection } from '@/components/analytics/cs-lead-section'

export default function CsDashboardPage() {
  return (
    <PersonalDashboard
      role="cs"
      icon={Users}
      pageTitle="Performance CS — Saya"
      pageDescription="Lead masuk & closing dari laporan harian + order yang Anda handle. Owner bisa pilih CS lain via dropdown."
      emptyHintForOwner="Pilih CS dari dropdown atas untuk lihat performance individual"
      renderExtraSection={({ userId, from, to }) => (
        <CsLeadSection userId={userId} from={from} to={to} />
      )}
    />
  )
}
