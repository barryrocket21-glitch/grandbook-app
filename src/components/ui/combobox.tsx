'use client'
import { useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Button } from '@/components/ui/button'
import { ChevronsUpDown, Check, PackageOpen } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ComboboxOption {
  value: string
  label: string
  hint?: string
}

export interface ComboboxEmptyHint {
  message: string
  actionLabel?: string
  actionHref?: string
}

interface ComboboxProps {
  value: string
  onChange: (v: string) => void
  options: ComboboxOption[]
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  /**
   * Shown inside the popover when `options` is empty (i.e. no data exists yet —
   * not when filter yields no matches). Optional CTA link to navigate to the
   * relevant settings page so the user can add data.
   */
  emptyHint?: ComboboxEmptyHint
  disabled?: boolean
  className?: string
  triggerClassName?: string
  /**
   * Auto-open popover when trigger receives focus (Tab or click). After a
   * selection, the next focus event is ignored once so the popover doesn't
   * immediately re-open while focus returns to the trigger. Defaults to true.
   */
  autoOpenOnFocus?: boolean
}

export function Combobox({
  value,
  onChange,
  options,
  placeholder = 'Pilih...',
  searchPlaceholder = 'Cari...',
  emptyText = 'Tidak ada hasil',
  emptyHint,
  disabled,
  className,
  triggerClassName,
  autoOpenOnFocus = true,
}: ComboboxProps) {
  const [open, setOpen] = useState(false)
  // Avoid an immediate re-open when focus returns to trigger after a
  // selection or Esc. Only one auto-open per focus-acquisition.
  const skipNextAutoOpenRef = useRef(false)
  const selected = options.find((o) => o.value === value)
  const hasNoOptions = options.length === 0
  const showEmptyHint = hasNoOptions && !!emptyHint

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) skipNextAutoOpenRef.current = true
        setOpen(next)
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            disabled={disabled}
            className={cn('w-full justify-between font-normal', triggerClassName)}
            // Klik = pointerdown duluan -> tandai skip, biar onFocus gak auto-buka.
            // Klik cuma lewat toggle PopoverTrigger (kebuka 1x klik, gak flash).
            // Keyboard Tab (tanpa pointerdown) tetep auto-buka.
            onPointerDown={() => { skipNextAutoOpenRef.current = true }}
            onFocus={() => {
              if (disabled || !autoOpenOnFocus) return
              if (skipNextAutoOpenRef.current) {
                skipNextAutoOpenRef.current = false
                return
              }
              setOpen(true)
            }}
          >
            <span className={cn('truncate', !selected && 'text-muted-foreground')}>
              {selected?.label ?? placeholder}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        }
      />
      <PopoverContent className={cn('w-[var(--anchor-width)] min-w-[260px] p-0', className)}>
        <Command>
          {!showEmptyHint && <CommandInput placeholder={searchPlaceholder} autoFocus />}
          {showEmptyHint ? (
            <EmptyHint hint={emptyHint!} />
          ) : (
            <CommandList className="max-h-72 overflow-y-auto overflow-x-hidden">
              <CommandEmpty>{emptyText}</CommandEmpty>
              <CommandGroup>
                {options.map((opt) => (
                  <CommandItem
                    key={opt.value}
                    value={opt.label}
                    onSelect={() => {
                      onChange(opt.value)
                      // Base UI Popover doesn't fire onOpenChange for an
                      // external setOpen(false), so set the suppression flag
                      // explicitly here. Otherwise focus returning to the
                      // trigger would immediately re-open the popover.
                      skipNextAutoOpenRef.current = true
                      setOpen(false)
                    }}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        value === opt.value ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{opt.label}</div>
                      {opt.hint && (
                        <div className="text-[10px] text-muted-foreground truncate">{opt.hint}</div>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function EmptyHint({ hint }: { hint: ComboboxEmptyHint }): ReactNode {
  return (
    <div className="p-4 space-y-2 text-sm">
      <div className="flex items-start gap-2">
        <PackageOpen className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
        <p className="text-muted-foreground">{hint.message}</p>
      </div>
      {hint.actionHref && (
        <Link
          href={hint.actionHref}
          className="inline-flex items-center gap-1 text-zinc-500 hover:underline text-xs pl-6"
        >
          + {hint.actionLabel ?? 'Tambah baru'}
        </Link>
      )}
    </div>
  )
}
