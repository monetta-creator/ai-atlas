import { notFound, redirect } from 'next/navigation';
import { isAdmin, isPortal } from '@/lib/auth';
import { getGeneratedReport } from '@/lib/data';
import PageTop from '@/components/PageTop';
import SheetReadView from '@/components/reports/SheetReadView';
import SheetActions from './SheetActions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Report · The AI Atlas' };

const UUID_RE = /^[0-9a-f-]{36}$/i;

// Read view of a generated report: public once published, admin-only as a
// draft, 404 otherwise. The four tooling report kinds add one more allowed
// viewer: a portal keyholder may read a draft too (the /tooling/reports
// console never auto-publishes a landscape/brief/features report). The admin
// bar on top carries publish/delete.
export default async function SheetPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await isAdmin();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const saved = await getGeneratedReport(id);
  if (!saved) notFound();
  // Editions are generated_reports rows too, but they read at /blotter/<day>,
  // not here: send anyone who lands on a sheet URL for one straight there.
  if (saved.kind === 'edition' && saved.scope_to) redirect(`/blotter/${saved.scope_to}`);
  const isTooling = String(saved.kind).startsWith('tooling_');
  const portal = isTooling && (await isPortal());
  if (!(saved.is_published || admin || portal)) notFound();

  return (
    <>
      <section className="wrap" style={{ maxWidth: 860, paddingBottom: 100 }}>
        <PageTop
          pathname={`/reports/sheet/${saved.id}`}
          label={saved.title.slice(0, 60)}
          compact
          title={null}
          viewer={{ admin, portal: portal || admin }}
          infoKey="/reports/sheet/[id]"
          action={<SheetActions id={saved.id} published={saved.is_published} admin={admin} />}
        />
        <SheetReadView saved={saved} viewer={{ admin, portal }} />
      </section>
    </>
  );
}
