# Ad Spend completeness candidate

No push/deploy or SQL activation is part of this candidate. Production financial
records, tax rates, allocation rules, permissions and existing writer payloads
are preserved. Only the Ad Spend reader and page are application changes.

The reader uses normal Supabase sessions/RLS, unique ascending ID keysets and
batches of at most 500. Each remaining-result exact count, identity ordering,
terminal empty response and final full-scope count must agree. A short page is
not a completion signal. Platform filtering follows the complete scoped read;
date/source/campaign filters apply to every request. Display order is descending
date, creation time and ID. The existing common reader rejects scopes above
100,000 rows explicitly; it never reports capped totals as complete.

Header, Total Spend, Lead, CPR and unique-campaign count use the identical
complete period/platform/source result. The existing KPI basis is retained:
`spend_total ?? spend`, including only tax already recorded on each entry.
The header now labels that basis. No new tax default is applied. The table shows
50 entries per page, with totals over all matching entries.

Campaign profit remains a separate existing RPC and its business calculations
are untouched. The top profit card moves into the Performa tab; the fourth scoped
card becomes unique campaign count. Performance follows period/platform and all
sources. Selecting a source withholds campaign-profit figures with an explanation
because the existing RPC has no source dimension. RPC errors, missing/partial
counts and invalid values show an independent error; they do not blank valid
spend totals. Spend errors hide partial/previous rows and totals and offer retry.
Existing shared abort/sequence/auth-key/90-second timeout protection is reused.

## Reproduce

Use an isolated package prepared by `scripts/releases/repo-readiness/release.py`
and the project's installed dependencies. Set `GRANDBOOK_ADS_APP` to its absolute
application directory and `GRANDBOOK_ADS_PROOF` to a private JSON output path,
then run `tests/ad-spend-completeness/read.test.ts` with the installed `tsx`.
The test substitutes HTTP transport only and exercises the actual Supabase
client and application helper. All data are synthetic.

Build the isolated application with its normal environment kept outside Git;
run a server bound only to `127.0.0.1`. For the browser suite, set
`GRANDBOOK_ADS_REVIEW` to the private folder containing `app/`,
`GRANDBOOK_ADS_BASE` to its explicit loopback URL and `GRANDBOOK_ADS_SESSION`
to a private, current normal-session JSON containing `session`. Run
`node tests/ad-spend-completeness/browser.cjs`. Middleware uses the normal session;
all browser business responses are synthetic and all unexpected external
requests/writes are rejected. No credentials or customer rows enter Git.

Evidence JSON records the actual checks and environment. The real normal-Owner
reader comparison is separate from the synthetic built-browser test. Production
UI/publication and physical iPhone behavior are not verified for this candidate.
Keyset/count guards detect many concurrent changes, but do not provide a
transaction-wide snapshot or prove absence of simultaneous same-count edits.
