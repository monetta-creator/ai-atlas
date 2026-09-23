// Pure helpers for the daily brief: no lib/db import anywhere in this file's
// dependency chain, so scripts/test-agent-brain.mjs can load it directly
// under plain-Node type stripping (the lib/pack-shared.ts discipline).

import type { BriefMemo } from './types';

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
