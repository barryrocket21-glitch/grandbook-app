'use client'

import { useEffect, useState } from 'react'
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
import { BookOpen, ChevronUp, LogOut, Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ChevronRight } from 'lucide-react'

export function AppSidebar() {
  const { user, profile, role, signOut } = useAuth()
  const pathname = usePathname()
  const { theme, setTheme } = useTheme()
  // next-themes resolves the theme only on the client; rendering theme-
  // dependent UI during SSR causes a hydration mismatch. Gate it on mount.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

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
              <div className="bg-gradient-to-br from-violet-500 via-violet-600 to-indigo-600 text-white rounded-xl flex aspect-square size-9 items-center justify-center shadow-lg shadow-violet-500/30 ring-1 ring-white/10">
                <BookOpen className="size-4.5" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-bold text-base bg-gradient-to-r from-violet-300 to-indigo-300 bg-clip-text text-transparent">
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
                  return (
                    <Collapsible key={item.href} defaultOpen={isActive} className="group/collapsible">
                      <SidebarMenuItem>
                        <SidebarMenuButton
                          render={<CollapsibleTrigger />}
                          tooltip={item.title}
                          isActive={isActive}
                        >
                          <Icon className="size-4" />
                          <span>{item.title}</span>
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
                                  <span className="flex items-center gap-1.5 w-full">
                                    <span className="truncate">{child.title}</span>
                                    {count > 0 && (
                                      <span className="ml-auto rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums min-w-[20px] text-center">
                                        {count > 99 ? '99+' : count}
                                      </span>
                                    )}
                                    {!count && child.badge && (
                                      <span className="ml-auto rounded bg-violet-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-violet-600">
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
                      <span>{item.title}</span>
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
                <AvatarFallback className="rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 text-white text-xs">
                  {profile?.full_name ? getInitials(profile.full_name) : 'U'}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
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
