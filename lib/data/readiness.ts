import { one } from '../db';
import { getScanPrefs } from './scan';
import { getPipelinePrefs } from './pipeline';
import { getIntelPrefs } from './intel';

// ---- Daily job readiness (the /page.tsx "cron-tracker" widget) -------------
// A single read over the three cron subsystems (scan, pipeline, intel) that
// answers "is today's data ready?" without sending an admin to three
// consoles. A run ROW for today (any status) always wins over the prefs/
// weekend guess: a manual weekend run still reports its real state.

export type JobKey = 'scan' | 'pipeline' | 'intel';
export type JobState = 'off' | 'paused' | 'pending' | 'running' | 'done' | 'failed';

export interface DailyJob {
  key: JobKey;
  label: string;
  console: string;
  state: JobState;
  step: string | null;
  detail: string | null;
  finishedAtET: string | null;
  error: string | null;
}

export interface DailyJobStatus {
  day: string;
  weekend: boolean;
  ready: boolean;
  readyAtET: string | null;
  jobs: DailyJob[];
}

interface RunRowBase {
  status: string;
  step: string;
  error: string | null;
  finished_et: string | null;
  finished_epoch: number | null;
}

interface ScanRunRow extends RunRowBase {
  found: number;
  enriched_count: number;
}

interface PipelineRunRow extends RunRowBase {
  candidate_count: number;
  signal_count: number;
}

interface IntelRunRow extends RunRowBase {
  found: number;
  fact_count: number;
  metric_count: number;
}

// Eastern-time finish stamp ('H:MM AM') plus the raw epoch (for picking the
// latest finish across jobs) — one shared tail for all three run queries.
const RUN_TIME_COLUMNS = `
  to_char(updated_at at time zone 'America/New_York', 'FMHH12:MI AM') as finished_et,
  extract(epoch from updated_at) as finished_epoch`;

function getScanRunToday(): Promise<ScanRunRow | null> {
  return one<ScanRunRow>(
    `select status::text as status, step::text as step,
            feed_item_count + search_item_count as found, enriched_count, error,
            ${RUN_TIME_COLUMNS}
       from scan_runs where day = (now() at time zone 'utc')::date`
  );
}

function getPipelineRunToday(): Promise<PipelineRunRow | null> {
  return one<PipelineRunRow>(
    `select status::text as status, step::text as step, candidate_count, signal_count, error,
            ${RUN_TIME_COLUMNS}
       from pipeline_runs
      where cadence = 'daily' and created_at >= date_trunc('day', now() at time zone 'utc')
      order by created_at desc limit 1`
  );
}

function getIntelRunToday(): Promise<IntelRunRow | null> {
  return one<IntelRunRow>(
    `select status::text as status, step::text as step,
            feed_item_count + search_item_count + filing_item_count as found,
            fact_count, metric_count, error,
            ${RUN_TIME_COLUMNS}
       from intel_runs where day = (now() at time zone 'utc')::date`
  );
}

// Row-vs-prefs-vs-weekend precedence: a run row (any status) always wins;
// only its absence falls back to paused (prefs disabled) then off (weekend)
// then pending (a weekday run just hasn't started or checkpointed yet).
function resolveJob(
  key: JobKey,
  label: string,
  consoleHref: string,
  row: RunRowBase | null,
  detail: string | null,
  enabled: boolean,
  weekend: boolean
): DailyJob {
  if (row) {
    if (row.status === 'running') {
      return { key, label, console: consoleHref, state: 'running', step: row.step, detail, finishedAtET: null, error: null };
    }
    if (row.status === 'completed') {
      return { key, label, console: consoleHref, state: 'done', step: null, detail, finishedAtET: row.finished_et, error: null };
    }
    if (row.status === 'failed') {
      return {
        key, label, console: consoleHref, state: 'failed', step: null, detail,
        finishedAtET: null, error: row.error ? row.error.slice(0, 120) : null,
      };
    }
  }
  const state: JobState = !enabled ? 'paused' : weekend ? 'off' : 'pending';
  return { key, label, console: consoleHref, state, step: null, detail: null, finishedAtET: null, error: null };
}

export async function getDailyJobStatus(): Promise<DailyJobStatus> {
  const [scanPrefs, pipelinePrefs, intelPrefs, scanRow, pipelineRow, intelRow] = await Promise.all([
    getScanPrefs(),
    getPipelinePrefs(),
    getIntelPrefs(),
    getScanRunToday(),
    getPipelineRunToday(),
    getIntelRunToday(),
  ]);

  const day = new Date().toISOString().slice(0, 10);
  const weekendDow = new Date().getUTCDay();
  const weekend = weekendDow === 0 || weekendDow === 6;

  const scanDetail = scanRow ? `${scanRow.found} items · ${scanRow.enriched_count} enriched` : null;
  const pipelineDetail = pipelineRow
    ? `${pipelineRow.candidate_count} candidates · ${pipelineRow.signal_count} drafts`
    : null;
  const intelDetail = intelRow
    ? `${intelRow.found} items · ${intelRow.fact_count} facts` +
      (intelRow.metric_count > 0 ? ` · ${intelRow.metric_count} metrics` : '')
    : null;

  const jobs: DailyJob[] = [
    resolveJob('scan', 'External scan', '/scan', scanRow, scanDetail, scanPrefs.enabled, weekend),
    resolveJob('pipeline', 'Discovery pipeline', '/pipeline', pipelineRow, pipelineDetail, pipelinePrefs.enabled, weekend),
    resolveJob('intel', 'Intel desk', '/intel', intelRow, intelDetail, intelPrefs.enabled, weekend),
  ];

  const considered = jobs.filter((j) => j.state !== 'off' && j.state !== 'paused');
  const ready = considered.length > 0 && considered.every((j) => j.state === 'done');

  let readyAtET: string | null = null;
  if (ready) {
    const rows: (RunRowBase | null)[] = [scanRow, pipelineRow, intelRow];
    const doneRows = rows.filter((r): r is RunRowBase => !!r && r.status === 'completed');
    readyAtET = doneRows.length
      ? doneRows.reduce((max, r) => ((r.finished_epoch ?? 0) > (max.finished_epoch ?? 0) ? r : max)).finished_et
      : null;
  }

  return { day, weekend, ready, readyAtET, jobs };
}
