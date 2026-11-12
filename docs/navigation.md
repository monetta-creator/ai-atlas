# Navigation and page tops

Spans `lib/nav.ts`, `components/*` and `app/layout.tsx`, so it lives here instead of a directory CLAUDE.md.

## The tree
- `lib/nav.ts` is the ONE navigation tree: `NAV_TREE` (portals) + `NAV_ISLAND` (About / Admin desk).
- Leaves carry `access` (public / portal / admin), badges, and `also` prefixes.
- Helpers: `groupFor`, `leafFor`, `tabsFor`, `pathwayFor`, `publicParentFor`.
- Three surfaces read it: the rail, the mobile sheet, the page top.

## Rail and sheet
- Rail: `PortalRail`, 56px icons, expands to 264px on hover/focus/pin. It renders `railEntries()`: Home, ONE `Portals` folder, then Education and Ask.
- The `Portals` accordion lists every portal hub from `PORTAL_GROUP_KEYS` (signals, blotter, savant, map, reports, datasets, research, scout, tooling). A portal's sub-pages are the page's tabs, never rail rows.
- An "All portals" row opens `/portals`, the directory page over the same list.
- The island's About and Admin desk stay leaf accordions. Admin leaves are hidden from guests.
- Mobile sheet: `SiteNav`, the same entries as `<details>`.
- The header's Admin dropdown is a slim account menu (Edit mode, Preview as guest, Share link, Copy showcase link, Sign out).

## Chrome renders ONCE
- `app/layout.tsx` renders `<ChromeGate><Header /></ChromeGate>`, so rail and bar persist across client navigation. Pages must NOT render `<Header>`.
- `ChromeGate` (client) hides it on the routes in `isChromeless()` (`lib/nav.ts`: /login, /showcase, the deck stages, the print digests). `app/loading.tsx` covers only the content area.
- The layout does not re-render on client navigation, so the chrome stays current three ways:
  - Cookie-setting server actions (login, logout, preview/edit toggles, portal unlock) and every `revalidatePath` re-render it.
  - Badge counts refetch per navigation from the admin-only `GET /api/nav/counts`. `lib/nav-counts-client.ts` is a thin hook over `createNavCountsStore` in the React-free `lib/nav-counts-store.ts`: one store shared by rail and sheet, with a `fetchedFor` guard so a late fetch never overwrites fresher server counts.
  - `ViewerSync` asks the public `GET /api/nav/viewer` (on the proxy allow-list; returns only the caller's own flags from `getChromeViewer()` in `lib/chrome-viewer.ts`) on tab focus and `router.refresh()`es when the session changed in another tab. A 401 or redirected response from the counts or agent-pulse polls does the same through ONE path: `sessionLost` + `refreshChromeOnce` in `lib/chrome-session-client.ts` (once-per-pathname guard, `claimChromeRefresh`).
- The rail opens the new group's accordion when the active group changes and drops hover expansion on navigation unless the pointer is still over it.
- The mobile sheet and agent drawer close on navigation. Reset-on-navigation blocks use `useValueChange` / `usePathnameChange` from `lib/use-route-change.ts`, never a stored previous-path copy.
- The `/ask` and lobby 100dvh shells are `body:has(> .ask-page)` / `body:has(> .lobby-page)` flex columns.

## PageTop (`components/PageTop.tsx`)
- The one page-top grammar: pathway row (mono, linked segments, a round "i" at the right edge opening `PageInfo` with the entry from `lib/page-info.ts`), title row (an Editable h1 or a string, optional right-aligned action), the group's tabs when the viewer sees 2+ sibling leaves (badges from `getNavCounts`), an optional mono status line, then a hairline.
- No lede: the sentence lives in the info dialog's summary. Only `.lede` survives, for the login card.
- Page-info registry is split into `lib/page-info-{a,b,c}.ts` slices merged in `lib/page-info.ts`.
- Read views pass `title={null}` so the body keeps its own h1.

## Admin gating and proxy
- Admin pages call `adminGate(pathname, title)` (`lib/admin-gate.tsx`) as their first await and `return` the `AdminOnly` notice it yields for non-admins (a plate with "Back to <public parent>" via `publicParentFor`).
- The four Header-less deck/print pages redirect to the public parent instead.
- `proxy.ts` is open by default: every page renders sessionless and gates itself.
- The proxy only fences API routes outside its allow-list (`/api/datasets/`, `/api/portal/ask`, `/api/ask/peek`, `/api/ask/doc`, `/api/tooling/events`, `/api/nav/viewer`, `/api/tickets`, `/api/traceroute/tokenize`, `/api/cron/`).
- It rewrites malformed detail URLs to a 404 (`lib/route-shapes.ts`; the blotter day pages reuse its `isRealDay`).

## Tests
- `scripts/test-nav.mjs`, `scripts/test-route-shapes.mjs`, `scripts/test-nav-counts-store.mjs`.
