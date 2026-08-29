import * as m from '../mutations';
import { getCandidate, isFetchHostileDomain } from '../data';
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
