# Local Supabase Env

GrandBook local app butuh env Supabase yang valid. Kalau `.env.local` cuma berisi token Vercel atau nilai placeholder, middleware/auth akan jebol.

## Minimum untuk app runtime / build

Wajib ada di `.env.local`:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Tanpa dua ini:
- login page / middleware bisa error
- `npm run build` bisa gagal
- dev server bisa crash saat request pertama

## Tambahan untuk admin + maintenance

Opsional untuk app biasa, tapi wajib kalau mau pakai route/script tertentu:

- `SUPABASE_SERVICE_ROLE_KEY`

### Route admin yang butuh service role

- `/api/admin/users`
- `/api/admin/users/[id]`
- `/api/admin/reset-data`
- `/api/admin/repair`

### Script yang butuh service role

- `scripts/import_master_wilayah.ts`
- `scripts/seed-master-wilayah-spx.mjs`
- `scripts/seed-master-wilayah-extra.mjs`
- `scripts/debug-parser-v3.ts`
- `scripts/verify-8g.ts`
- `scripts/verify-8h.ts`

## Doctor command

Jalankan:

```bash
npm run env:doctor
```

Expected result untuk local app yang sehat:

- runtime env OK
- project ref kebaca
- service role boleh missing kalau cuma butuh app/runtime/build

## Recovery note

Kalau `.env.local` ketimpa dan local app mendadak error, cek dulu apakah file itu masih punya dua runtime key di atas sebelum debug yang lain.
