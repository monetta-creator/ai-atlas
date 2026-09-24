import { isAdmin, isPortal, isPreview } from '@/lib/auth';
import { getSchemaTables } from '@/lib/schema/introspect';
import { layoutGroups, clusterEdges, ACCESS_TIER, DATASET_TABLES } from '@/lib/schema/layout';
import { DATASETS } from '@/lib/datasets/registry';
import PageTop from '@/components/PageTop';
import SchemaMap from '@/components/schema/SchemaMap';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Schema map · The AI Atlas' };

// The Data Portal's Schema map: a live, cached read of the public schema
// (lib/schema/introspect.ts, never a row of application data) laid out by
// subsystem (lib/schema/layout.ts, pure and test-guarded against a new
// migration landing with no placement). Public: names, types, counts, and
// comments only, the same guest-safety floor as every other dataset page.
export default async function SchemaMapPage() {
  const [adminFlag, portalFlag, preview, tables] = await Promise.all([
    isAdmin(), isPortal(), isPreview(), getSchemaTables(),
  ]);
  const admin = adminFlag && !preview;
  const viewer = { admin, portal: portalFlag || admin };

  const groups = layoutGroups(tables);
  const edges = clusterEdges(tables);
  const columnCount = tables.reduce((sum, t) => sum + t.columns.length, 0);
  const datasets = DATASETS.filter((d) => d.slug !== 'catalog').map((d) => ({
    slug: d.slug, title: d.title, keyGated: Boolean(d.keyGated),
  }));

  return (
    <section className="wrap" style={{ paddingBottom: 100 }}>
      <PageTop pathname="/datasets/schema" label="Schema map" viewer={viewer} />

      <p className="dp-schema-status">
        {tables.length} tables · {columnCount} columns · read live from the database, cached 10 minutes
      </p>

      <SchemaMap
        tables={tables}
        groups={groups}
        edges={edges}
        tiers={ACCESS_TIER}
        datasetTables={DATASET_TABLES}
        datasets={datasets}
      />
    </section>
  );
}
