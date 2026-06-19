import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

interface PageHeaderProps {
  title: string
  description?: string
  icon?: LucideIcon
  badge?: ReactNode
  actions?: ReactNode
  className?: string
}

export function PageHeader({ title, description, icon: Icon, badge, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6', className)}>
      <div className="flex items-start gap-3 min-w-0">
        {Icon && (
          <div className="hidden sm:flex shrink-0 mt-0.5 size-10 rounded-xl bg-gradient-to-br from-zinc-600/15 to-zinc-600/15 ring-1 ring-zinc-500/20 items-center justify-center">
            <Icon className="size-5 text-zinc-400" />
          </div>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl md:text-[28px] font-bold tracking-tight bg-gradient-to-r from-zinc-300 to-zinc-300 bg-clip-text text-transparent leading-tight">
              {title}
            </h1>
            {badge}
          </div>
          {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}
