/** Compare against the public Host; Next's internal URL may use localhost. */
export function isAllowedRequestOrigin(request: Request) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false
  const origin = request.headers.get('origin')
  if (!origin) return true
  try {
    const source = new URL(origin)
    const target = new URL(request.url)
    return source.origin === origin
      && source.protocol === target.protocol
      && source.host === (request.headers.get('host') ?? target.host)
  } catch {
    return false
  }
}
