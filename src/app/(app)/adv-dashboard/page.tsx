'use client'
import { Megaphone } from 'lucide-react'
import { PersonalDashboard } from '@/components/analytics/personal-dashboard'

export default function AdvDashboardPage() {
  return (
    <PersonalDashboard
      role="advertiser"
      icon={Megaphone}
      pageTitle="Performance Advertiser — Saya"
      pageDescription="Order dari campaign yang Anda jalankan + komisi yang sudah/akan diterima. Owner bisa pilih advertiser lain via dropdown."
      emptyHintForOwner="Pilih advertiser dari dropdown atas untuk lihat performance individual"
    />
  )
}
