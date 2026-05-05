import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  className?: string
  compact?: boolean
}

export function EmptyState({ icon: Icon, title, description, action, className, compact }: EmptyStateProps) {
  return (
    <div className={cn(
      'flex flex-col items-center justify-center text-center',
      compact ? 'py-8' : 'py-16',
      className
    )}>
      <div className={cn(
        'rounded-2xl bg-gradient-to-br from-violet-600/10 to-indigo-600/10 ring-1 ring-violet-500/20 flex items-center justify-center mb-4',
        compact ? 'size-12' : 'size-16'
      )}>
        <Icon className={cn('text-violet-400', compact ? 'size-6' : 'size-8')} />
      </div>
      <h3 className={cn('font-semibold', compact ? 'text-sm' : 'text-base')}>{title}</h3>
      {description && <p className="text-sm text-muted-foreground mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
