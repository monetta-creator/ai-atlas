import type { WidgetComponent } from '@/components/lobby/widgets/registry';
import CronTracker from '@/components/lobby/widgets/CronTracker';
import DeskCounts from '@/components/lobby/widgets/DeskCounts';
import TodaysSpend from '@/components/lobby/widgets/TodaysSpend';
import TavilyQuota from '@/components/lobby/widgets/TavilyQuota';
import OpsTimeline from './OpsTimeline';
import OpsJobs from './OpsJobs';
import OpsSpend from './OpsSpend';
import OpsHistory from './OpsHistory';
import OpsBackground from './OpsBackground';
import OpsAgent from './OpsAgent';
import OpsSavantWeek from './OpsSavantWeek';
import OpsModelRuns from './OpsModelRuns';

// The operations board's widgets (/ops, admin only; server-only like the
// lobby registry). WidgetBoard never invokes an admin widget for a non-admin,
// so none of these read data for a guest.
export const OPS_WIDGET_COMPONENTS: Record<string, WidgetComponent> = {
  'cron-tracker': CronTracker,
  'desk-counts': DeskCounts,
  'todays-spend': TodaysSpend,
  'tavily-quota': TavilyQuota,
  'ops-timeline': OpsTimeline,
  'ops-jobs': OpsJobs,
  'ops-spend': OpsSpend,
  'ops-history': OpsHistory,
  'ops-background': OpsBackground,
  'ops-agent': OpsAgent,
  'ops-savant-week': OpsSavantWeek,
  'ops-model-runs': OpsModelRuns,
};
