import { runStructured } from './dossier';
import type { Relation } from './types';

// Server-only. Recommend-only structured calls for the claim/bridge authoring
// forms — the admin confirms each suggestion in the form; nothing here writes
// (same gate philosophy as recommendConceptPrereqs/Claims). The proposer that
// argues for whole NEW nodes from recent evidence lives in lib/argument-gaps.ts.

const REL_ENUM: Relation[] = ['supports', 'contradicts', 'depends_on']; // organizes is frame-only

export interface ClaimEdgeRec {
  target_type: 'stance' | 'bridge_claim';
  code: string;
  relation: Relation;
  reason: string;
}

const CLAIM_EDGE_SYSTEM = `You wire a NEW claim into The AI Atlas argument map. Given the draft claim and the host question's stances (plus the map's bridge-claims), recommend which stances the claim bears on and how, and which bridge-claims it feeds.
- relation: supports (the claim is evidence FOR the stance / bridge), contradicts (evidence AGAINST), or depends_on (the stance's or bridge's truth hinges on the claim).
- A claim usually bears on 1 to 3 stances. Recommend only genuine bearings; omit weak or tangential ones. Bridge links are optional.
- reason: one concise sentence on where it bears.
Use only codes from the provided lists. You only RECOMMEND, the human confirms each edge. Never use an em dash; use a comma or a colon instead.`;

export async function recommendClaimEdges(
  draft: { statement: string; test: string },
  stances: { code: string; title: string }[],
  bridges: { code: string; statement: string }[]
): Promise<ClaimEdgeRec[]> {
  if (!stances.length && !bridges.length) return [];
  const stanceCodes = stances.map((s) => s.code);
  const bridgeCodes = bridges.map((b) => b.code);
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      recommendations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            target_type: { type: 'string', enum: ['stance', 'bridge_claim'] },
            code: { type: 'string', enum: [...stanceCodes, ...bridgeCodes] },
            relation: { type: 'string', enum: REL_ENUM },
            reason: { type: 'string' },
          },
          required: ['target_type', 'code', 'relation', 'reason'],
        },
      },
    },
    required: ['recommendations'],
  };
  const stanceList = stances.map((s) => `[${s.code}] STANCE: ${s.title}`).join('\n');
  const bridgeList = bridges.map((b) => `[${b.code}] BRIDGE: ${b.statement}`).join('\n');
  const out = await runStructured<{ recommendations: ClaimEdgeRec[] }>({
    system: CLAIM_EDGE_SYSTEM,
    user: `NEW CLAIM:\n${draft.statement}\nTEST: ${draft.test || '(none yet)'}\n\nSTANCES:\n${stanceList || '(none)'}\n\nBRIDGE-CLAIMS:\n${bridgeList || '(none)'}`,
    toolName: 'submit_edges',
    toolDescription: 'Return recommended edges for the new claim.',
    schema,
    maxTokens: 1500,
    effort: 'medium',
    feature: 'claim_edges',
  });
  const stanceSet = new Set(stanceCodes);
  const bridgeSet = new Set(bridgeCodes);
  const seen = new Set<string>();
  return (out.recommendations ?? []).flatMap((r) => {
    const tt = r.target_type === 'stance' || r.target_type === 'bridge_claim' ? r.target_type : null;
    if (!tt) return [];
    const ok = tt === 'stance' ? stanceSet.has(r.code) : bridgeSet.has(r.code);
    if (!ok || !REL_ENUM.includes(r.relation)) return [];
    const key = `${tt}:${r.code}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ target_type: tt, code: r.code, relation: r.relation, reason: String(r.reason ?? '') }];
  });
}

export interface BridgeFeederRec {
  code: string;
  relation: Relation;
  reason: string;
}

const BRIDGE_FEEDER_SYSTEM = `You wire a NEW bridge-claim into The AI Atlas argument map. A bridge-claim links two domains; it is FED by claims whose truth bears on it. Given the draft bridge-claim and the map's claims, recommend which claims feed it and how (supports / contradicts / depends_on). Usually 1 to 4. Recommend only genuine bearings. reason: one concise sentence. Use only codes from the provided list. You only RECOMMEND, the human confirms each. Never use an em dash; use a comma or a colon instead.`;

export async function recommendBridgeFeeders(
  draft: { statement: string; test: string },
  claims: { code: string; statement: string }[]
): Promise<BridgeFeederRec[]> {
  if (!claims.length) return [];
  const codes = claims.map((c) => c.code);
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      recommendations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            code: { type: 'string', enum: codes },
            relation: { type: 'string', enum: REL_ENUM },
            reason: { type: 'string' },
          },
          required: ['code', 'relation', 'reason'],
        },
      },
    },
    required: ['recommendations'],
  };
  const list = claims.map((c) => `[${c.code}] ${c.statement}`).join('\n');
  const out = await runStructured<{ recommendations: BridgeFeederRec[] }>({
    system: BRIDGE_FEEDER_SYSTEM,
    user: `NEW BRIDGE-CLAIM:\n${draft.statement}\nTEST: ${draft.test || '(none yet)'}\n\nCLAIMS:\n${list}`,
    toolName: 'submit_feeders',
    toolDescription: 'Return recommended feeding claims for the new bridge-claim.',
    schema,
    maxTokens: 1500,
    effort: 'medium',
    feature: 'bridge_feeders',
  });
  const valid = new Set(codes);
  const seen = new Set<string>();
  return (out.recommendations ?? []).flatMap((r) => {
    if (!valid.has(r.code) || !REL_ENUM.includes(r.relation) || seen.has(r.code)) return [];
    seen.add(r.code);
    return [{ code: r.code, relation: r.relation, reason: String(r.reason ?? '') }];
  });
}
