import { adminGate } from '@/lib/admin-gate';
import { getBoardWidgets, getNavCounts } from '@/lib/data';
import { OPS_JOBS } from '@/lib/ops/registry';
import PageTop from '@/components/PageTop';
import WidgetBoard from '@/components/lobby/WidgetBoard';
import CustomizeWidgets from '@/components/lobby/CustomizeWidgets';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const metadata = { title: 'Operations · The AI Atlas' };

// The one authoritative view of everything that runs in the background,
// now a customizable widget board (2026-09-27): every section that used to
// be hard-coded here (today's timeline, the job cards, the 14-day history
// grid, background work, the agent, Savant's week, spend by feature, model
// runs) is a widget in components/ops/widgets/*, arranged the same way the
// lobby board is. It is read fresh on every page load and never polls
// (2026-09-28: the 60 s auto-refresh re-ran every widget each minute; a
// handful of readers do not need it). Each widget streams in its own
// Suspense slot (WidgetBoard). Each widget reads lib/data/ops.ts
// (getOpsStatus / getOpsHistory / getOpsBackground) or its own domain's data
// module directly.
export default async function OpsPage() {
  const gate = await adminGate('/ops', 'Operations');
  if (gate) return gate;
  const admin = true as const;

  const [widgets, counts] = await Promise.all([
    getBoardWidgets('ops'),
    getNavCounts().catch(() => null),
  ]);

  return (
    <section className="wrap" style={{ maxWidth: 1180, paddingBottom: 100 }}>
      <PageTop pathname="/ops" label="Operations" viewer={{ admin, portal: admin }} counts={counts}>
        {OPS_JOBS.length} registered jobs across every /api/cron/* schedule
      </PageTop>

      <div className="ops-page">
        <div className="lobby-customize-row"><CustomizeWidgets board="ops" active={widgets} /></div>
        <WidgetBoard board="ops" widgets={widgets} personal />
      </div>
    </section>
  );
}
