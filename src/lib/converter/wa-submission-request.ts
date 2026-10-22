// A token represents one explicit submission, never a customer/phone identity.
// Keep pending tokens in this tab across reloads; remove after a confirmed success.
export async function pendingWaSubmission(userId: string, orders: unknown, storage: Pick<Storage, 'getItem' | 'setItem'>) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(orders)))
  const fingerprint = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
  const storageKey = `grandbook:wa-pending:${userId}:${fingerprint}`
  const existing = storage.getItem(storageKey)
  const requestId = existing && /^[0-9a-f-]{36}$/i.test(existing) ? existing : crypto.randomUUID()
  storage.setItem(storageKey, requestId)
  return { storageKey, requestId }
}
