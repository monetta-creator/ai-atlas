import Link from 'next/link';
import { listFindings, getLatestBrief } from '@/lib/data/agent';

const SEVERITY_LABEL: Record<string, string> = { high: 'high', warn: 'warn', info: 'info' };

// 'ops-agent': open findings by severity, the top few, and the latest brief.
export default async function OpsAgent() {
  let findings: Awaited<ReturnType<typeof listFindings>>;
  let brief: Awaited<ReturnType<typeof getLatestBrief>>;
  try {
    [findings, brief] = await Promise.all([listFindings({ limit: 200 }), getLatestBrief()]);
  } catch {
    return <div className="lw-fail">Widget unavailable</div>;
  }

  const open = findings.filter((f) => f.state === 'open');
  const counts: Record<string, number> = {};
  for (const f of open) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  const top = open.slice(0, 5);

  return (
    <>
      <div className="lw-head">Atlas Agent</div>
      <div className="lw-big">{open.length}</div>
      <div className="lw-sub">
        open finding{open.length === 1 ? '' : 's'}
        {Object.keys(counts).length > 0 && (
          <> · {Object.entries(counts).map(([sev, n]) => `${n} ${SEVERITY_LABEL[sev] ?? sev}`).join(', ')}</>
        )}
      </div>
      {top.length > 0 && (
        <ul className="ops-notes" style={{ fontSize: 12, marginTop: 8 }}>
          {top.map((f) => (
            <li key={f.id} data-error={f.severity === 'high' ? 'true' : undefined}>{f.title}</li>
          ))}
        </ul>
      )}
      {brief && (
        <div className="lw-sub" style={{ marginTop: 6 }}>
          Latest brief ({brief.day}): {brief.memo?.headline ?? '–'}
        </div>
      )}
      <Link href="/agent" className="lw-foot">Atlas Agent →</Link>
    </>
  );
}
