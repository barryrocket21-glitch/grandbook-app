'use client'

import { AuthProvider } from '@/components/providers/auth-provider'
import { ThemeProvider } from '@/components/providers/theme-provider'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { AppHeader } from '@/components/layout/app-header'
import { TooltipProvider } from '@/components/ui/tooltip'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <TooltipProvider>
          <SidebarProvider>
            <AppSidebar />
            <SidebarInset>
              <AppHeader />
              <main className="flex-1 p-4 md:p-6 overflow-auto">
                {children}
              </main>
            </SidebarInset>
          </SidebarProvider>
        </TooltipProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
