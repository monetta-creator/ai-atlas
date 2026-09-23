import type { NextRequest } from 'next/server';
import { after } from 'next/server';
import { getDataset } from '@/lib/datasets/registry';
import { checkKeyBudget, checkPortalBudget } from '@/lib/portal/budget';
import { identityFromRequest, touchKey, unauthorizedMessage } from '@/lib/portal/identity';
import { logPortalUsage } from '@/lib/mutations/portal';
import { NlUnknownDataset } from '@/lib/portal/nl-core';
import { nlQuery } from '@/lib/portal/nl-query';

// The Data Portal's natural-language query builder (migration 0064): POST a
// plain-language question, get back a dataset slug, a validated filter
// param record, and a ready download href. One model call per question
// (lib/portal/nl-query.ts), gated and budgeted exactly like
// app/api/portal/ask/route.ts: an active portal identity, then the
// portal-wide daily budget, then (for a per-person key) that key's own cap.
//
// NOT YET on the proxy allow-list (proxy.ts is locked to a sibling agent this
// pass): add the '/api/portal/' prefix there for this route to work
// sessionlessly, the way /api/portal/ask already does.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_QUESTION_LEN = 500;
const JSON_HEADERS = { 'Cache-Control': 'no-store' };

function identityTier(tier: 'admin' | 'key' | 'legacy' | 'none'): 'admin' | 'key' | 'legacy' {
  return tier === 'admin' ? 'admin' : tier === 'key' ? 'key' : 'legacy';
}

export async function POST(req: NextRequest): Promise<Response> {
  const identity = await identityFromRequest(req);
  if (!identity.active) {
    const denied = unauthorizedMessage(identity);
    return Response.json(denied.body, { status: denied.status, headers: { ...denied.headers, ...JSON_HEADERS } });
  }

  const budget = await checkPortalBudget();
  if (!budget.ok) {
    return Response.json(
      {
        error: 'budget_exceeded',
        message: 'The Atlas has answered a lot of questions today and has reached its daily budget. It resets at midnight UTC.',
      },
      { status: 429, headers: JSON_HEADERS }
    );
  }
  const keyId = identity.tier === 'key' ? identity.keyId : null;
  if (keyId) {
    const own = await checkKeyBudget(keyId);
    if (!own.ok) {
      return Response.json(
        {
          error: 'key_budget_exceeded',
          message: 'Your access key has reached its daily budget. It resets at midnight UTC.',
        },
        { status: 402, headers: JSON_HEADERS }
      );
    }
  }

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    // fall through to the bad-request guard
  }
  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'Bad request.' }, { status: 400, headers: JSON_HEADERS });
  }
  const input = body as Record<string, unknown>;

  const question = typeof input.question === 'string' ? input.question.trim() : '';
  if (question.length < 1 || question.length > MAX_QUESTION_LEN) {
    return Response.json(
      { error: `Ask a question, up to ${MAX_QUESTION_LEN} characters.` },
      { status: 400, headers: JSON_HEADERS }
    );
  }

  let dataset: string | undefined;
  if (typeof input.dataset === 'string' && input.dataset.trim()) {
    dataset = input.dataset.trim();
    if (!getDataset(dataset)) {
      return Response.json({ error: 'Unknown dataset.' }, { status: 400, headers: JSON_HEADERS });
    }
  }

  let result;
  try {
    result = await nlQuery({ question, dataset, identity });
  } catch (e) {
    if (e instanceof NlUnknownDataset) {
      return Response.json({ error: e.message }, { status: 400, headers: JSON_HEADERS });
    }
    return Response.json({ error: 'Could not build a query for that question.' }, { status: 500, headers: JSON_HEADERS });
  }

  const ua = (req.headers.get('user-agent') ?? '').slice(0, 300) || null;
  after(() => Promise.all([
    logPortalUsage({
      keyId,
      identity: identityTier(identity.tier),
      kind: 'nl_query',
      datasetSlug: result.dataset,
      // The question text itself is never stored, only its length, alongside
      // the dataset/params it resolved to and how much of the model's answer
      // got dropped.
      spec: { questionLength: question.length, dataset: result.dataset, params: result.params, droppedCount: result.dropped.length },
      status: 200,
      ua,
    }),
    touchKey(keyId),
  ]));

  return Response.json(
    { dataset: result.dataset, params: result.params, href: result.href, dropped: result.dropped, explanation: result.explanation },
    { headers: JSON_HEADERS }
  );
}
