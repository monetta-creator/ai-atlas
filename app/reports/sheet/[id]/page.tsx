import { notFound } from 'next/navigation';
import { isAdmin } from '@/lib/auth';
import { getGeneratedReport } from '@/lib/data';
import Header from '@/components/Header';
import SheetReadView from '@/components/reports/SheetReadView';
import SheetRow from '@/components/reports/SheetRow';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Report · The AI Atlas' };

const UUID_RE = /^[0-9a-f-]{36}$/i;

// Read view of a generated report: public once published, admin-only as a
// draft, 404 otherwise. The admin bar on top carries publish/delete.
export default async function SheetPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await isAdmin();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const saved = await getGeneratedReport(id);
  if (!saved) notFound();
  if (!saved.is_published && !admin) notFound();

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 860, paddingBottom: 100 }}>
        {admin && (
          <div style={{ marginTop: 24 }}>
            <SheetRow meta={saved} admin />
          </div>
        )}
        <SheetReadView saved={saved} />
      </section>
    </>
  );
}
