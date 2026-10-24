# Buku Order export candidate — 25 October 2026 WIB

The old exporter downloaded only the current page (50 rows by default), despite
comments claiming it had all filtered rows. This candidate exports the complete
existing normal-session `list_pembukuan` reader result or selected compound
`source:id` identities. It does not write business records or change calculations.

## Behavior

- `Semua hasil filter`: date range or all time, status, search and zone, across
  all pages. Pagination/page size do not restrict export.
- `Baris dipilih`: check individual rows or the current page, navigate pages,
  then export exactly the chosen identities using freshly read values. Filter
  changes clear selection. Missing/no-longer-matching choices reject the file.
- Progress and cancellation during reads; concurrent exports and scope changes
  are disabled while reading. Navigation/auth/scope changes abort active reads.
- Existing attribution, numeric financial values, decimal precision, leading-zero
  identifiers, real Excel TOTAL formulas and unknown-value blanks are preserved.
  CSV contains values; it is not a formula workbook.
- Zone chips show counts for the loaded page. An empty zone on that page still
  allows navigation and export of matching orders on other pages.

## Complete reading

The existing SQL reader accepts `p_limit: null` / `p_offset: 0`. PostgREST then
orders the full result by `order_date DESC NULLS LAST, id DESC, source ASC`,
including the source tie-breaker missing from the function's internal ordering.
HTTP ranges request at most 500 rows, independent of the normal 1000-row cap.
Adjacent ranges overlap by one row. The collector validates exact `total_count`,
compound identity uniqueness, overlap equality, terminal emptiness, and a final
leading-row recheck. Short responses advance by actual rows received. Errors,
drift, duplicate/missing rows and cancellation never produce a partial download.

This is not a transaction-wide database snapshot. Count/head/boundary guards
cannot prove absence of every concurrent same-count edit. Large exports take
time and browser memory. Excel's native per-sheet capacity is checked explicitly;
excess rows are rejected with a CSV/narrower-filter suggestion, never truncated.

## Reproduce

Use an isolated package built from the reviewed manifest with its normal bundled
dependencies. Set `GRANDBOOK_EXPORT_APP` to its absolute app directory, change
directory there, then run its `node_modules/.bin/tsx` against the absolute path
to `tests/orders/pembukuan-export.test.ts`.

For the browser suite, start that built app on loopback only. Set
`GRANDBOOK_EXPORT_REVIEW` to the private parent of `app`,
`GRANDBOOK_EXPORT_BASE` to `http://127.0.0.1:55536`, and
`GRANDBOOK_EXPORT_SESSION` to a private normal-session cache file, then run
`node tests/orders/pembukuan-export.browser.cjs` from the repository.
The suite intercepts business responses with synthetic fixtures, rejects
unexpected remote requests, and never performs live business writes. Keep its
downloads/screenshots/evidence private. No credentials or customer rows belong
in Git or this document.

No SQL activation/recovery replay is required. No push/deploy is performed by
these tests. Main and Liard remain separate.
