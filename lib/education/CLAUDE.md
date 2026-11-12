# Education hub

Public shelf of hand-kept guides ("not a feed, a shelf"), converted to house style as code. No DB table, no upload flow.

## Files
- `lib/education/registry.ts`: `GuideMeta` + `GUIDES`, drives the hub.
- `app/education/page.tsx`: hub, `.qgrid` cards + `Editable` `education.hub.*` keys.
- `app/education/[slug]/page.tsx`: dispatches to a per-guide body component under `components/education/<slug>/`. Current guide: `agentic-harnesses` (two client islands for the clickable spectrum grid + loop toggle, the rest server JSX).
- Styles `.edu-*` in `app/styles/education.css`; guide-local `--edu-*` palette with a dark block.

## Decks
- Every guide can ship a 16:9 deck: `lib/education/decks.ts` maps slug to a `CostDeck` builder in `lib/education/decks/<slug>.ts` (static editorial copy).
- Served by `education/[slug]/deck` (the `DeckController` stage, public unlike `/costs/deck`) and `.../deck/pdf` (960x540, `renderCostDeckPdf`).
- The pdf route must be in `next.config.ts` `outputFileTracingIncludes`, or fonts 500 in prod.
- Deck slide model has a generic `bullets` kind (`lib/costs-deck.ts` + both renderers).

## Nav
- A top-level rail link (mortarboard `NAV_ICONS.education`) plus a mobile `SiteNav` link.
- Deliberately NOT in `PORTALS`: that would auto-add a lobby tile.

## Adding a guide
Body component + registry entry + optional deck builder.
