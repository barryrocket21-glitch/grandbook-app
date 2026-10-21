'use client'

import { useSyncExternalStore } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@/components/ui/sidebar'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { useAuth } from '@/components/providers/auth-provider'
import { getNavItemsForRole, ROLE_LABELS } from '@/lib/constants'
import { useSidebarCounts, getCountForHref } from '@/lib/hooks/use-sidebar-counts'
import { BookOpen, LogOut, Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ChevronRight } from 'lucide-react'

const subscribeToMount = () => () => {}

export function AppSidebar() {
  const { user, profile, role, signOut } = useAuth()
  const pathname = usePathname()
  const { theme, setTheme } = useTheme()
  // next-themes resolves the theme only on the client; rendering theme-
  // dependent UI during SSR causes a hydration mismatch. Gate it on mount.
  const mounted = useSyncExternalStore(subscribeToMount, () => true, () => false)

  const navItems = role ? getNavItemsForRole(role) : []
  const counts = useSidebarCounts(user?.id ?? null)

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/dashboard" />}>
              <div className="bg-primary text-primary-foreground rounded-xl flex aspect-square size-9 shrink-0 items-center justify-center">
                <BookOpen className="size-4.5" />
              </div>
              <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                <span className="truncate text-base font-semibold text-foreground">
                  GrandBook
                </span>
                <span className="truncate text-[11px] text-muted-foreground tracking-wide">
                  Pembukuan Bisnis
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Menu Utama</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
                const Icon = item.icon

                if (item.children && item.children.length > 0) {
                  // Auto-expand a group when the current route matches the group
                  // OR any of its children — child hrefs don't always share the
                  // group's href prefix (e.g. Keuangan group → /laba-rugi).
                  const groupActive = isActive || item.children.some(
                    (c) => pathname === c.href || pathname.startsWith(c.href + '/'),
                  )
                  return (
                    <Collapsible key={item.href} defaultOpen={groupActive} className="group/collapsible">
                      <SidebarMenuItem>
                        <SidebarMenuButton
                          render={<CollapsibleTrigger />}
                          className="h-auto min-h-10"
                          tooltip={item.title}
                          isActive={groupActive}
                        >
                          <Icon className="size-4" />
                          <span className="min-w-0 flex-1 truncate">{item.title}</span>
                          <ChevronRight className="ml-auto size-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                        </SidebarMenuButton>
                        <CollapsibleContent>
                          <SidebarMenuSub>
                            {item.children.map((child) => {
                              const count = getCountForHref(child.href, counts)
                              return (
                              <SidebarMenuSubItem key={child.href}>
                                <SidebarMenuSubButton
                                  render={<Link href={child.href} />}
                                  isActive={pathname === child.href}
                                >
                                  <span className="flex min-w-0 w-full items-center gap-2">
                                    <span className="min-w-0 flex-1 truncate" title={child.title}>{child.title}</span>
                                    {count > 0 && (
                                      <span className="ml-auto shrink-0 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums min-w-[20px] text-center">
                                        {count > 99 ? '99+' : count}
                                      </span>
                                    )}
                                    {!count && child.badge && (
                                      <span className="ml-auto shrink-0 rounded bg-zinc-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-zinc-600">
                                        {child.badge}
                                      </span>
                                    )}
                                  </span>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            )})}
                          </SidebarMenuSub>
                        </CollapsibleContent>
                      </SidebarMenuItem>
                    </Collapsible>
                  )
                }

                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      render={<Link href={item.href} />}
                      tooltip={item.title}
                      isActive={isActive}
                    >
                      <Icon className="size-4" />
                      <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex items-center gap-2 p-2">
              <Avatar className="size-8 rounded-lg">
                <AvatarFallback className="rounded-lg bg-zinc-600 text-white text-xs">
                  {profile?.full_name ? getInitials(profile.full_name) : 'U'}
                </AvatarFallback>
              </Avatar>
              <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold text-sm">
                  {profile?.full_name || 'User'}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {role ? ROLE_LABELS[role] : ''}
                </span>
              </div>
            </div>
            <div className="flex gap-1 px-2 pb-1">
              <button
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                {mounted && theme === 'dark' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
                {mounted && theme === 'dark' ? 'Terang' : 'Gelap'}
              </button>
              <button
                onClick={signOut}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-red-500 hover:bg-red-500/10 transition-colors"
              >
                <LogOut className="size-3.5" />
                Keluar
              </button>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
