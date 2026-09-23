// Pure helpers for the daily brief: no lib/db import anywhere in this file's
// dependency chain, so scripts/test-agent-brain.mjs can load it directly
// under plain-Node type stripping (the lib/pack-shared.ts discipline).

import type { AgentFinding, BriefMemo, Severity } from './types';

// House style: never an em dash (U+2014) in anything the agent writes. A
// bare one collapses to a comma so the sentence still reads; the common
// space-dash-space form collapses the same way.
export function scrubDashes(s: string): string {
  return (s ?? '').replace(/\s*\u2014\s*/g, ', ');
}

function scrubList(items: { findingKey: string; text: string }[] | undefined, openKeys: Set<string>): { findingKey: string; text: string }[] {
  if (!Array.isArray(items)) return [];
  const out: { findingKey: string; text: string }[] = [];
  for (const it of items) {
    if (!it || typeof it.findingKey !== 'string' || !openKeys.has(it.findingKey)) continue;
    const text = scrubDashes(typeof it.text === 'string' ? it.text.trim() : '');
    if (!text) continue;
    out.push({ findingKey: it.findingKey, text });
  }
  return out;
}

// Clamps a model-written memo to the finding keys that are actually open
// right now (a stale or hallucinated key never reaches the drawer), and
// scrubs every string field of em dashes. Does not fill in a fallback
// headline; runDailyBrief does that from the top finding once it sees the
// headline came back empty.
export function validateMemo(memo: BriefMemo, openKeys: string[] | Set<string>): BriefMemo {
  const keys = openKeys instanceof Set ? openKeys : new Set(openKeys);
  const headline = scrubDashes(typeof memo?.headline === 'string' ? memo.headline.trim() : '');
  const sections = Array.isArray(memo?.sections)
    ? memo.sections
        .map((s) => ({
          title: scrubDashes(typeof s?.title === 'string' ? s.title.trim() : ''),
          body: scrubDashes(typeof s?.body === 'string' ? s.body.trim() : ''),
        }))
        .filter((s) => s.title || s.body)
        .slice(0, 6)
    : [];
  return {
    headline,
    sections,
    // A brief is a memo, not the findings list: at most eight taps asked for,
    // at most six things the agent says it will do.
    proposals: scrubList(memo?.proposals, keys).slice(0, 8),
    willDo: scrubList(memo?.willDo, keys).slice(0, 6),
  };
}

// The no-model fallback memo (budget spent, or the model call failed): the
// open findings bucketed by severity, proposals from the propose-tier
// remedies, willDo from the auto-tier ones.
export function buildDeterministicMemo(findings: AgentFinding[], reason: 'budget' | 'model_failed'): BriefMemo {
  const lead = reason === 'budget' ? 'Budget spent' : 'The model call failed';
  const bySeverity: Record<Severity, AgentFinding[]> = { high: [], warn: [], info: [] };
  for (const f of findings) bySeverity[f.severity]?.push(f);
  const sectionFor = (sev: Severity, label: string) => {
    const list = bySeverity[sev];
    if (!list.length) return null;
    return { title: label, body: list.map((f) => `${f.title} (${f.key}).`).join(' ') };
  };
  const sections = [sectionFor('high', 'High'), sectionFor('warn', 'Needs attention'), sectionFor('info', 'For the record')].filter(
    (s): s is { title: string; body: string } => s !== null
  );
  return {
    headline: findings.length
      ? `${lead}; here is the raw list (${findings.length} open)`
      : `${lead}; nothing open right now`,
    sections: sections.length ? sections : [{ title: 'Nothing open', body: 'No open findings right now.' }],
    proposals: findings.filter((f) => f.remedy?.tier === 'propose').map((f) => ({ findingKey: f.key, text: f.remedy!.label })),
    willDo: findings.filter((f) => f.remedy?.tier === 'auto').map((f) => ({ findingKey: f.key, text: f.remedy!.label })),
  };
}
