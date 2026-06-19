'use client'
import { useCallback, useEffect, useState } from 'react'
import { getErrorMessage } from '@/lib/errors'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover'
import { Bell, CheckCheck, BellOff, AlertTriangle, ChevronRight } from 'lucide-react'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { id as idLocale } from 'date-fns/locale'
import { toast } from 'sonner'
import type { Notification } from '@/lib/types'

const supabase = createClient()

// Polling interval saat tab aktif. Saat hidden/no-unread, poll lebih jarang.
const POLL_INTERVAL_ACTIVE_MS = 30_000
const POLL_INTERVAL_IDLE_MS = 60_000
const MAX_DISPLAY = 10

export function NotificationBell() {
  const { user } = useAuth()
  const [notifs, setNotifs] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(MAX_DISPLAY)
      if (error) throw error
      const rows = (data || []) as Notification[]
      setNotifs(rows)
      setUnreadCount(rows.filter(n => !n.read_at).length)
    } catch (err) {
      // RPC error (migration belum apply etc) → silent fail
      console.warn('NotificationBell load failed:', err)
    } finally {
      setLoading(false)
    }
  }, [user])

  // Polling — adaptive interval: hemat resource saat tab inactive / no-unread
  useEffect(() => {
    if (!user) return
    load()
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = () => {
      const visible = document.visibilityState === 'visible'
      const interval = visible && unreadCount > 0
        ? POLL_INTERVAL_ACTIVE_MS
        : POLL_INTERVAL_IDLE_MS
      timer = setTimeout(async () => {
        if (visible) await load()
        tick()
      }, interval)
    }
    tick()
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => {
      if (timer) clearTimeout(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [user, load, unreadCount])

  const markRead = async (n: Notification) => {
    if (n.read_at) return
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', n.id)
      if (error) throw error
      setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x))
      setUnreadCount(c => Math.max(0, c - 1))
    } catch (err) {
      toast.error('Gagal mark read', { description: getErrorMessage(err) })
    }
  }

  const markAllRead = async () => {
    const unread = notifs.filter(n => !n.read_at)
    if (unread.length === 0) return
    try {
      const nowIso = new Date().toISOString()
      const { error } = await supabase
        .from('notifications')
        .update({ read_at: nowIso })
        .in('id', unread.map(n => n.id))
      if (error) throw error
      setNotifs(prev => prev.map(n => n.read_at ? n : { ...n, read_at: nowIso }))
      setUnreadCount(0)
      toast.success('Semua notif ditandai dibaca')
    } catch (err) {
      toast.error('Gagal mark all read', { description: getErrorMessage(err) })
    }
  }

  if (!user) return null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="ghost" size="icon" className="relative" />}>
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[380px] p-0">
        <div className="flex items-center justify-between p-3 border-b">
          <div className="space-y-0.5">
            <p className="text-sm font-semibold">Notifikasi</p>
            <p className="text-[10px] text-muted-foreground">
              {unreadCount > 0 ? `${unreadCount} belum dibaca` : 'Semua sudah dibaca'}
            </p>
          </div>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" onClick={markAllRead} className="text-xs h-7">
              <CheckCheck className="w-3.5 h-3.5 mr-1" />
              Tandai semua
            </Button>
          )}
        </div>
        <div className="max-h-[480px] overflow-y-auto">
          {loading && notifs.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">Memuat…</div>
          ) : notifs.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">
              <BellOff className="w-8 h-8 mx-auto mb-2 opacity-30" />
              Belum ada notifikasi
            </div>
          ) : (
            <ul className="divide-y">
              {notifs.map(n => (
                <NotificationItem
                  key={n.id}
                  notification={n}
                  onClick={() => { markRead(n); setOpen(false) }}
                />
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function NotificationItem({
  notification, onClick,
}: { notification: Notification; onClick: () => void }) {
  const { type, title, body, link, created_at, read_at } = notification
  const isUnread = !read_at
  const isFinancialEdit = type === 'admin_edit_financial'

  // Body multi-line: render preserved newlines. Untuk admin_edit_financial,
  // tidak truncate (owner perlu lihat semua perubahan langsung).
  const bodyClass = isFinancialEdit
    ? 'whitespace-pre-line'
    : 'whitespace-pre-line line-clamp-3'

  const inner = (
    <div
      className={`p-3 hover:bg-muted/40 cursor-pointer transition-colors ${isUnread ? 'bg-zinc-500/5' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-start gap-2">
        {isUnread && (
          <span className="w-2 h-2 rounded-full bg-zinc-500 mt-1.5 shrink-0" aria-label="unread" />
        )}
        <div className="flex-1 space-y-1 min-w-0">
          <div className="flex items-start gap-2">
            {isFinancialEdit && (
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
            )}
            <p className={`text-sm font-medium leading-tight ${isUnread ? '' : 'text-muted-foreground'}`}>
              {title}
            </p>
          </div>
          {body && (
            <p className={`text-xs text-muted-foreground ${bodyClass}`}>
              {body}
            </p>
          )}
          <div className="flex items-center justify-between gap-2 pt-0.5">
            <span className="text-[10px] text-muted-foreground">
              {formatRelative(created_at)}
            </span>
            {link && (
              <ChevronRight className="w-3 h-3 text-muted-foreground" />
            )}
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <li>
      {link ? <Link href={link}>{inner}</Link> : inner}
    </li>
  )
}

function formatRelative(iso: string): string {
  try {
    return formatDistanceToNow(parseISO(iso), { addSuffix: true, locale: idLocale })
  } catch {
    return iso
  }
}
