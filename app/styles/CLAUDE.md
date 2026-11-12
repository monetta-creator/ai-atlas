# Console design system (app/styles)

The visual language lives in `app/styles/*.css`; the stylesheets are the contract.

## Cascade
- Imported IN ORDER from `app/globals.css`, which then re-bases the `@theme` color tokens onto the design vars and re-asserts the plotting-grid body background.
- Order: `tokens`, `base`, `components` (shared controls), then one sheet per surface (`signal-board`, `sitenav`, `concepts`, `supply-chain`, `ask`, `lobby`, `rail`, `showcase`, `feedback`, `paper-reader`), then `home` (the `.bs` broadsheet layer), `traceroute` (scoped to `.tr`), `costs-deck` (`.cdk-*` 16:9 deck stage), `education` (scoped to `.edu`), `tooling` (`.tl-*`), `reports` (`.rp-*`).
- The import ORDER is the cascade. Register a new surface sheet in `globals.css` at its cascade position.
- Tailwind v4 is CSS-first (`@import "tailwindcss"` + `@theme`); there is no `tailwind.config`.
