import { after } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { priceUsage, recordApiCall } from '@/lib/cost';
import { deDash } from '@/lib/voice';
import { splitBeyond } from '@/lib/ask/lanes';
import { resolveLane } from '@/lib/ask/resolve-lane';
import { clampHistory, clampSignalOffset, parseAskBody } from '@/lib/ask/history';
import { fieldReportContextBlock } from '@/lib/field-report/followup';
import { createTagger, parseSignalMap, runDeterministicChecks, STATUS_START, STATUS_VERIFYING, type VerifyReport } from '@/lib/ask/deep';
import { runLoop, toApiUsage } from '@/lib/ask/loop';
import { v2FinalInstruction, v2Messages, v2System, type V2PromptOpts } from '@/lib/ask/prompt-v2';
import { verifyV2 } from '@/lib/ask/verify-v2';
import { nd, type V2Decision, type V2Event } from '@/lib/ask/v2-events';
import { askBudget } from '@/lib/ask/budget';
import { budgetVerdict } from '@/lib/ask/budget-policy';
import { decide } from '@/lib/decide';
import { anthropicAdapter } from '@/lib/llm/anthropic';
import { openrouterAdapter } from '@/lib/llm/openrouter-adapter';
import { estimateTurnUsd, getModel, TIER_DEFAULT, type Tier } from '@/lib/llm/models';
import { runTool, toolSpecs } from '@/lib/tools/registry';
import { webSearchTool } from '@/lib/tools/web';
import type { Identity } from '@/lib/tools/types';
import type { WebSource } from '@/lib/llm/types';
import { checkKeyBudget, checkPortalBudget, PORTAL_FEATURE } from '@/lib/portal/budget';
import { helpText, parseInvocation, rosterForPrompt } from '@/lib/capabilities/registry';
import { nextChips } from '@/lib/ask/chips';
import { identityFromRequest, touchKey } from '@/lib/portal/identity';

// The one chat box, v2 (redo Phase 1). Beside /api/ask/deep, which stays the
// default until the morning comparison. One identity-scoped route:
//   admin     full tool set, the monthly chat budget (lib/ask/budget.ts)
//   keyholder portal-scoped tools, the portal's daily + per-key caps
//   guest     401
// Body: { query | messages, model: 'auto' | <catalog id>, web?, signalOffset?,
// signalMap?, fieldReportIds? }. Auto runs the decider (lib/decide) for tier,
// web, clarify and depth; a manual pick still gets the decider's
// recommendation for the chip. The answer comes from the provider-agnostic
// loop (lib/ask/loop.ts) over the tool registry, then the two-layer verifier.
// NDJSON protocol: lib/ask/v2-events.ts.
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const DEADLINE_MS = 280_000;
const FINAL_RESERVE_MS = 60_000;
const NDJSON_HEADERS = { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' };

export async function POST(req: Request): Promise<Response> {
  // Identity. Admin first (the signed cookie), else a portal key.
  let identity: Identity;
  let keyId: string | null = null;
  if (await isAdmin()) identity = { kind: 'admin' };
  else {
    const pid = await identityFromRequest(req);
    if (!pid.active || pid.tier === 'none') return new Response('Unauthorized', { status: 401 });
    keyId = pid.tier === 'key' ? pid.keyId : null;
    identity = { kind: 'keyholder', keyId: keyId ?? 'legacy' };
  }
  const admin = identity.kind === 'admin';

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    // fall through to the empty-body guard
  }
  const parsed = parseAskBody(body);
  if (!parsed) return new Response('Empty query', { status: 400 });
  const b = (body ?? {}) as { model?: unknown; web?: unknown; signalOffset?: unknown; signalMap?: unknown; fieldReportIds?: unknown };
  const requested = typeof b.model === 'string' && b.model !== 'auto' ? b.model : 'auto';
  const picked = requested === 'auto' ? null : getModel(requested);
  if (requested !== 'auto' && (!picked || !picked.roles.includes('answer'))) return new Response('Unknown model', { status: 400 });
  const webToggle = b.web === true;
  const msgs = clampHistory(parsed).map((m) => ({ ...m }));
  const audience = admin ? 'admin' : 'keyholder';

  // /skill and @agent invocations. Model-free ones (/help, an unknown name,
  // an agent pointer) answer at once from the registry; a skill rewrites the
  // turn to its arguments and carries its recipe into the loop.
  const inv = parseInvocation(msgs[msgs.length - 1].content, audience);
  if (inv && (inv.kind !== 'skill' || inv.skill.slug === 'help')) return modelFreeTurn(inv, audience);
  const skill = inv?.kind === 'skill' ? inv.skill : null;
  if (inv?.kind === 'skill') msgs[msgs.length - 1].content = inv.args || inv.skill.title;
  const tagger = createTagger(parseSignalMap(b.signalMap), clampSignalOffset(b.signalOffset));

  // Keyholders pay from the portal's budgets, metered under its slug.
  if (!admin) {
    const day = await checkPortalBudget();
    if (!day.ok) return new Response('The Atlas has reached its daily budget for keyholders. It resets at midnight UTC.', { status: 429 });
    if (keyId) {
      const own = await checkKeyBudget(keyId);
      if (!own.ok) return new Response('Your access key has reached its daily Ask budget. It resets at midnight UTC.', { status: 429 });
    }
  }
  const feature = admin ? 'ask_answer' : PORTAL_FEATURE;
  const metadata: Record<string, unknown> = { v2: true, ...(keyId ? { portal_key_id: keyId } : {}) };

  const t0 = Date.now();
  const latest = msgs[msgs.length - 1].content;
  const prevUser = [...msgs].slice(0, -1).reverse().find((m) => m.role === 'user')?.content;

  const [resolved, reportBlock, budget] = await Promise.all([
    resolveLane(msgs, { mode: admin ? 'admin' : 'portal' }),
    fieldReportContextBlock(b.fieldReportIds, { admin, keyId }),
    admin ? askBudget() : Promise.resolve({ spentUsd: 0, capUsd: Number.POSITIVE_INFINITY }),
  ]);
  const { ns, ctx, cls, autoWeb } = resolved;
  // An explicit /skill is never declined as off-topic (its arguments can be
  // empty, as in /status).
  const lane = skill && resolved.lane === 'unrelated' ? 'covered' : reportBlock && resolved.lane === 'unrelated' ? 'thin' : resolved.lane;
  const decline = reportBlock || skill ? null : resolved.decline;

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: V2Event) => {
        try {
          controller.enqueue(enc.encode(nd(e)));
        } catch {
          // client gone
        }
      };
      const signals = () => Object.fromEntries(tagger.refs().map((r) => [r.tag, r.id]));
      emit({ type: 'lane', lane, reason: `beat ${cls.beat}${cls.fresh ? ', recent-events question' : ''}, ${ctx.hitCount} records matched, best rank ${ctx.maxRank.toFixed(3)}` });
      if (skill) emit({ type: 'skill', slug: skill.slug, title: skill.title, kind: 'skill' });
      if (decline) {
        emit({ type: 'decline', payload: decline });
        emit({ type: 'done', signals: signals() });
        controller.close();
        return;
      }

      let streamedAny = false;
      try {
        // 1. Decide (also for a manual pick: the chip shows the recommendation).
        const dt = Date.now();
        const ds = await decide({ text: skill ? `/${skill.slug} ${latest}` : latest, prevUser, lane, webToggle }, undefined, { log: true });
        const wantedTier = (ds.model_tier?.answer ?? 'cheap') as Tier;
        const recommended = getModel(TIER_DEFAULT[wantedTier])!;
        const verdict = admin
          ? budgetVerdict(budget, picked ? picked.tier : wantedTier, Boolean(picked))
          : { tier: 'cheap' as Tier, notice: null, message: null, usedShare: 0 };
        const model = picked ?? getModel(TIER_DEFAULT[verdict.tier])!;
        const web = webToggle || autoWeb || ds.needs_web?.answer === 'yes';
        const clarify = ds.needs_clarify?.answer === 'yes';
        const depth = skill?.depth ?? ds.depth?.answer ?? '2';
        const reasonBits = [
          `${ds.model_tier?.backend ?? 'default'} judge: ${Object.entries(ds.model_tier?.probs ?? {}).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(', ')}`,
          web ? (webToggle ? 'web on' : autoWeb ? 'web on: recent-events question' : 'web on: the judge expects outside facts') : 'records only',
        ];
        const decision: V2Decision = {
          model: model.id, label: model.label, provider: model.provider, tier: model.tier,
          auto: !picked, recommended: recommended.id, recommendedLabel: recommended.label,
          reason: reasonBits.join(' · '), web, clarify, depth,
          estUsd: estimateTurnUsd(model),
          budget: { notice: verdict.notice, message: verdict.message, usedShare: verdict.usedShare },
          latencyMs: Date.now() - dt,
        };
        emit({ type: 'decision', decision });
        if (verdict.message) emit({ type: 'status', text: verdict.message });

        // 2. The loop.
        const promptOpts: V2PromptOpts = { web, lane, fresh: cls.fresh, depth, clarify: clarify && !skill, reportBlock, roster: rosterForPrompt(audience) };
        const adapter = model.provider === 'anthropic' ? anthropicAdapter() : openrouterAdapter();
        const tools = toolSpecs(identity);
        const ownWeb = web && model.provider === 'openrouter';
        if (ownWeb) tools.push({ name: webSearchTool.name, description: webSearchTool.description, inputSchema: webSearchTool.inputSchema });
        const sources = new Map<string, WebSource>();
        const addSources = (s: WebSource[]) => {
          const fresh = s.filter((x) => !sources.has(x.url));
          for (const x of fresh) sources.set(x.url, x);
        };
        emit({ type: 'status', text: STATUS_START });
        const result = await runLoop({
          adapter,
          model: model.id,
          system: v2System(promptOpts),
          messages: v2Messages(msgs, ns, promptOpts, skill?.instructions),
          tools,
          serverWebSearch: web && model.provider === 'anthropic',
          separateFinal: web && (lane === 'thin' || lane === 'adjacent'),
          exec: async (c) => {
            const ctxT = { identity, tagger, status: (s: string) => emit({ type: 'status', text: deDash(s) }), webSources: addSources };
            if (c.name === 'web_search' && ownWeb) {
              const p = webSearchTool.parse(c.input);
              if (typeof p === 'string') return { text: p, isError: true };
              return webSearchTool.run(p, ctxT);
            }
            return runTool(c.name, c.input, ctxT);
          },
          emit: (e) => {
            if (e.type === 'delta') {
              streamedAny = true;
              emit({ type: 'delta', text: deDash(e.text) });
            } else if (e.type === 'retract') emit({ type: 'retract' });
            else if (e.type === 'status') emit({ type: 'status', text: deDash(e.text) });
            else if (e.type === 'tool_call') emit({ type: 'tool_call', name: e.name, ok: !e.isError });
            else if (e.type === 'web_sources') addSources(e.sources);
          },
          finalInstruction: v2FinalInstruction(promptOpts),
          deadlineAt: t0 + DEADLINE_MS - FINAL_RESERVE_MS,
          maxTokens: depth === '3' ? 8000 : 4000,
          signal: req.signal,
          onCall: async (u, wallMs) => {
            await recordApiCall({ feature, model: model.id, usage: toApiUsage(u, model.provider), wallMs, metadata });
          },
        });
        if (sources.size) emit({ type: 'sources', sources: [...sources.values()].slice(0, 8) });

        // 3. Verify: deterministic always, the model layer when time allows.
        const answer = deDash(result.answer);
        if (answer && !req.signal.aborted) {
          const { atlas, beyond } = splitBeyond(answer);
          let report: VerifyReport = { flags: [], beyondPresent: beyond !== null, ...runDeterministicChecks(atlas, [ns.skeleton, ...result.corpus]) };
          if (web && (result.usage.webSearches > 0 || sources.size > 0)) report.webSearched = true;
          if (Date.now() < t0 + DEADLINE_MS - 25_000 && result.corpus.length > 0) {
            emit({ type: 'status', text: STATUS_VERIFYING });
            try {
              const v = await verifyV2({ corpus: result.corpus, question: latest, answer: atlas, feature: admin ? 'ask_verify2' : PORTAL_FEATURE, metadata });
              if (v) report = { ...report, ...v };
            } catch {
              // the deterministic report still ships
            }
          }
          emit({ type: 'verify', report });
          const chips = nextChips({ question: latest, answer, skillSlug: skill?.slug ?? null, depth, lane, audience });
          if (chips.length) emit({ type: 'chips', chips });
        }

        // 4. Cost (the answer model only; decider and verifier log their own rows).
        const api = toApiUsage(result.usage, model.provider);
        emit({
          type: 'cost',
          report: {
            cost_usd: await priceUsage(model.id, api),
            input_tokens: result.usage.input + result.usage.cacheRead + result.usage.cacheWrite,
            output_tokens: result.usage.output,
            cache_read_tokens: result.usage.cacheRead,
            cache_write_tokens: result.usage.cacheWrite,
            searches: result.usage.webSearches,
            rounds: result.modelCalls,
            tool_calls: result.toolCalls,
            model: model.id,
          },
        });
        if (!answer) emit({ type: 'error', text: 'The research finished without an answer. Please try again.' });
      } catch (e) {
        console.error('[ask/v2]', (e as Error).message);
        emit({ type: 'error', text: streamedAny ? 'The answer was cut short. The partial answer above stands on the records it cites.' : 'The research could not be completed. Please try again.' });
      } finally {
        emit({ type: 'done', signals: signals() });
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  if (keyId) after(() => touchKey(keyId));
  return new Response(stream, { headers: NDJSON_HEADERS });
}

const centsOrDollars = (usd: number): string => (usd < 1 ? `${Math.round(usd * 100)}¢` : `$${usd.toFixed(2)}`);

// A turn that needs no model: the /help catalog, an unknown name, or an agent
// that launches from its own card. Same protocol, zero cost.
function modelFreeTurn(inv: NonNullable<ReturnType<typeof parseInvocation>>, audience: 'admin' | 'keyholder'): Response {
  const events: V2Event[] = [{ type: 'lane', lane: 'covered', reason: 'invocation' }];
  let text: string;
  if (inv.kind === 'skill') {
    events.push({ type: 'skill', slug: inv.skill.slug, title: inv.skill.title, kind: 'skill' });
    text = helpText(audience);
  } else if (inv.kind === 'agent') {
    events.push({ type: 'skill', slug: inv.agent.slug, title: inv.agent.title, kind: 'agent' });
    const t = inv.agent.typical;
    const usual = t ? ` Usually about ${Math.round(t.seconds / 60)} minutes and ${centsOrDollars(t.usd)} a run.` : '';
    text = `${inv.agent.title}: ${inv.agent.oneLiner}${usual} To start one, switch on Field Report under the box and ask the question there; it drafts a plan you can edit before anything runs.`;
  } else {
    events.push({ type: 'skill', slug: inv.trigger, title: inv.trigger, kind: 'unknown' });
    text = `Nothing is called ${inv.trigger}. Type /help for everything the bar can do.`;
  }
  events.push({ type: 'delta', text });
  events.push({ type: 'cost', report: { cost_usd: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, searches: 0, rounds: 0, tool_calls: 0, model: 'none' } });
  events.push({ type: 'done', signals: {} });
  return new Response(events.map(nd).join(''), { headers: NDJSON_HEADERS });
}
