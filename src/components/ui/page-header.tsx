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
    <div className={cn('flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4 mb-5 min-w-0', className)}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {Icon && (
          <div className="hidden sm:flex shrink-0 mt-0.5 size-10 rounded-xl bg-muted ring-1 ring-border items-center justify-center">
            <Icon className="size-5 text-foreground" />
          </div>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="break-words text-2xl font-semibold tracking-tight text-foreground leading-tight sm:text-[28px]">
              {title}
            </h1>
            {badge}
          </div>
          {description && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex min-w-0 flex-wrap items-center gap-2 [&>div]:flex-wrap">{actions}</div>}
    </div>
  )
}
