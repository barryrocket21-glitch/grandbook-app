'use client'

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
import { BookOpen, ChevronUp, LogOut, Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ChevronRight } from 'lucide-react'

export function AppSidebar() {
  const { profile, role, signOut } = useAuth()
  const pathname = usePathname()
  const { theme, setTheme } = useTheme()

  const navItems = role ? getNavItemsForRole(role) : []

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
              <div className="bg-gradient-to-br from-violet-600 to-indigo-600 text-white rounded-lg flex aspect-square size-8 items-center justify-center shadow-lg shadow-violet-500/25">
                <BookOpen className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-bold bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-transparent">
                  GrandBook
                </span>
                <span className="truncate text-xs text-muted-foreground">
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
                            {item.children.map((child) => (
                              <SidebarMenuSubItem key={child.href}>
                                <SidebarMenuSubButton
                                  render={<Link href={child.href} />}
                                  isActive={pathname === child.href}
                                >
                                  <span>{child.title}</span>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            ))}
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
                {theme === 'dark' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
                {theme === 'dark' ? 'Terang' : 'Gelap'}
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
