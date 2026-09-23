import Link from 'next/link';
import { adminGate } from '@/lib/admin-gate';
import { getTickets, getNavCounts } from '@/lib/data';
import type { TicketKind, TicketStatus } from '@/lib/types';
import { getEditContext } from '@/lib/content';
import Editable from '@/components/Editable';
import PageTop from '@/components/PageTop';
import TicketRow from '@/components/TicketRow';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Tickets · The AI Atlas' };

const KINDS = new Set(['bug', 'feature']);
const STATUSES = new Set(['open', 'in_progress', 'resolved', 'declined']);

// The feedback desk (admin): every bug report and feature request filed from
// the rail dialogs, filterable by kind and status; open/in-progress first.
export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; status?: string }>;
}) {
  const gate = await adminGate('/tickets', 'Tickets');
  if (gate) return gate;
  // Started before the page's own reads so the tab badges load beside them.
  const countsP = getNavCounts().catch(() => null);
  const admin = true as const;
  const { editing, txt } = await getEditContext();
  const sp = await searchParams;
  const kind = sp.kind && KINDS.has(sp.kind) ? (sp.kind as TicketKind) : undefined;
  const status = sp.status && STATUSES.has(sp.status) ? (sp.status as TicketStatus) : undefined;
  const tickets = await getTickets({ kind, status });
  const openCount = tickets.filter((t) => t.status === 'open').length;
  const counts = await countsP;

  const chip = (href: string, label: string, active: boolean) => (
    <Link key={href} href={href} className="touch-chip"
      style={{ fontSize: 12, padding: '5px 13px', ...(active ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}) }}>
      {label}
    </Link>
  );

  return (
    <>
      <section className="wrap" style={{ maxWidth: 900, paddingBottom: 100 }}>
        <PageTop
          pathname="/tickets"
          label="Tickets"
          viewer={{ admin, portal: admin }}
          counts={counts}
          title={
            <Editable
              as="h1"
              k="tickets.title"
              value={txt('tickets.title', 'Tickets')}
              editing={editing}
            />
          }
        />
        <nav aria-label="Filters" className="flex items-center gap-2 flex-wrap" style={{ marginBottom: 20 }}>
          {chip('/tickets', 'All', !kind && !status)}
          {chip('/tickets?kind=bug', 'Bugs', kind === 'bug')}
          {chip('/tickets?kind=feature', 'Features', kind === 'feature')}
          {chip('/tickets?status=open', 'Open', status === 'open')}
          {chip('/tickets?status=in_progress', 'In progress', status === 'in_progress')}
          {chip('/tickets?status=resolved', 'Resolved', status === 'resolved')}
          {chip('/tickets?status=declined', 'Declined', status === 'declined')}
        </nav>

        {tickets.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--faint-ink)' }}>
            Nothing here. Either the Atlas is flawless or nobody has found the little bug button yet.
          </p>
        ) : (
          <>
            {openCount > 0 && !status && (
              <div className="section-label">Open · {openCount}</div>
            )}
            <div className="flex flex-col gap-[10px]">
              {tickets.map((t) => <TicketRow key={t.id} ticket={t} />)}
            </div>
          </>
        )}
      </section>
    </>
  );
}
