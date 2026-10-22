'use client'
import { useAuth } from '@/components/providers/auth-provider'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'

export default function ResetDataPage() {
  const { role, loading } = useAuth()
  if (loading) return <p>Memuat…</p>
  if (role !== 'owner') return <p>Halaman ini hanya untuk Owner.</p>
  return <div className="space-y-6">
    <PageHeader title="Reset Data" description="Perlindungan data operasional" />
    <Card><CardContent className="pt-6 space-y-2">
      <p>Reset massal sedang dinonaktifkan untuk menjaga transaksi dan riwayat yang masih digunakan.</p>
      <p className="text-sm text-muted-foreground">Data tetap tersedia. Koreksi order dapat dilakukan melalui halaman order masing-masing.</p>
    </CardContent></Card>
  </div>
}
