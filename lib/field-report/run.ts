import { markJobStep, finishUiJob, parkUiJob, failUiJob } from '../mutations/jobs';
import { saveGeneratedReport } from '../mutations/reports';
import {
  getFieldReportPrefs, getRun, parkLeg, setRunStatus, fieldReportSpendToday, runCostUsd,
} from './store';
import { researchAtlas, researchWeb, resolveLinks, type AtlasLeg, type WebLeg } from './research';
import { writeReport, reviewDraft, reviseDraft, renderReport, buildAllowlist, type EditorVerdict } from './write';
import { planFieldReportFigures } from './figures';
import { draftIssues, parseReportMarkdown, fieldReportSteps, type FieldReportNarrative, type FieldReportPack } from './core';

// The Field Report run (docs/field-report.md): legs in order, each parked on
// the run row so a run that hits its deadline pauses and resumes from the
// next leg; every leg moves the ui_jobs steps the thread card polls. Called
// from the run route inside after(), so it outlives the request.

type LegKey = 'atlas' | 'web' | 'draft' | 'review' | 'revised' | 'figures';
// The least time a leg needs to start (writing a Full report takes a while).
const FLOOR_MS: Record<LegKey, number> = { atlas: 150_000, web: 90_000, draft: 150_000, review: 60_000, revised: 150_000, figures: 60_000 };

export async function runFieldReport(runId: string, opts: { deadlineMs: number }): Promise<'done' | 'paused' | 'failed'> {
  const started = Date.now();
  const deadline = started + opts.deadlineMs;
  const run = await getRun(runId);
  if (!run || !run.job_id) return 'failed';
  const jobId = run.job_id;
  const prefs = await getFieldReportPrefs();
  const size = run.size;
  const models = prefs.models[size];
  const effort = prefs.effort[size];
  const keyId = run.created_by.startsWith('key:') ? run.created_by.slice(4) : null;
  const mode: 'admin' | 'portal' = keyId ? 'portal' : 'admin';
  const metadata: Record<string, unknown> = { field_report_run: runId, size, ...(keyId ? { portal_key_id: keyId } : {}) };
  const legs = run.legs as Partial<Record<LegKey, unknown>>;
  const steps = fieldReportSteps(size);
  const timeFor = (k: LegKey) => deadline - Date.now() >= FLOOR_MS[k];
  // A keyholder over either daily cap skips the optional legs (web, editor)
  // and still gets a written report from what was gathered.
  const overCap = async () => {
    if (!keyId) return false;
    const spent = await fieldReportSpendToday(keyId);
    return spent.key >= prefs.keyDailyUsd || spent.allKeys >= prefs.allKeysDailyUsd;
  };
  const step = async (key: string, state: 'running' | 'done' | 'skipped', note?: string) => {
    const label = steps.find((s) => s.key === key)?.label;
    await markJobStep(jobId, key, state === 'skipped' ? 'done' : state, { note: state === 'skipped' ? (note ?? 'skipped') : note ?? null, label }).catch(() => {});
  };
  const pause = async (why: string) => {
    await setRunStatus(runId, 'paused', { error: null });
    await parkUiJob(jobId, why).catch(() => {});
    return 'paused' as const;
  };

  try {
    const ctx = {
      plan: run.plan, question: run.question, size, effort, mode, metadata,
      webSearches: prefs.webSearches[size],
    };

    // 1. Atlas research, one track per sub-question.
    let atlas = legs.atlas as AtlasLeg | undefined;
    if (!atlas) {
      if (!timeFor('atlas')) return await pause('Out of time before the Atlas research; resume to continue.');
      await step('atlas', 'running');
      atlas = await researchAtlas(
        { ...ctx, model: models.research, deadline: deadline - FLOOR_MS.draft - (size === 'full' ? FLOOR_MS.web : 30_000) },
        (done, total) => { void markJobStep(jobId, 'atlas', 'running', { note: `${done} of ${total} tracks researched` }).catch(() => {}); },
      );
      await parkLeg(runId, 'atlas', atlas);
    }
    await step('atlas', 'done');

    // 2. Web gap-fill.
    let web = legs.web as WebLeg | undefined;
    if (!web) {
      if (await overCap()) {
        web = { memo: '', sources: [], log: [], searches: 0 };
        await step('web', 'skipped', 'Skipped: today\'s Field Report allowance for this key is used up');
      } else if (!timeFor('web')) {
        return await pause('Out of time before the web research; resume to continue.');
      } else {
        await step('web', 'running');
        web = await researchWeb({ ...ctx, model: models.research, deadline: deadline - FLOOR_MS.draft }, atlas);
        await step('web', 'done', web.sources.length ? `${web.sources.length} web sources` : 'No web sources added');
      }
      await parkLeg(runId, 'web', web);
    } else {
      await step('web', 'done');
    }

    // 3. Write.
    let draft = legs.draft as string | undefined;
    if (!draft) {
      if (!timeFor('draft')) return await pause('Out of time before writing; resume to continue.');
      await step('write', 'running');
      draft = await writeReport({
        plan: run.plan, question: run.question, size, tracks: atlas.tracks, webMemo: web.memo, web: web.sources,
        model: models.writer, effort, metadata,
      });
      if (!draft.includes('## ')) throw new Error('The writer returned no report.');
      await parkLeg(runId, 'draft', draft);
    }
    await step('write', 'done');

    // 4. Full: the editor and one revision.
    let final = draft;
    let review: EditorVerdict | null = null;
    if (size === 'full') {
      review = (legs.review as EditorVerdict | undefined) ?? null;
      if (!review) {
        if (await overCap()) {
          await step('editor', 'skipped', 'Skipped: today\'s allowance is used up');
          await step('revise', 'skipped', 'Skipped');
        } else if (!timeFor('review')) {
          return await pause('Out of time before the editor; resume to continue.');
        } else {
          await step('editor', 'running');
          review = await reviewDraft({ draft, issues: draftIssues(parseReportMarkdown(draft)), question: run.question, model: models.editor, effort, metadata });
          await parkLeg(runId, 'review', review);
        }
      }
      if (review) {
        await step('editor', 'done', review.verdict.replace(/_/g, ' '));
        let revised = legs.revised as string | undefined;
        if (!revised) {
          if (!timeFor('revised')) return await pause('Out of time before the revision; resume to continue.');
          await step('revise', 'running');
          revised = await reviseDraft({ draft, review, model: models.writer, effort, metadata });
          await parkLeg(runId, 'revised', revised);
        }
        final = revised;
        await step('revise', 'done');
      }
    }

    // 5. Link, label, gate; Full then plans figures over the rendered text.
    const links = await resolveLinks(atlas);
    const rendered = renderReport(final, { tagHrefs: links.tagHrefs, codeHrefs: links.codeHrefs, web: web.sources });
    let figures = (legs.figures as { figures: unknown[]; dropped: string[] } | undefined) ?? null;
    if (size === 'full' && !figures) {
      if (await overCap()) {
        await step('figures', 'skipped', 'Skipped: today\'s allowance is used up');
      } else if (!timeFor('figures')) {
        return await pause('Out of time before the figures; resume to continue.');
      } else {
        await step('figures', 'running');
        // A failed figure leg costs the report its figures, never the report.
        figures = await planFieldReportFigures({
          sections: rendered.sections,
          allowed: buildAllowlist(links.tagHrefs, links.codeHrefs, web.sources).hrefs,
          records: links.records, web: web.sources, model: models.figures, metadata,
        }).catch((e) => ({ figures: [], dropped: [`figure leg failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200)] }));
        await parkLeg(runId, 'figures', figures);
        await step('figures', 'done', figures.figures.length ? `${figures.figures.length} figures` : 'No figure earned its place');
      }
    } else if (size === 'full') {
      await step('figures', 'done');
    }

    await step('save', 'running');
    const costUsd = await runCostUsd(runId);
    const pack: FieldReportPack = {
      kind: 'field_report', runId, question: run.question, plan: run.plan, size, models,
      research: {
        log: [...atlas.log, ...web.log], rounds: atlas.rounds, webSearches: web.searches,
        dropped: [
          ...rendered.dropped.map((d) => `link removed by the citation gate: ${d}`),
          ...(figures?.dropped ?? []).map((d) => `figure dropped: ${d}`),
        ],
      },
      records: links.records, web: web.sources, provenance: rendered.provenance,
      costUsd, createdBy: run.created_by, generatedAt: new Date().toISOString(),
    };
    const narrative: FieldReportNarrative = {
      title: run.plan.title, summary: rendered.summary, sections: rendered.sections,
      editor: review ? { name: review.name, verdict: review.verdict, note: review.note } : null,
      figures: figures?.figures ?? [],
    };
    const reportId = await saveGeneratedReport({
      kind: 'field_report', subject: runId, title: run.plan.title, scope_from: null, scope_to: null,
      pack, narrative, generated_at: pack.generatedAt, isPublished: false, createdBy: keyId ? `key:${keyId}` : null,
    });
    await setRunStatus(runId, 'done', { reportId });
    await step('save', 'done');
    await finishUiJob(jobId, `/field-reports/${reportId}`).catch(() => null);
    return 'done';
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await setRunStatus(runId, 'failed', { error: msg.slice(0, 500) });
    await failUiJob(jobId, msg.slice(0, 300)).catch(() => {});
    return 'failed';
  }
}
