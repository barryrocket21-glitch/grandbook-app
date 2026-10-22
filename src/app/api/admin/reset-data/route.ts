import { NextResponse } from 'next/server'
import { requireUserManager } from '@/lib/server/admin-users'

export async function POST(request: Request) {
  const auth = await requireUserManager(request, true)
  if (auth.response) return auth.response
  if (auth.profile.role !== 'owner') return NextResponse.json({ error: 'Hanya Owner.' }, { status: 403 })
  // The historical global reset crossed organization boundaries and could partially delete data.
  // Keep it closed until a scoped, transactional replacement has its own recovery verification.
  return NextResponse.json({ error: 'Reset massal dinonaktifkan untuk menjaga data operasional. Tidak ada data yang dihapus.' }, { status: 405 })
}
