import { NextResponse } from 'next/server'
import { requireOperationsUser } from '@/lib/server/operations-auth'

export async function GET(request: Request) {
  const auth = await requireOperationsUser(request)
  if ('response' in auth) return auth.response
  const [channels, products, profiles] = await Promise.all([
    auth.sb.from('courier_channels').select('*').eq('active', true).order('code'),
    auth.sb.from('products').select('id, name, search_aliases').eq('organization_id', auth.profile.organization_id).eq('active', true),
    auth.sb.from('profiles').select('id, full_name').eq('organization_id', auth.profile.organization_id).eq('active', true).in('role', ['cs', 'admin', 'owner']),
  ])
  if (channels.error || products.error || profiles.error) return NextResponse.json({ error: 'Data referensi belum dapat dimuat.' }, { status: 503 })
  return NextResponse.json({ channels: channels.data, products: products.data, csProfiles: profiles.data })
}
