# Glossary: AI Atlas → Strategy Atlas

For reading old commits, old docs, and any code not yet renamed. "Dropped" means the
concept has no successor.

| AI Atlas term | Strategy Atlas term | Notes |
|---|---|---|
| AI Atlas | Strategy Atlas | The product. |
| Thesis (`theses`) | **Hypothesis** | Promoted to the top-level unit; gains a `test` and gated conviction. D-005/D-016. |
| Claim | absorbed into **Hypothesis** | One tier of belief-objects (D-016); a load-bearing sub-statement becomes its own narrower hypothesis. |
| Confidence (on claims/theses) | **Conviction** (on hypotheses) | D-017. Same gated 0..1 + words + rationale + snapshot mechanics, new name. |
| (new) | **Confidence** (on evidence links) | D-017. low/medium/high weight of an item bearing on a hypothesis. CAUTION: "confidence" in old commits means the node-level number, i.e. today's conviction. |
| Stance | dropped | D-004. |
| Bridge claim | dropped | D-004. |
| Frame (claim with `is_frame`) | dropped | Organizing-only nodes; die with the stance layer and the claims tier (D-016). |
| Question | dropped in v0 | Hypotheses are flat (D-013); a tag/theme column is the future grouping move if needed. |
| Signal | Signal | Kept; primary axis becomes **internal / external context** instead of audience lens. |
| Audience lens (`signal_lens_t`: market/labor/...) | replaced by context axis | Secondary tags TBD, OQ-4. |
| Map lens (`lens_t`, node_lenses) | dropped unless OQ-4 revives tagging | |
| Evidence | Evidence | Kept; the link now carries **confidence** + direction + note (D-014/D-017). |
| Reliability prior (on source) | kept | Distinct from evidence confidence: prior is about the source, confidence about the link. |
| Discovery pipeline | **Intake pipeline** | Web-discovery leg dead; triage→analyze→draft→publish spine kept for artifacts. D-002/003. |
| Turn into signal | kept | The manual source→candidate→draft path is now the main road, not the side door. |
| Startup Scout | dropped | D-011 (resurrectable webless if the company wants a target funnel; see OQ-8). |
| Research portal / papers | (OQ-6) | arXiv-dependent as built. |
| Concepts scaffold | (OQ-9) | Could become internal-strategy vocabulary; content is AI-specific today. |
| The human gate | The human gate | Unchanged, load-bearing, non-negotiable. |
| Guest / share view | kept v0 | Colleague access model is OQ-7. |
| Signal Board | Signal Board | Kept. |
| Blotter / Lobby / Ask / Reports / Calibration / Costs / Tickets | kept | Copy re-themed from "AI economy" to strategy. |
| Traceroute (3D explainer) | (OQ-10) | AI-pedagogy content; likely dropped as off-mission, big dependency (`three`). |
| Supabase | plain Postgres | Any Postgres reachable by `DATABASE_URL`; RUNBOOK ladder. D-007. |
| Vercel / maxDuration | `next start` on a Node host | D-008. |
