import { buildAskContext, loadNamespace, type AskContext, type AskMode, type AskNamespace } from '@/lib/ask/retrieve';
import { classifyQuestion, type ClassifyResult } from '@/lib/ask/classify';
import {
  beatDescriptionFrom, composeDecline, decideLane, priorUserTurn, questionLinksFrom,
  type DeclinePayload, type Lane,
} from '@/lib/ask/lanes';
import { retrievalQuery, type AskWireMessage } from '@/lib/ask/history';
import { EXAMPLE_QUESTIONS } from '@/components/ask/starters';

// The one lane resolution for the three Ask routes (/api/ask, /api/portal/ask,
// /api/ask/deep): namespace, retrieval and the classifier run together, then
// decideLane (lib/ask/lanes.ts, where the records-win rule is documented)
// turns their signals into a lane. Server-only: it pulls lib/db through
// retrieve.ts, so never import it from lanes.ts or a client component.
//
// Auto web: a thin/adjacent question that hinges on recent events searches
// even with the composer's toggle off; covered questions never need it.

export interface ResolvedLane {
  ns: AskNamespace;
  ctx: AskContext;
  cls: ClassifyResult;
  lane: Lane;
  autoWeb: boolean;
  // Set only for the unrelated lane: the coded decline, no model call, no cost row.
  decline: DeclinePayload | null;
}

export async function resolveLane(
  msgs: AskWireMessage[],
  opts: { mode: AskMode; tagStart?: number; classifyFeature?: string; classifyMetadata?: Record<string, unknown> },
): Promise<ResolvedLane> {
  const ns = await loadNamespace();
  const latest = msgs[msgs.length - 1].content;
  const [ctx, cls] = await Promise.all([
    buildAskContext(retrievalQuery(msgs), {
      mode: opts.mode, ns,
      // Passed only when the caller has one: the deep route mints its own tags.
      ...(opts.tagStart === undefined ? {} : { tagStart: opts.tagStart }),
    }),
    classifyQuestion(latest, beatDescriptionFrom(ns), priorUserTurn(msgs), opts.classifyFeature, opts.classifyMetadata),
  ]);
  const lane = decideLane({
    hitCount: ctx.hitCount, maxRank: ctx.maxRank, maxSim: ctx.maxSim, explicit: ctx.explicit,
    beat: cls.beat, followUp: msgs.length > 1,
  });
  const autoWeb = cls.fresh && lane !== 'covered';
  const decline = lane === 'unrelated'
    ? composeDecline(cls.topic, questionLinksFrom(ns), EXAMPLE_QUESTIONS)
    : null;
  return { ns, ctx, cls, lane, autoWeb, decline };
}

// The two quick routes' lane headers: the lane for the client's chip, and the
// per-request signal tag -> uuid map so [signal Sn] citations resolve client-side.
export function laneHeaders(lane: Lane, signalRefs: { tag: string; id: string }[]): Record<string, string> {
  return {
    'X-Ask-Lane': lane,
    'X-Ask-Signals': JSON.stringify(Object.fromEntries(signalRefs.map((r) => [r.tag, r.id]))),
  };
}
