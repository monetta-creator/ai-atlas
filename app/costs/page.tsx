import { requireAdminPage } from '@/lib/auth';
import { getCostDashboard } from '@/lib/data';
import Header from '@/components/Header';
import CostsDashboard from '@/components/CostsDashboard';
import WorkspaceTabs, { ANALYTICS_TABS } from '@/components/WorkspaceTabs';

// Admin-only AI cost console. force-dynamic (reads cookies + DB);
// the only server action it hosts (addRateCardAction) is a quick DB insert, not an AI call.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'AI costs · The Strategy Atlas' };

export default async function CostsPage() {
  const admin = await requireAdminPage();

  const data = await getCostDashboard();

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 1080, paddingBottom: 100 }}>
        <header className="pagehead">
          <h1>AI costs</h1>
          <p className="lede">
            Every Anthropic API call the app makes (spend, tokens, latency, and context-window
            use), priced from the active rate card and frozen at call time.
          </p>
        </header>
        <WorkspaceTabs tabs={ANALYTICS_TABS} active="/costs" />

        <CostsDashboard data={data} />
      </section>
    </>
  );
}
