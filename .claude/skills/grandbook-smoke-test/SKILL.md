---
name: grandbook-smoke-test
description: GrandBook autonomous smoke test via Playwright MCP. Use after `git push` ke main, atau setelah Vercel deploy ready, untuk verify perubahan masih working live. Triggers on terms like "smoke test", "verify deploy", "live test", "Playwright", "browser test". Encodes test account session usage, deploy wait pattern, screenshot capture, and reporting format. Required before claim "done" untuk perubahan UI/RPC.
---

# GrandBook Smoke Test Pattern

## Prerequisites

- **Playwright MCP server** registered di Claude Code (see Setup di bawah)
- **Session files** ada di `tests/auth/`:
  - `owner-session.json` (Barry — barry@owner.com)
  - `indra-session.json` (admin Indra)
  - Tambah role lain kalau perlu (cs/advertiser/akunting)

## Setup (one-time)

### 1. Install Playwright MCP server

Tambah ke Claude Code Settings → MCP servers:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest", "--storage-state=<storage-state-path>"]
    }
  }
}
```

Atau pakai CLI:
```bash
claude mcp add playwright npx @playwright/mcp@latest
```

### 2. Capture session files

```bash
npm run capture-session -- owner barry@owner.com 'GrandBook2026!'
npm run capture-session -- indra indra@mbc.com '<PASSWORD>'
```

Script di `scripts/capture-session.mjs` open browser headed, login, save `storageState()` ke `tests/auth/<slot>-session.json`. **File ini gitignored** — kredensial Barry tidak ke-commit.

## Smoke Test Loop (post-push autonomous)

```
git push origin main
       ↓
sleep 90s (Vercel build)
       ↓
verify deploy live:
  curl -sI https://grandbook-app.vercel.app/<route> | grep x-vercel-id
       ↓
Playwright MCP:
  - Load session storageState
  - Navigate ke /<route>
  - Verify expected element present (find / read_page)
  - Screenshot 3-5 step
  - Test critical interaction (form submit / click → verify side effect)
       ↓
Report PASS/FAIL dengan format ke Barry
```

## Triggers Wajib

Run smoke test SECARA OTOMATIS setelah:

- `git push` ke main branch (Vercel auto-deploy)
- Migration applied via Supabase MCP (kalau schema-affecting)
- RPC change
- Sidebar/permission update

## Scope per Feature Type

| Feature | Test what |
|---|---|
| New page | Page loads, role gating, key elements visible |
| New RPC | Data render correctly di UI (bukan cuma SQL) |
| Sidebar/nav | Login per role, verify entries visible/hidden |
| Form/dialog | Submit dummy → toast / redirect / DB update |
| Reconciliation | Upload sample (tests/fixtures/) → preview only, JANGAN apply |
| Destructive op | NEVER, ask Barry manual |

## Reporting Format Wajib

```markdown
## ✅/❌ Patch SHA <sha> — Smoke Test Result

**Feature:** <feature name>
**Deployed:** https://grandbook-app.vercel.app/<route>

### Tests Run
| Test | Result |
|---|---|
| Page loads (HTTP 200) | ✅/❌ |
| Login redirect role-aware | ✅/❌ |
| Critical interaction works | ✅/❌ |
| Side effect verified (toast/redirect/DB) | ✅/❌ |

### Screenshots
- tests/screenshots/<feature>-<timestamp>-1.png — initial state
- tests/screenshots/<feature>-<timestamp>-2.png — after action

### Next Action
- [ ] Barry approve OR specify issue
```

## Hard Constraints

NEVER:
- Smoke test `/settings/reset-data`
- Click Apply pada reconciliation tanpa approval
- Test destructive op pakai prod data
- Skip smoke test untuk save time
- Claim "done" tanpa screenshot evidence

MUST:
- Screenshot per major step (3-5 typical)
- Report fail dengan reproducible steps (URL, action, expected vs actual)
- Run even untuk perubahan "kecil"

## On Failure

1. Capture failure screenshot
2. Read DOM accessibility tree at fail point
3. Cek browser console (warnings/errors)
4. Propose hypothesis
5. Ask Barry: "Fail at step X. Hypothesis: <reason>. Proposed fix: <code change>. OK to apply?"
6. Don't auto-fix without approval (kecuali Pre-Approval categories di CLAUDE.md)

## Common Snippets

### Navigate + verify role badge

```js
// Pseudo-code via Playwright MCP
await browser.navigate('https://grandbook-app.vercel.app/orders/draft')
await browser.find('Antrian Kerja heading')  // expect found
await browser.find('Barry · Owner avatar')   // expect role visible
await browser.read_page({ filter: 'interactive' }) // grab clickable elements
```

### Submit form + verify toast

```js
await browser.fill('input[placeholder*="Cari"]', 'Andi Darmawan')
await browser.click('button:has-text("Search")')
await browser.find('Andi Darmawan in table')  // expect filtered
```

### Reconciliation preview

```js
await browser.navigate('/reconciliation/spx')
await browser.file_upload('tests/fixtures/spx-sample.xlsx')
await browser.click('button:has-text("Preview")')
await browser.find('matched_count > 0')
// STOP here. Tidak klik "Apply".
```

## Test Fixtures

`tests/fixtures/` (TBD) — sample XLSX/CSV untuk reconciliation testing. Bikin saat butuh:
- `spx-financial-sample.xlsx` (50 row sample dari Phase 8I)
- `spx-cashflow-sample.xlsx` (Phase 8I-v2)
- `orderonline-sample.csv` (Phase 8F bulk-upload)

Jangan commit data real customer — anonymize atau pakai placeholder.
