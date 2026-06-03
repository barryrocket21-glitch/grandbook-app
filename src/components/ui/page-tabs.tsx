'use client'
// Tab-bar reusable buat gabungin beberapa halaman segrup jadi satu "hub".
// Auto-highlight tab aktif dari pathname. Dipakai via layout.tsx (Inbox,
// Rekonsiliasi) atau ditempel manual di page (Input Order).
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export interface PageTab { label: string; href: string }

export function PageTabs({ items }: { items: PageTab[] }) {
  const path = usePathname()
  return (
    <div className="flex flex-wrap gap-1 border-b border-foreground/10 overflow-x-auto">
      {items.map(it => {
        const active = path === it.href || path.startsWith(it.href + '/')
        return (
          <Link key={it.href} href={it.href}
            className={`px-3 h-9 inline-flex items-center whitespace-nowrap text-sm border-b-2 -mb-px transition-colors ${
              active ? 'border-violet-500 text-foreground font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}>
            {it.label}
          </Link>
        )
      })}
    </div>
  )
}
