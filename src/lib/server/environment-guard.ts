import { NextResponse } from 'next/server'
import { environmentError, isBlockedWrite } from '@/lib/environment-safety'

export function serverEnvironmentResponse(method: string, pathname: string) {
  const error = environmentError(process.env)
  if (error) return NextResponse.json({ error }, { status: 503 })
  if (isBlockedWrite(method, pathname, process.env)) {
    return NextResponse.json({ error: 'Lingkungan ini hanya untuk baca.' }, { status: 423 })
  }
  return null
}
