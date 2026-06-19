'use client'
import { useState, useMemo } from 'react'
import { getErrorMessage } from '@/lib/errors'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet'
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from '@/components/ui/tabs'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Settings2, Eye, EyeOff, Search, Plus, Save, Trash2, Pin, GripVertical, Loader2, Users } from 'lucide-react'
import { toast } from 'sonner'

import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, useSortable, verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'

import {
  COLUMNS, COLUMNS_BY_ID, CATEGORY_LABEL, groupByCategory,
  SYSTEM_DEFAULT_VISIBILITY, SYSTEM_DEFAULT_ORDER, SYSTEM_DEFAULT_WIDTHS,
} from '@/lib/orders/columns-config'
import type { SavedView, UserPreferences, OrganizationSettings } from '@/lib/types'

const supabase = createClient()

interface Props {
  visibility: Record<string, boolean>
  order: string[]
  widths: Record<string, number>
  savedViews: SavedView[]
  activeViewId: string | null
  onChange: (next: {
    visibility?: Record<string, boolean>
    order?: string[]
    widths?: Record<string, number>
    savedViews?: SavedView[]
    activeViewId?: string | null
  }) => void
  /** Persist semua perubahan ke profiles.preferences */
  onPersist: () => Promise<void>
}

/**
 * Phase 8E — Customizable column view.
 *
 * Sheet dengan 3 tab:
 * 1. Visibility — checkbox grouped by category + search
 * 2. Order — drag-drop reorder visible columns (dnd-kit)
 * 3. Saved Views — CRUD view, apply, (owner only) "Set as Team Default"
 */
export function ColumnCustomizer({
  visibility, order, widths, savedViews, activeViewId,
  onChange, onPersist,
}: Props) {
  const { profile, role } = useAuth()
  const [open, setOpen] = useState(false)

  const visibleCount = Object.values(visibility).filter(Boolean).length

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={
        <Button variant="outline" size="sm" className="gap-1.5">
          <Settings2 className="w-3.5 h-3.5" />
          Kolom
          <Badge variant="outline" className="ml-1 text-[10px]">
            {visibleCount}/{COLUMNS.length}
          </Badge>
        </Button>
      } />
      <SheetContent className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="p-4 border-b">
          <SheetTitle>Customize Kolom</SheetTitle>
          <SheetDescription>
            Atur visibility, urutan, dan saved view. Pengaturan tersimpan otomatis ke akunmu.
          </SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="visibility" className="flex-1 flex flex-col min-h-0">
          <TabsList className="mx-4 mt-3 grid grid-cols-3">
            <TabsTrigger value="visibility">Visibility</TabsTrigger>
            <TabsTrigger value="order">Urutan</TabsTrigger>
            <TabsTrigger value="saved">Saved Views</TabsTrigger>
          </TabsList>

          <TabsContent value="visibility" className="flex-1 overflow-y-auto p-4">
            <VisibilityTab
              visibility={visibility}
              onToggle={(id, v) => onChange({ visibility: { ...visibility, [id]: v } })}
              onSetAll={(v) => onChange({
                visibility: Object.fromEntries(COLUMNS.map(c => [c.id, c.id === 'actions' ? true : v]))
              })}
              onResetSystem={() => onChange({
                visibility: { ...SYSTEM_DEFAULT_VISIBILITY },
                order: [...SYSTEM_DEFAULT_ORDER],
                widths: { ...SYSTEM_DEFAULT_WIDTHS },
              })}
            />
          </TabsContent>

          <TabsContent value="order" className="flex-1 overflow-y-auto p-4">
            <OrderTab
              order={order}
              visibility={visibility}
              onReorder={(next) => onChange({ order: next })}
            />
          </TabsContent>

          <TabsContent value="saved" className="flex-1 overflow-y-auto p-4">
            <SavedViewsTab
              savedViews={savedViews}
              activeViewId={activeViewId}
              currentVisibility={visibility}
              currentOrder={order}
              currentWidths={widths}
              onChange={onChange}
              role={role}
              orgId={profile?.organization_id || null}
            />
          </TabsContent>
        </Tabs>

        <div className="p-4 border-t flex items-center justify-between">
          <p className="text-[10px] text-muted-foreground">
            Auto-save aktif. Tutup panel saat selesai.
          </p>
          <Button size="sm" onClick={async () => {
            try { await onPersist(); toast.success('Tersimpan'); }
            catch (e) { toast.error('Gagal simpan', { description: getErrorMessage(e) }) }
          }}>
            <Save className="w-3.5 h-3.5 mr-1" />Simpan sekarang
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// =======================================================================
// Tab 1 — Visibility
// =======================================================================
function VisibilityTab({ visibility, onToggle, onSetAll, onResetSystem }: {
  visibility: Record<string, boolean>
  onToggle: (id: string, v: boolean) => void
  onSetAll: (v: boolean) => void
  onResetSystem: () => void
}) {
  const [search, setSearch] = useState('')
  const grouped = useMemo(() => groupByCategory(), [])

  const matchesSearch = (id: string) => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    const c = COLUMNS_BY_ID[id]
    return c.label.toLowerCase().includes(q) || id.toLowerCase().includes(q)
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Cari kolom..."
          className="pl-9 h-8 text-xs"
        />
      </div>
      <div className="flex gap-1.5 flex-wrap">
        <Button size="sm" variant="outline" onClick={() => onSetAll(true)} className="h-7 text-xs">
          <Eye className="w-3 h-3 mr-1" />Show all
        </Button>
        <Button size="sm" variant="outline" onClick={() => onSetAll(false)} className="h-7 text-xs">
          <EyeOff className="w-3 h-3 mr-1" />Hide all
        </Button>
        <Button size="sm" variant="outline" onClick={onResetSystem} className="h-7 text-xs ml-auto">
          Reset default
        </Button>
      </div>

      {Object.entries(grouped).map(([cat, cols]) => {
        const filtered = cols.filter(c => matchesSearch(c.id))
        if (filtered.length === 0) return null
        return (
          <div key={cat} className="space-y-1.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {CATEGORY_LABEL[cat as keyof typeof CATEGORY_LABEL] || cat}
            </p>
            <div className="space-y-1">
              {filtered.map(c => (
                <label
                  key={c.id}
                  className="flex items-center gap-2 text-xs cursor-pointer hover:bg-muted/30 p-1.5 rounded"
                >
                  <Checkbox
                    checked={visibility[c.id] ?? c.default_visible}
                    onCheckedChange={v => onToggle(c.id, v === true)}
                    disabled={c.id === 'actions'}
                  />
                  <span className="flex-1">{c.label}</span>
                  {c.editable_field && (
                    <Badge variant="outline" className="text-[9px] bg-zinc-500/10 text-zinc-600">
                      editable
                    </Badge>
                  )}
                </label>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// =======================================================================
// Tab 2 — Order (drag-drop)
// =======================================================================
function OrderTab({ order, visibility, onReorder }: {
  order: string[]
  visibility: Record<string, boolean>
  onReorder: (next: string[]) => void
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const visibleOrder = useMemo(
    () => order.filter(id => visibility[id] && COLUMNS_BY_ID[id]),
    [order, visibility]
  )

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIdx = visibleOrder.indexOf(active.id as string)
    const newIdx = visibleOrder.indexOf(over.id as string)
    if (oldIdx < 0 || newIdx < 0) return

    // Re-insert ke full order array (preserve posisi kolom hidden)
    const next = [...order]
    const fromAbs = next.indexOf(active.id as string)
    const toAbs   = next.indexOf(over.id as string)
    if (fromAbs < 0 || toAbs < 0) return
    onReorder(arrayMove(next, fromAbs, toAbs))
  }

  if (visibleOrder.length === 0) {
    return <p className="text-xs text-muted-foreground italic">Tidak ada kolom visible. Aktifkan dulu di tab Visibility.</p>
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Drag ke atas/bawah untuk re-order. Hanya kolom visible yang tampil di sini.
      </p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} modifiers={[restrictToVerticalAxis]}>
        <SortableContext items={visibleOrder} strategy={verticalListSortingStrategy}>
          <ul className="space-y-1">
            {visibleOrder.map(id => (
              <SortableItem key={id} id={id} label={COLUMNS_BY_ID[id]?.label || id} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  )
}

function SortableItem({ id, label }: { id: string; label: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 p-2 bg-muted/30 rounded text-xs cursor-grab active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      <GripVertical className="w-3.5 h-3.5 text-muted-foreground" />
      <span className="flex-1">{label}</span>
    </li>
  )
}

// =======================================================================
// Tab 3 — Saved Views
// =======================================================================
function SavedViewsTab({
  savedViews, activeViewId, currentVisibility, currentOrder, currentWidths,
  onChange, role, orgId,
}: {
  savedViews: SavedView[]
  activeViewId: string | null
  currentVisibility: Record<string, boolean>
  currentOrder: string[]
  currentWidths: Record<string, number>
  onChange: Props['onChange']
  role: string | null | undefined
  orgId: number | null
}) {
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [savingTeam, setSavingTeam] = useState<string | null>(null)
  const isOwner = role === 'owner'

  const applyView = (v: SavedView) => {
    onChange({
      visibility: { ...v.column_visibility },
      order: [...v.column_order],
      widths: { ...v.column_widths },
      activeViewId: v.id,
    })
    toast.success(`View "${v.name}" diterapkan`)
  }

  const deleteView = (id: string) => {
    const next = savedViews.filter(v => v.id !== id)
    onChange({
      savedViews: next,
      activeViewId: activeViewId === id ? null : activeViewId,
    })
    toast.success('View dihapus')
  }

  const createView = () => {
    const name = newName.trim()
    if (!name) return toast.error('Nama wajib diisi')
    if (savedViews.length >= 10) return toast.error('Maksimal 10 saved view')
    const newView: SavedView = {
      id: crypto.randomUUID(),
      name,
      column_visibility: { ...currentVisibility },
      column_order: [...currentOrder],
      column_widths: { ...currentWidths },
      created_at: new Date().toISOString(),
    }
    onChange({
      savedViews: [...savedViews, newView],
      activeViewId: newView.id,
    })
    setNewName('')
    setCreateOpen(false)
    toast.success(`View "${name}" disimpan`)
  }

  const setTeamDefault = async (v: SavedView) => {
    if (!orgId) return
    setSavingTeam(v.id)
    try {
      // Fetch existing settings, merge orders_list_default_view
      const { data: org, error: fetchErr } = await supabase
        .from('organizations').select('settings').eq('id', orgId).single()
      if (fetchErr) throw fetchErr
      const existingSettings = (org?.settings ?? {}) as OrganizationSettings
      const nextSettings: OrganizationSettings = {
        ...existingSettings,
        orders_list_default_view: {
          column_visibility: v.column_visibility,
          column_order: v.column_order,
          column_widths: v.column_widths,
        },
      }
      const { error } = await supabase
        .from('organizations')
        .update({ settings: nextSettings })
        .eq('id', orgId)
      if (error) throw error
      toast.success(`"${v.name}" jadi Team Default`)
    } catch (err) {
      toast.error('Gagal set team default', { description: getErrorMessage(err) })
    } finally {
      setSavingTeam(null)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{savedViews.length} / 10 saved view</p>
        <Button size="sm" onClick={() => setCreateOpen(true)} disabled={savedViews.length >= 10}>
          <Plus className="w-3.5 h-3.5 mr-1" />Save current
        </Button>
      </div>

      {savedViews.length === 0 ? (
        <p className="text-xs text-muted-foreground italic text-center py-6">
          Belum ada saved view. Klik &quot;Save current&quot; untuk simpan konfigurasi sekarang.
        </p>
      ) : (
        <ul className="space-y-2">
          {savedViews.map(v => (
            <li key={v.id} className={`border rounded p-2.5 space-y-1.5 ${activeViewId === v.id ? 'border-zinc-500/50 bg-zinc-500/5' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium flex items-center gap-1.5">
                  {v.name}
                  {activeViewId === v.id && <Pin className="w-3 h-3 text-zinc-500" />}
                </span>
                <Button size="sm" variant="ghost" onClick={() => deleteView(v.id)} className="h-6 px-2 text-red-500">
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                {Object.values(v.column_visibility).filter(Boolean).length} kolom visible
              </p>
              <div className="flex gap-1.5">
                <Button size="sm" variant="outline" className="h-6 text-xs flex-1" onClick={() => applyView(v)}>
                  Apply
                </Button>
                {isOwner && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-xs"
                    onClick={() => setTeamDefault(v)}
                    disabled={savingTeam === v.id}
                  >
                    {savingTeam === v.id
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <Users className="w-3 h-3 mr-1" />}
                    Team default
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Save current view</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-sm">Nama view</Label>
            <Input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Profit View, CS Daily, dll"
              maxLength={60}
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') createView() }}
            />
            <p className="text-[10px] text-muted-foreground">
              Akan menyimpan visibility + urutan + lebar kolom sekarang.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Batal</Button>
            <Button onClick={createView}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * Helper untuk persist preferences ke profiles.preferences.
 * Caller di /orders/list page nge-call ini setelah debounce.
 */
export async function persistOrdersListPreferences(
  userId: string,
  current: UserPreferences,
  next: NonNullable<UserPreferences['orders_list']>,
): Promise<void> {
  const merged: UserPreferences = {
    ...current,
    orders_list: {
      ...current.orders_list,
      ...next,
    },
  }
  const { error } = await supabase
    .from('profiles')
    .update({ preferences: merged })
    .eq('id', userId)
  if (error) throw error
}
