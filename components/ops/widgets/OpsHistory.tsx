import Link from 'next/link';
import { getOpsHistory, getOpsStatus } from '@/lib/data/ops';
import OpsHistoryGrid from '@/components/ops/OpsHistoryGrid';

const ISSUE_RE = /fail|error|skipped|quota|timeout/i;

interface Issue {
  key: string;
  href: string;
  label: string;
  note: string;
  at: string;
}

// 'ops-history': the 14-day grid, plus the recent run notes worth a second
// look (any job's last-run note matching a failure/quota/timeout pattern).
export default async function OpsHistory() {
  let rows: Awaited<ReturnType<typeof getOpsHistory>>;
  let status: Awaited<ReturnType<typeof getOpsStatus>> | null;
  try {
    [rows, status] = await Promise.all([getOpsHistory(14), getOpsStatus().catch(() => null)]);
  } catch {
    return <div className="lw-fail">Widget unavailable</div>;
  }

  const issues: Issue[] = [];
  for (const j of status?.jobs ?? []) {
    const at = j.lastRun?.finishedAt ?? j.lastRun?.startedAt ?? '';
    for (const note of j.lastRun?.notes ?? []) {
      if (ISSUE_RE.test(note)) issues.push({ key: j.job.key, href: j.job.consoleHref, label: j.job.label, note, at });
    }
  }
  issues.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const topIssues = issues.slice(0, 8);

  return (
    <>
      <div className="lw-head">Last 14 days</div>
      <OpsHistoryGrid rows={rows} />
      {topIssues.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="ops-h2">Recent issues</div>
          <ul className="ops-notes" style={{ fontSize: 12 }}>
            {topIssues.map((it, i) => (
              <li key={`${it.key}-${i}`} data-error="true">
                <Link href={it.href}>{it.label}</Link>: {it.note}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
