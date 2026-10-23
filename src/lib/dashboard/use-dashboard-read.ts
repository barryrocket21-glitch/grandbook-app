'use client'
import { useCallback, useEffect, useRef, useState } from 'react'

interface ReadState<T> { key: string | null; value: T | null; pending: boolean; failed: boolean; readAt: string | null }
/** Clear old values immediately; abort + sequence check also protects against loaders ignoring abort. */
export function useDashboardRead<T>(key: string | null, loader: (signal: AbortSignal) => Promise<T>, intervalMs?: number) {
  const [state, setState] = useState<ReadState<T>>({ key: null, value: null, pending: true, failed: false, readAt: null })
  const request = useRef<{ sequence: number; controller: AbortController | null }>({ sequence: 0, controller: null })
  const refresh = useCallback(async () => {
    if (key === null) return
    const sequence = ++request.current.sequence
    request.current.controller?.abort()
    const controller = new AbortController()
    request.current.controller = controller
    setState({ key, value: null, pending: true, failed: false, readAt: null })
    let timeout: number | undefined
    try {
      const value = await Promise.race([loader(controller.signal), new Promise<never>((_, reject) => {
        timeout = window.setTimeout(() => { controller.abort(); reject(new Error('Read timeout')) }, 90_000)
      })])
      if (request.current.sequence !== sequence || controller.signal.aborted) throw new Error('Read superseded')
      setState({ key, value, pending: false, failed: false, readAt: new Date().toISOString() })
    } catch {
      controller.abort()
      if (request.current.sequence === sequence) setState({ key, value: null, pending: false, failed: true, readAt: null })
    } finally {
      window.clearTimeout(timeout)
    }
  }, [key, loader])
  useEffect(() => {
    const activeRequest = request.current
    const timer = window.setTimeout(() => { void refresh() }, 0)
    const interval = intervalMs ? window.setInterval(() => { void refresh() }, intervalMs) : undefined
    const focus = () => { void refresh() }
    if (intervalMs) window.addEventListener('focus', focus)
    return () => {
      window.clearTimeout(timer)
      window.clearInterval(interval)
      window.removeEventListener('focus', focus)
      activeRequest.sequence++
      activeRequest.controller?.abort()
    }
  }, [refresh, intervalMs])
  const current = key !== null && state.key === key
  return { data: current && !state.pending && !state.failed ? state.value : null,
    loading: key !== null && (!current || state.pending), error: current && state.failed,
    readAt: current ? state.readAt : null, refresh }
}
