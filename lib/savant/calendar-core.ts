// Pure date extraction for Savant's forward calendar (2026-09-26): scans a
// record's title + text for a date literally present in the copy, inside a
// horizon, next to a trigger word that makes it an event rather than an
// incidental mention ("the model launched in March" is not a calendar
// entry; "the rule takes effect March 1" is). PLAIN-NODE LOADABLE: no
// imports. Never invents a date: every hit traces back to text in the
// source record.

export interface DatedItemInput {
  id: string;
  title: string;
  text: string | null;
  url: string | null;
  href: string | null;
}

export interface DatedItem {
  date: string; // YYYY-MM-DD
  what: string; // the sentence the date came from, clipped
  id: string;
  url: string | null;
  href: string | null;
  trigger: string;
}

const MONTHS: Record<string, number> = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sep: 8, sept: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11,
};

const MONTH_NAMES =
  '(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)';

const TRIGGER_RE =
  /\b(deadline|comment period|comments due|effective|earnings|reports|hearing|vote|ruling|expires|launch|release|rollout|due|conference|summit|go live|takes effect|sunset|expiry)\b/i;

interface RawDateMatch {
  index: number;
  length: number;
  year: number | null;
  month: number;
  day: number;
}

function findDates(text: string): RawDateMatch[] {
  const out: RawDateMatch[] = [];

  const isoRe = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  let m: RegExpExecArray | null;
  while ((m = isoRe.exec(text))) {
    const month = Number(m[2]) - 1;
    const day = Number(m[3]);
    if (month < 0 || month > 11 || day < 1 || day > 31) continue;
    out.push({ index: m.index, length: m[0].length, year: Number(m[1]), month, day });
  }

  const mdyRe = new RegExp(`\\b${MONTH_NAMES}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,\\s*(\\d{4}))?\\b`, 'gi');
  while ((m = mdyRe.exec(text))) {
    const month = MONTHS[m[1].toLowerCase()];
    const day = Number(m[2]);
    if (month === undefined || day < 1 || day > 31) continue;
    out.push({ index: m.index, length: m[0].length, year: m[3] ? Number(m[3]) : null, month, day });
  }

  const dmyRe = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_NAMES}\\s+(\\d{4})\\b`, 'gi');
  while ((m = dmyRe.exec(text))) {
    const day = Number(m[1]);
    const month = MONTHS[m[2].toLowerCase()];
    if (month === undefined || day < 1 || day > 31) continue;
    out.push({ index: m.index, length: m[0].length, year: Number(m[3]), month, day });
  }

  return out.sort((a, b) => a.index - b.index);
}

function isoFromParts(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// A year-less date resolves to the next occurrence on or after today.
function resolveYearless(month: number, day: number, today: string): string {
  const todayDate = new Date(`${today}T00:00:00Z`);
  const year = todayDate.getUTCFullYear();
  const candidate = new Date(Date.UTC(year, month, day));
  if (candidate.getTime() >= todayDate.getTime()) return isoFromParts(year, month, day);
  return isoFromParts(year + 1, month, day);
}

interface Sentence {
  start: number;
  end: number;
  text: string;
}

function sentencesWithOffsets(text: string): Sentence[] {
  const re = /[^.!?\n]+[.!?]?/g;
  const out: Sentence[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[0].trim().length === 0) continue;
    out.push({ start: m.index, end: m.index + m[0].length, text: m[0].trim() });
  }
  return out;
}

export interface ExtractDatedItemsOpts {
  horizonDays?: number;
}

export function extractDatedItems(items: DatedItemInput[], today: string, opts: ExtractDatedItemsOpts = {}): DatedItem[] {
  const horizonDays = opts.horizonDays ?? 30;
  const todayDate = new Date(`${today}T00:00:00Z`);
  const horizonDate = new Date(todayDate.getTime() + horizonDays * 86_400_000);

  const seen = new Set<string>();
  const out: DatedItem[] = [];

  for (const item of items) {
    const combined = `${item.title}. ${item.text ?? ''}`;
    const matches = findDates(combined);
    if (matches.length === 0) continue;
    const sentences = sentencesWithOffsets(combined);

    for (const dm of matches) {
      const date = dm.year != null ? isoFromParts(dm.year, dm.month, dm.day) : resolveYearless(dm.month, dm.day, today);
      const d = new Date(`${date}T00:00:00Z`);
      if (d.getTime() < todayDate.getTime() || d.getTime() > horizonDate.getTime()) continue;

      const before = combined.slice(Math.max(0, dm.index - 80), dm.index);
      const after = combined.slice(dm.index + dm.length, dm.index + dm.length + 80);
      const trigMatch = TRIGGER_RE.exec(before) ?? TRIGGER_RE.exec(after);
      if (!trigMatch) continue;

      const key = `${date}|${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const sentence = sentences.find((s) => dm.index >= s.start && dm.index < s.end);
      const what = (sentence ? sentence.text : combined).slice(0, 200);

      out.push({ date, what, id: item.id, url: item.url, href: item.href, trigger: trigMatch[0].toLowerCase() });
    }
  }

  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
