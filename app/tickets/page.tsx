import Link from 'next/link';
import { requireAdminPage } from '@/lib/auth';
import { getTickets } from '@/lib/data';
import type { TicketKind, TicketStatus } from '@/lib/types';
import Header from '@/components/Header';
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
  const admin = await requireAdminPage();
  const sp = await searchParams;
  const kind = sp.kind && KINDS.has(sp.kind) ? (sp.kind as TicketKind) : undefined;
  const status = sp.status && STATUSES.has(sp.status) ? (sp.status as TicketStatus) : undefined;
  const tickets = await getTickets({ kind, status });
  const openCount = tickets.filter((t) => t.status === 'open').length;

  const chip = (href: string, label: string, active: boolean) => (
    <Link key={href} href={href} className="touch-chip"
      style={{ fontSize: 12, padding: '5px 13px', ...(active ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}) }}>
      {label}
    </Link>
  );

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 900, paddingBottom: 100 }}>
        <header className="pagehead" style={{ paddingBottom: 26 }}>
          <h1 style={{ marginBottom: 10 }}>Tickets</h1>
          <p className="lede" style={{ marginBottom: 20 }}>
            The feedback box: bugs found and features wished for, filed from the rail dialogs.
          </p>
          <nav aria-label="Filters" className="flex items-center gap-2 flex-wrap">
            {chip('/tickets', 'All', !kind && !status)}
            {chip('/tickets?kind=bug', 'Bugs', kind === 'bug')}
            {chip('/tickets?kind=feature', 'Features', kind === 'feature')}
            {chip('/tickets?status=open', 'Open', status === 'open')}
            {chip('/tickets?status=in_progress', 'In progress', status === 'in_progress')}
            {chip('/tickets?status=resolved', 'Resolved', status === 'resolved')}
            {chip('/tickets?status=declined', 'Declined', status === 'declined')}
          </nav>
        </header>

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
