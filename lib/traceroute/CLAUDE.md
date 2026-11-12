# Traceroute (3D explainer)

Public `/traceroute` explainer: four movements over ten camera stops, a three.js world scene per movement plus a silicon scene for the transformer stack, and a scripted autoregressive walkthrough (play/pause/step/scrub).

Full write-up: docs/traceroute.md

## Files
- `app/traceroute/page.tsx`: `force-dynamic`, no `maxDuration` (nothing here calls a model).
- Pure data modules in `lib/traceroute/*`: stops, props, architecture, runs, compiler, player, camera, geometry.
- Scene mutation lives only in module-scope functions under `lib/traceroute/scene-*.ts`.
- UI: `components/traceroute/*`. Styles scoped to `.tr` in `app/styles/traceroute.css`.
- `app/api/traceroute/tokenize/route.ts`: public, pure string processing over a length-capped input, not a model call. On the `proxy.ts` API allow-list.

## Rules
- `three@0.180`, used for `/traceroute` only. Scenes are described in data and built from primitives (no model assets, no loader).
- The canvas is `next/dynamic({ ssr: false })` behind a WebGL probe with an SVG fallback.
- Keep scene mutation out of React components (React Compiler lint rules); call module-scope functions from effects.
- Public surfaces must not trigger an Anthropic call. The one deliberate exception is the key-gated, budget-capped `/api/portal/ask`.

## Landmines
- `mergeGeometries` refuses to mix indexed and non-indexed inputs. `RoundedBoxGeometry` is non-indexed; `BoxGeometry`/`CylinderGeometry`/`TorusGeometry` are indexed. Normalise with `.toNonIndexed()` first. This failed silently once and dropped every detail feature on 20 objects.
- Core `LineDashedMaterial` has no `dashOffset` in 0.180.
