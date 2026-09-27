import { enforceCitations } from '../citations';
import { saveGeneratedReport, deleteGeneratedReport } from '../mutations/reports';
import { appendNotebook, insertHypothesis, updateHypothesis, clearHypothesisUpdatesForWeek } from '../mutations/savant';
import { getNotebook, getSavantPrefs, getSelfCompany } from '../data/savant';
import { getSavantIssue } from '../data/savant-issues';
import { buildSavantPack } from './pack';
import { researchLead } from './lead';
import type { LeadResult } from './lead';
import { writeSummaryAndHypotheses, writeDepartments, writePeers, md2html } from './write';
import { deterministicChecks, editorReview, reviseSection } from './editor';
import { planFigures } from './figures';
import { isAnthropicId, LEAD_FALLBACK_MODEL } from './cost-model';
import type { SavantFigure } from './figures-core';
import { revisionKeepsFigures } from './editor-core';
import type { Draft } from './editor';
import { allowlistForSavant } from './allowlist';
import { checkSavantBudget } from './budget';
import { makeMondayPlan, hypothesisExistsForWeek } from './plan';
import { sendSavantIssue } from './email';
import type { SavantNarrative, SavantPack, PlanPayload, HypothesisReading, SavantDepartment, EditorReview, SavedSavantIssue } from './types';

// Savant's Friday run (2026-09-26): the whole issue in checkpointed legs so
// a 300s cron route can call it three times and finish (each leg's result
// is parked in the notebook as kind 'query', key 'leg:<name>', and a later
// call resumes from there). Fully autonomous: plan (if the week has none),
// pack, lead research, front + departments, the editor, one revision, the
// citation gate, save (published), the ledger update, email. Past the budget
// the legs fall back to deterministic renderings, never to silence.

type Leg = 'lead' | 'front' | 'departments' | 'peers' | 'editor' | 'revise' | 'figures';

interface Parked<T> { leg: Leg; value: T }

async function parked<T>(weekEnd: string, leg: Leg): Promise<T | null> {
  const rows = await getNotebook(weekEnd, ['query']);
  const row = rows.find((r) => r.key === `leg:${leg}`);
  return row ? (row.payload as Parked<T>).value : null;
}

async function park<T>(weekEnd: string, leg: Leg, value: T): Promise<void> {
  await appendNotebook(weekEnd, weekEnd, [{ kind: 'query', key: `leg:${leg}`, payload: { leg, value } as Parked<T> }]);
}

type LeadParked = Omit<LeadResult, 'tagHrefs'> & { tagHrefs: [string, string][] };

export interface IssueRunOpts {
  deadlineMs?: number;        // wall-clock budget for THIS call; the run parks and returns `partial` when short
  email?: boolean;            // send the Friday email after save (default: prefs.email_enabled)
  force?: boolean;            // delete an existing issue for the week and rebuild
  origin?: string;            // for absolute links in the email
  onLeg?: (leg: string, state: 'running' | 'done') => Promise<void> | void; // progress for the run registry (lib/savant/issue-job.ts)
}

export type IssueRunResult =
  | { id: string; weekEnd: string; issueNumber: number; title: string; sent?: string[]; failed?: { email: string; error: string }[]; replaced?: boolean }
  | { partial: true; weekEnd: string; done: Leg[]; next: Leg | 'save' }
  | { skipped: string };

const deterministicLead = (pack: SavantPack): LeadResult => {
  const plan = pack.plan;
  const md = [
    `**The desk could not complete its research this week.** ${plan ? `The plan was to examine ${plan.topic}. ${plan.why}` : 'No plan was recorded.'}`,
    plan ? `**The hypothesis on the table.** ${plan.hypothesis.statement} It would be settled by: ${plan.hypothesis.what_would_settle_it.join('; ')}.` : '',
    pack.notebook.connections.length ? `**What the notebook holds.** ${pack.notebook.connections.slice(0, 5).map((c) => `[${c.record.title}](${c.record.href ?? c.record.url}) sits beside [${c.target.statement}](${c.target.href}).`).join(' ')}` : '',
    `**What we will watch.** ${plan ? plan.hypothesis.watch.join('; ') : 'The record.'}`,
  ].filter(Boolean).join('\n\n');
  return { title: plan?.topic ?? 'This week', markdown: md, html: md2html(md), reading: 'unchanged', readingNote: 'The research leg did not complete.', readingHtml: '<p>The research leg did not complete.</p>', queries: [], rounds: 0, webSearches: 0, tagHrefs: new Map() };
};

export async function runSavantIssue(weekEnd: string, opts: IssueRunOpts = {}): Promise<IssueRunResult> {
  const t0 = Date.now();
  const deadline = t0 + (opts.deadlineMs ?? 270_000);
  const timeLeft = () => deadline - Date.now();
  const prefs = await getSavantPrefs();
  if (!prefs.enabled) return { skipped: 'savant disabled' };

  const existing = await getSavantIssue(weekEnd);
  let replaced = false;
  if (existing) {
    if (!opts.force) return { skipped: `issue exists for week ending ${weekEnd}` };
    await deleteGeneratedReport(existing.id);
    await clearHypothesisUpdatesForWeek(weekEnd);
    replaced = true;
  }

  // 0. The plan: a week whose notebook never planned (a backfill, or a
  // Monday the cron missed) plans now, on Friday's material.
  const planRows = await getNotebook(weekEnd, ['plan']);
  if (!planRows.length) {
    const self = await getSelfCompany();
    const budget = await checkSavantBudget(weekEnd);
    const plan: PlanPayload = await makeMondayPlan({ day: weekEnd, weekEnd, prefs, self, budgetOk: budget.ok });
    await appendNotebook(weekEnd, weekEnd, [{ kind: 'plan', key: 'plan', payload: plan }]);
    if (!(await hypothesisExistsForWeek(weekEnd))) {
      await insertHypothesis({ statement: plan.hypothesis.statement, question_slug: plan.question_slug, posed_week: weekEnd, what_would_settle: plan.hypothesis.what_would_settle_it, watch: plan.hypothesis.watch });
    }
  }

  // 1. The pack, rebuilt on every call (cheap, and it must see the plan).
  await opts.onLeg?.('pack', 'running');
  const pack = await buildSavantPack(weekEnd);
  await opts.onLeg?.('pack', 'done');
  const budget = await checkSavantBudget(weekEnd);
  const done: Leg[] = [];
  const legDone = async (leg: Leg) => { done.push(leg); await opts.onLeg?.(leg, 'done'); };

  // 2. Lead research. The loop is Anthropic tool use + web search, so a
  // non-Anthropic writer hands this one leg to the fallback.
  const leadModel = isAnthropicId(prefs.writer_model) ? prefs.writer_model : LEAD_FALLBACK_MODEL;
  let lead: LeadResult;
  const leadParked = await parked<LeadParked>(weekEnd, 'lead');
  if (leadParked) {
    lead = { ...leadParked, tagHrefs: new Map(leadParked.tagHrefs) };
  } else {
    if (timeLeft() < 150_000) return { partial: true, weekEnd, done, next: 'lead' };
    lead = budget.ok
      ? await researchLead(pack, { model: leadModel, deadlineMs: Math.min(timeLeft() - 30_000, 200_000), weekEnd }).catch(() => deterministicLead(pack))
      : deterministicLead(pack);
    await park<LeadParked>(weekEnd, 'lead', { ...lead, tagHrefs: [...lead.tagHrefs.entries()] });
  }
  await legDone('lead');

  // 3. Front + departments + peers.
  let front = await parked<{ summary: string[]; freshHtml: string | null; readings: HypothesisReading[] }>(weekEnd, 'front');
  if (!front) {
    if (timeLeft() < 90_000) return { partial: true, weekEnd, done, next: 'front' };
    front = budget.ok
      ? await writeSummaryAndHypotheses(pack, lead, prefs.writer_model).catch(() => null)
      : null;
    front = front ?? {
      summary: [`<p><a href="/savant/${weekEnd}#lead">${lead.title}</a></p>`],
      freshHtml: pack.hypotheses.fresh ? `<p>${pack.hypotheses.fresh.statement}</p>` : null,
      readings: pack.hypotheses.open.map((h) => ({ id: h.id, statement: h.statement, posedWeek: h.posed_week, direction: 'unchanged' as const, note: 'Not read this week.', html: '<p>Not read this week.</p>', verdict: null })),
    };
    await park(weekEnd, 'front', front);
  }
  await legDone('front');

  let departments = await parked<SavantDepartment[]>(weekEnd, 'departments');
  if (!departments) {
    if (timeLeft() < 90_000) return { partial: true, weekEnd, done, next: 'departments' };
    departments = budget.ok ? await writeDepartments(pack, prefs.writer_model).catch(() => null) : null;
    departments = departments ?? [];
    await park(weekEnd, 'departments', departments);
  }
  await legDone('departments');

  let peers = await parked<SavantDepartment>(weekEnd, 'peers');
  if (!peers) {
    if (timeLeft() < 60_000) return { partial: true, weekEnd, done, next: 'peers' };
    peers = budget.ok ? await writePeers(pack, prefs.writer_model).catch(() => null) : null;
    peers = peers ?? { key: 'peers', title: 'Peer and market watch', html: '<p class="sv-empty">The peer tables are in Appendix B; the desk did not write them up this week.</p>', empty: true };
    await park(weekEnd, 'peers', peers);
  }
  await legDone('peers');

  // Department order: moved, peers, regulation, research, tools, missed, ahead.
  const order: SavantDepartment['key'][] = ['moved', 'peers', 'regulation', 'research', 'tools', 'missed', 'ahead'];
  const allDepts = [...departments, peers];
  const ordered = order.map((k) => allDepts.find((d) => d.key === k)).filter((d): d is SavantDepartment => Boolean(d));

  // 4. The editor.
  const self = pack.self;
  let draft: Draft = {
    title: lead.title, summary: front.summary, leadHtml: lead.html, leadMarkdown: lead.markdown,
    freshHtml: front.freshHtml, readings: front.readings, departments: ordered,
  };
  let editor = await parked<EditorReview>(weekEnd, 'editor');
  if (!editor) {
    if (timeLeft() < 80_000) return { partial: true, weekEnd, done, next: 'editor' };
    const checks = deterministicChecks(draft, self);
    editor = budget.ok
      ? await editorReview(draft, checks, { model: prefs.editor_model, name: prefs.editor_name, weekEnd, self }).catch((): EditorReview => ({ name: prefs.editor_name, verdict: 'publish', requiredEdits: [], cuts: [], note: 'The editor could not review this issue; it publishes on the automated checks alone.', checks }))
      : { name: prefs.editor_name, verdict: 'publish', requiredEdits: [], cuts: [], note: 'This issue published on the automated checks alone: the week\'s model budget was spent before the editor read it.', checks };
    await park(weekEnd, 'editor', editor);
  }
  await legDone('editor');

  // 5. One revision round over the sections the editor named.
  let revised = false;
  const revisionRejected: string[] = [];
  const revisedParked = await parked<{ draft: Draft; revised: boolean; rejected?: string[] }>(weekEnd, 'revise');
  if (revisedParked) {
    draft = revisedParked.draft; revised = revisedParked.revised; revisionRejected.push(...(revisedParked.rejected ?? []));
  } else if (editor.requiredEdits.length && budget.ok) {
    if (timeLeft() < 80_000) return { partial: true, weekEnd, done, next: 'revise' };
    const bySection = new Map<string, string[]>();
    for (const e of editor.requiredEdits) bySection.set(e.section, [...(bySection.get(e.section) ?? []), e.instruction]);
    const cutsFor = (s: string) => editor!.cuts.filter((c) => c.section === s).map((c) => c.quote);
    for (const [section, instructions] of bySection) {
      if (timeLeft() < 40_000) break;
      // A revision may cut or rephrase; it may not introduce a figure the
      // original never stated (a revised peer paragraph once turned 8 items
      // into 0). Such a revision is discarded and recorded.
      if (section === 'lead') {
        const md = await reviseSection({ section, markdown: draft.leadMarkdown, instructions, cuts: cutsFor(section), model: prefs.writer_model, weekEnd });
        if (revisionKeepsFigures(draft.leadMarkdown, md)) {
          draft = { ...draft, leadMarkdown: md, leadHtml: md2html(md) };
          revised = true;
        } else {
          revisionRejected.push(section);
        }
      } else if (section === 'peers') {
        // The peer watch is written from tables; it is not revised, only cut
        // by the gate and the deterministic checks.
        revisionRejected.push('peers (not revisable)');
      } else {
        const dept = draft.departments.find((d) => d.key === section);
        if (dept && !dept.empty) {
          const original = htmlToMd(dept.html);
          const md = await reviseSection({ section, markdown: original, instructions, cuts: cutsFor(section), model: prefs.writer_model, weekEnd });
          if (revisionKeepsFigures(original, md)) {
            draft = { ...draft, departments: draft.departments.map((d) => (d.key === section ? { ...d, html: md2html(md) } : d)) };
            revised = true;
          } else {
            revisionRejected.push(section);
          }
        }
      }
    }
    await park(weekEnd, 'revise', { draft, revised, rejected: revisionRejected });
  }
  await legDone('revise');

  // 6. Figures: over the final text, against the same allow-list the gate uses.
  const allow = allowlistForSavant(pack);
  for (const [, href] of lead.tagHrefs) allow.hrefs.add(href);
  let figures = await parked<{ figures: SavantFigure[]; dropped: string[] }>(weekEnd, 'figures');
  if (!figures) {
    if (timeLeft() < 60_000) return { partial: true, weekEnd, done, next: 'figures' };
    figures = budget.ok
      ? await planFigures(pack, { leadTitle: draft.title, leadHtml: draft.leadHtml, departments: draft.departments }, allow.hrefs, { model: prefs.writer_model, weekEnd, timeoutMs: Math.min(timeLeft() - 20_000, 120_000) }).catch(() => null)
      : null;
    figures = figures ?? { figures: [], dropped: ['the figure leg did not run'] };
    await park(weekEnd, 'figures', figures);
  }
  await legDone('figures');

  // 7. Gate, assemble, save.
  const dropped: string[] = [];
  const gate = (html: string): string => {
    const g = enforceCitations(html, allow);
    dropped.push(...g.dropped);
    return g.html ?? '';
  };
  const narrative: SavantNarrative = {
    title: draft.title,
    summary: draft.summary.map(gate),
    lead: { title: draft.title, html: gate(draft.leadHtml), wordCount: draft.leadHtml.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length },
    hypotheses: {
      fresh: pack.hypotheses.fresh ? { statement: pack.hypotheses.fresh.statement, html: gate(draft.freshHtml ?? `<p>${pack.hypotheses.fresh.statement}</p>`) } : null,
      readings: draft.readings.map((r) => ({ ...r, html: gate(r.html) })),
    },
    departments: draft.departments.map((d) => ({ ...d, html: gate(d.html) })),
    editor,
    research: { queries: lead.queries, roundsUsed: lead.rounds, webSearches: lead.webSearches, dropped: [...revisionRejected.map((s) => `revision discarded for ${s}: it introduced a figure the original did not state`), ...figures.dropped.map((d) => `figure dropped: ${d}`)] },
    citedTags: [],
    dropped: [...new Set(dropped)],
    models: { writer: prefs.writer_model, editor: prefs.editor_model, lead: leadModel },
    revised,
    figures: figures.figures,
  };

  let id: string;
  try {
    id = await saveGeneratedReport({
      kind: 'savant', subject: pack.self?.name ?? null, title: narrative.title,
      scope_from: pack.windowFrom.slice(0, 10), scope_to: weekEnd, pack, narrative, generated_at: pack.generatedAt, isPublished: true,
    });
  } catch (e) {
    if ((e as { code?: string } | null)?.code === '23505') return { skipped: `issue exists for week ending ${weekEnd}` };
    throw e;
  }

  // 7. The ledger: this week's reading of every open hypothesis, and the
  // lead's reading of the fresh one.
  for (const r of narrative.hypotheses.readings) {
    const hrefs = [...r.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).slice(0, 6);
    const status = r.direction === 'closed' ? 'closed' : r.direction === 'unchanged' ? 'open' : r.direction;
    await updateHypothesis(r.id, { week: weekEnd, direction: r.direction === 'closed' ? 'unchanged' : r.direction, note: r.note, hrefs }, status, r.verdict);
  }
  if (pack.hypotheses.fresh) {
    await updateHypothesis(pack.hypotheses.fresh.id, { week: weekEnd, direction: lead.reading, note: lead.readingNote, hrefs: [] }, lead.reading === 'unchanged' ? 'open' : lead.reading, null);
  }

  // 8. Email.
  const wantEmail = opts.email ?? prefs.email_enabled;
  let sent: string[] | undefined; let failed: { email: string; error: string }[] | undefined;
  if (wantEmail) {
    const saved: SavedSavantIssue = { id, week_end: weekEnd, pack, narrative, is_published: true, generated_at: pack.generatedAt };
    const r = await sendSavantIssue(saved, opts.origin ?? process.env.APP_BASE_URL ?? '').catch((e) => ({ sent: [], failed: [{ email: '*', error: e instanceof Error ? e.message : 'email error' }] }));
    sent = r.sent; failed = r.failed;
  }
  return { id, weekEnd, issueNumber: pack.issueNumber, title: narrative.title, sent, failed, ...(replaced ? { replaced: true } : {}) };
}

// A department revision round-trips through markdown; departments are
// stored as html. Good enough for the sanitized subset (p, strong, em, a, ul/li).
function htmlToMd(html: string): string {
  return html
    .replace(/<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, '[$2]($1)')
    .replace(/<(strong|b)>([\s\S]*?)<\/\1>/g, '**$2**')
    .replace(/<(em|i)>([\s\S]*?)<\/\1>/g, '*$2*')
    .replace(/<li>([\s\S]*?)<\/li>/g, '- $1\n')
    .replace(/<\/p>\s*<p>/g, '\n\n')
    .replace(/<[^>]+>/g, '')
    .trim();
}
