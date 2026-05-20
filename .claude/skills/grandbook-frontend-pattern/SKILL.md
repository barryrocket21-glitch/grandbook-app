---
name: grandbook-frontend-pattern
description: GrandBook frontend conventions. Use when building any new page, table view, dialog, form, sidebar entry, or stats bar for GrandBook. Triggers on tasks like "create page", "add sidebar entry", "build dialog", "TanStack Table", "shadcn Sheet", "stats bar", "ColumnCustomizer". Encodes file structure, shadcn primitives priority, role-based auth, column preference handling, design taste (avoid AI slop UI).
---

# GrandBook Frontend Patterns

## File Structure

```
src/app/(app)/<feature>/
├── page.tsx                  # Server Component
├── actions.ts                # Server Actions
├── loading.tsx               # Suspense fallback
└── _components/              # Local (underscore = not routable)
```

## Stats Bar Pattern (z-index critical)

```tsx
<div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 -mx-4 px-4 py-3 border-b">
  <div className="flex gap-2 overflow-x-auto">
    {stats.map(s => <StatsCard key={s.status} {...s} onClick={...} />)}
  </div>
</div>
```

**z-10 not z-20** — sidebar overlay needs higher z-index.

## Table Cell

- `min-w-0 truncate` + `title={value}` for long text tooltip
- `font-mono text-xs` for resi/order_number
- `whitespace-nowrap pl-3` for numeric/financial
- `align-middle overflow-hidden` on `<TableCell>` so maxWidth clips

## ColumnConfig (Existing User Prefs)

```ts
{
  key: 'product_summary',
  label: 'Produk',
  default_visible: true,
  default_width: 200,
  default_order_position: 4,
}

const merged = mergeNewColumnsByAnchor(userPrefs, SYSTEM_DEFAULTS);
```

Don't override user customization. Inject new columns at default position.

## Sidebar Entry

```ts
// src/lib/constants.ts
{
  label: 'Antrian Kerja',
  href: '/orders/draft',
  roles: ['owner', 'admin', 'cs'],
  isNew: true,
}
```

## Design Taste (AVOID AI SLOP)

**FORBIDDEN:**
- Inter font (use Geist Sans or system)
- Purple gradient backgrounds (solid violet-500 for accents only)
- Generic shadcn card for everything (vary: bordered, ghost, glass)
- "Safe neutrals" only
- Lucide icons spammed

**Status colors (DON'T deviate):**

```ts
const STATUS_BG_CLASSES = {
  DITERIMA:   'bg-emerald-500',
  DIKIRIM:    'bg-blue-500',
  SIAP_KIRIM: 'bg-amber-500',
  PROBLEM:    'bg-orange-500',
  RETUR:      'bg-rose-500',
  CANCEL:     'bg-slate-400',
  BARU:       'bg-slate-300',
};
```

## Server Actions

```ts
"use server"
import { revalidatePath } from "next/cache";

export async function createSomething(data: FormData) {
  // 1. Validate
  // 2. Mutation
  // 3. revalidatePath('/feature')  ← MANDATORY
}
```

## Toast

```ts
import { toast } from "sonner";
toast.success("Order pindah ke Arsip", {
  description: `Order #${orderNumber} sudah punya resi`,
});
```

Indonesian for user-facing, English for dev-only.

## Before Commit

```bash
npx tsc --noEmit  # MUST exit 0
npm run build     # MUST succeed
```
