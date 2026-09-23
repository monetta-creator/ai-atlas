import * as m from '../mutations';
import {
  getCandidate, isFetchHostileDomain, getTextCoverage, listSignalsMissingText,
  type TextCoverage, type MissingTextRow,
} from '../data';
import { domainOf, fetchCandidateText, FetchFailure } from './web';

// Stage 1 of analysis, extracted from hydrateCandidateAction so the cron
// engine and the admin action share one implementation: fetch + cache the
// candidate's readable text. Failures come back as data; `terminal` tells the
// orchestrator a retry cannot succeed (403, bad URL, unparseable document) so
// it flags immediately instead of burning attempts on a deterministic outcome.
export interface HydrateResult {
  ok: boolean;
  skipped?: boolean;
  error?: string;
  terminal?: boolean;
  via?: 'direct' | 'jina';
}

export async function hydrateCandidate(candidateId: string): Promise<HydrateResult> {
  try {
    const cand = await getCandidate(candidateId);
    if (!cand) return { ok: false, error: 'candidate not found', terminal: true };
    if (cand.signal_id || cand.raw_content) return { ok: true, skipped: true };
    // Learned routing: a domain whose history says direct fetches are doomed (reader-only
    // successes, terminal access walls) goes straight to the reader.
    const domain = (cand.source_domain || domainOf(cand.url)).toLowerCase().replace(/^www\./, '');
    const preferJina = domain ? await isFetchHostileDomain(domain).catch(() => false) : false;
    const { text, via } = await fetchCandidateText(cand.url, { preferJina });
    await m.setCandidateRawContent(candidateId, text, via);
    return { ok: true, via };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'fetch error';
    const terminal = e instanceof FetchFailure ? e.terminal : false;
    // Record the failed attempt (analysis-health view); a later success overwrites it.
    await m.setAnalysisStatus(candidateId, 'error', msg.slice(0, 500)).catch(() => {});
    return { ok: false, error: msg, terminal };
  }
}

// One bounded attempt to retain the article text behind a signal, stored on
// whichever row the record offers (source row first, else its newest
// candidate). Every failure comes back as data. Shared by the /pipeline
// publish-time guard, the admin catch-up action, and the agent's
// `text.refetch_missing` remedy so the three never drift.
export async function retainTextFor(row: MissingTextRow): Promise<{ ok: boolean; reason?: string }> {
  if (!row.url) return { ok: false, reason: 'no url on the record' };
  try {
    const domain = domainOf(row.url).toLowerCase().replace(/^www\./, '');
    const preferJina = domain ? await isFetchHostileDomain(domain).catch(() => false) : false;
    const { text, via } = await fetchCandidateText(row.url, { preferJina, maxChars: 60000 });
    if (row.source_id) await m.setSourceRawText(row.source_id, text);
    else if (row.candidate_id) await m.setCandidateRawContent(row.candidate_id, text, via);
    else return { ok: false, reason: 'no row to store the text on' };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'fetch failed' };
  }
}

export interface RefetchMissingTextResult {
  attempted: number;
  retained: number;
  failures: { title: string; reason: string }[];
  coverage: TextCoverage;
}

// The retained-text catch-up: process up to `limit` published signals still
// missing article text, one bounded fetch each. Shared by the /pipeline
// admin action (limit 5, fits the page's 60s cap) and the agent's auto-tier
// remedy (also 5, HTTP fetches only, no model call).
export async function refetchMissingText(limit = 5): Promise<RefetchMissingTextResult> {
  const missing = await listSignalsMissingText(limit);
  const failures: { title: string; reason: string }[] = [];
  let retained = 0;
  for (const row of missing) {
    const r = await retainTextFor(row);
    if (r.ok) retained++;
    else failures.push({ title: row.title, reason: (r.reason ?? 'failed').slice(0, 200) });
  }
  return { attempted: missing.length, retained, failures, coverage: await getTextCoverage() };
}
