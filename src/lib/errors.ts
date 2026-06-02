// Brief #20 — ekstraktor pesan error yang bener. Akar bug toast "[object Object]":
// Supabase error itu PLAIN OBJECT ({message, details, hint, code}), BUKAN instanceof
// Error → `String(err)` => "[object Object]" yang nyembunyiin akar masalah.
// Pakai getErrorMessage(err) di SEMUA catch/toast, JANGAN String(err) langsung.

export function getErrorMessage(err: unknown): string {
  if (err == null) return 'Unknown error'
  if (typeof err === 'string') return err
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'object') {
    const e = err as Record<string, unknown>
    // Supabase PostgrestError: message (+ details/hint/code)
    const msg = typeof e.message === 'string' ? e.message : ''
    const details = typeof e.details === 'string' ? e.details : ''
    const hint = typeof e.hint === 'string' ? e.hint : ''
    const combined = [msg, details, hint].filter(Boolean).join(' — ')
    if (combined) return combined
    try {
      const j = JSON.stringify(err)
      if (j && j !== '{}') return j
    } catch { /* ignore */ }
  }
  return String(err)
}
