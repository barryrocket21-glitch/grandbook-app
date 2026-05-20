# Session State Storage

Storage Playwright JSON state untuk smoke test auto-login. Files di folder ini **gitignored** (kecuali README.md ini) — kredensial Barry/Indra TIDAK boleh ke-commit.

## Cara capture session

```bash
# Owner
npm run capture-session -- owner barry@owner.com 'GrandBook2026!'

# Indra (admin)
npm run capture-session -- indra indra@mbc.com 'INDRA_PASSWORD_HERE'
```

Script `scripts/capture-session.mjs` akan:
1. Launch browser (headed mode)
2. Navigate ke `https://grandbook-app.vercel.app/login`
3. Fill credentials + click login
4. Wait redirect ke role-specific landing
5. Save `storageState()` (cookies + localStorage) ke `tests/auth/<name>-session.json`

## Pakai di smoke test

```js
// playwright.config.ts atau test file
await context.storageState({ path: 'tests/auth/owner-session.json' })
// Atau pass --storage-state ke Playwright MCP server (see grandbook-smoke-test skill)
```

## Refresh

Session expire ~7 hari (Supabase JWT TTL). Re-run capture command kalau smoke test mulai gagal di login redirect.
