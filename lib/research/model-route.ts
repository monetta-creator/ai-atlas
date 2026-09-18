// Shared model dispatcher for the research subsystem's three model features
// (triage, queue agent, analysis): the scan's dual-provider pattern
// (lib/scan/enrich.ts) applied once instead of three times. `model` is either
// null/empty (the Haiku fallback), an Anthropic id (any `claude-*` id, or an
// entry flagged `anthropic: true` in SCAN_ENRICH_MODELS) routed through
// runStructured's forced-tool path, or an OpenRouter id routed through
// chatJSONOpenRouter as a JSON-object completion with the same system/user
// text plus an explicit only-JSON instruction. Callers keep authoring their
// own system/user/schema exactly as before runStructured; only the model
// selection and provider branch move here.
//
// Promoted to lib/model-route.ts (as routedStructured) when the tooling
// monitor needed the same dispatcher: this file is now a thin re-export shim
// so research's existing imports (researchStructured) keep working unchanged.

export { routedStructured as researchStructured, resolvedModel } from '../model-route';
