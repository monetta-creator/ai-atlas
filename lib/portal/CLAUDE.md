# Portal access (keys, identity, budgets)

Per-person access keys and the identity resolver behind the key-gated half of the Atlas. Tiers: public (guest), keyholder (portal), admin. The dataset catalog, download route and query grammar are covered in `lib/datasets/CLAUDE.md`.

Full write-up: docs/data-portal.md

## Files
- `lib/portal/keys.ts`: pure key logic, tested by `scripts/test-portal-keys.mjs`. Exports `legacyCookieGrants`.
- `lib/portal/identity.ts`: the one resolver. `getPortalIdentity()` for pages/actions, `identityFromRequest(req)` for route handlers.
- `lib/portal/budget.ts`: shared and per-key daily budget checks.
- `lib/portal/views-core.ts`: pure saved-view rules.
- `lib/portal/nl-query.ts` + pure `lib/portal/nl-core.ts`: ask-for-data in words.
- `components/portal/RenewalNotice.tsx`: rendered by pages on a lapsed key.
- `/access` console (admin, `adminGate`): `components/access/*`, `lib/actions/portal.ts`, `lib/data/portal.ts`, `lib/mutations/portal.ts`.
- `datasets/request/page.tsx` (public request form), `datasets/enter/route.ts` (`?k=<key>` sets the portal cookie, lands on `/ask`; a lapsed key bounces to `/datasets?key=expired|revoked`), `app/api/portal/ask/route.ts`.

## Keys and identity
- Key format `atlas_<prefix8>_<secret32>`, HMAC-SHA256 under `AUTH_SECRET`, prefix lookup + `timingSafeEqual`. Shown ONCE at issuance.
- Identity sources: admin cookie, the `atlas_portal` cookie (`portal:<keyId>:<exp>`; legacy bare `portal` still valid), or a header (`Authorization: Bearer <key>` / `X-Atlas-Key`).
- The legacy `PORTAL_KEY` is accepted in the header so intake scripts need no cookie.
- `isPortal()` is AUTHORITATIVE: a DB lookup per request (React `cache()`), so revocation and expiry bite immediately.
- 401 bodies name the state (`key_expired` / `key_revoked` / `key_required`) with an `X-Atlas-Key-State` header. Pages render `RenewalNotice`.
- Reader-facing copy says "access key", never "team key".
- Tables (mig `0060`): `portal_keys`, `portal_access_requests`, `portal_usage` (one row per keyed pull, written in `after()`), plus an `ai_cost_log` index on `(metadata->>'portal_key_id', created_at)`.

## Request form and /access
- `POST /api/access/request` follows the tickets-route discipline: honeypot, per-IP limiter, caps, email regex, domain allow-list from `PORTAL_REQUEST_EMAIL_DOMAINS`. It returns 503 (closed) while that env is unset.
- A request creates a `portal_access_requests` row, a Resend email (`lib/email/resend.ts sendEmail`, shared with the agent brief), and the Admin desk badge `getNavCounts().access`.
- Email goes to `PORTAL_NOTIFY_TO`, then `AGENT_EMAIL_TO`, then `agent_prefs.email_to`; `AGENT_EMAIL_FROM` is reused.
- Agent findings: `access.requests_pending`, `access.keys_expiring`.
- `/access`: pending requests (Approve = issue prefilled, Decline), keys (renew = `greatest(expires_at, now()) + 90d`, budget, revoke), usage tail, per-key usage for 30 days (`getKeyUsageSummary`). `/costs` has a Portal-by-key table.

## Env and budgets
- `AUTH_SECRET` and `APP_BASE_URL` (magic link) are all a per-person key needs.
- `PORTAL_KEY`: optional legacy shared team key.
- `PORTAL_REQUEST_EMAIL_DOMAINS`: comma list of work-email domains; unset = form closed (503).
- `RESEND_API_KEY` + `PORTAL_NOTIFY_TO` for the notice email.
- `PORTAL_KEY_DEFAULT_DAYS` (90), `PORTAL_KEY_DAILY_BUDGET_USD` (0.25), `PORTAL_KEY_DAILY_MAX_CALLS` (60): seed each new key's limits.
- `PORTAL_DAILY_BUDGET_USD` (1.00) and `PORTAL_DAILY_MAX_CALLS` (200): cap the SHARED portal spend, reset at midnight UTC. Raise the shared cap once more than four keys are live.
- `INTEL_DECK_DAILY_BUDGET_USD` (0.10) caps the company intel deck's sentence leg.
- Per-key Ask spend = one indexed `ai_cost_log` sum over `metadata.portal_key_id`. Every portal `recordApiCall` stamps it, the lane classifier via `classifyMetadata`.
- `/api/portal/ask`: `maxDuration = 60`, Haiku, shared daily budget then the per-key one, guest-safe retrieval mode, feature slug `portal_ask`.

## Saved views
- Table `portal_views` (mig `0064`): owner key|legacy|admin, `spec` = the URL-param record, `is_shared` = Team views.
- Always re-validate `spec` with `parseFilterSpec` at save AND apply.
- Routes: `GET/POST /api/portal/views`, `PATCH/DELETE /api/portal/views/[id]` (owner or admin). A 404 never distinguishes existence.

## Ask for data in words
- `POST /api/portal/query/nl`, feature `portal_nl_query`, under both portal budgets. Model is `PORTAL_NL_MODEL` or the utility model.
- One structured call over a compact catalog returns `{ dataset, params }`. `validateNlOutput` coerces it through `parseFilterSpec`, dropping and LISTING every invalid part.
- Never SQL, never rows. The client then calls the datasets route.

## Landmines
- The legacy shared-key cookie is fingerprinted: `portal:legacy:<hmac(legacy:PORTAL_KEY)>` (`legacyCookieGrants`). Unsetting `PORTAL_KEY` logs every legacy holder out. Rotating it logs out everyone minted after the fingerprint change (bare old cookies age out within 30 days).
- Legacy-key guesses are throttled per hashed IP (`lib/rate-limit.ts`, 10 failures / 10 min, separate `form` and `hdr` buckets). A limited client gets the same "That key did not work." as a wrong key. Per-person `atlas_` keys never touch the limiter.
- Never add a public API route without a gate marker (`isAdmin(` / `cronGate(` / `identityFromRequest(` / `getPortalIdentity(` / `isPortal(`) or an entry in `scripts/test-api-gates.mjs`'s EXEMPT set with a reason.

## Tests
- `scripts/test-portal-keys.mjs`, `scripts/test-api-gates.mjs`
