import Link from 'next/link';
import { requireAdminPage } from '@/lib/auth';
import { getAllDomainRows, getNodeLensMap } from '@/lib/data';
import Header from '@/components/Header';
import DataField from '@/components/DataField';
import LensTagger from '@/components/LensTagger';
import WorkspaceTabs, { MAP_EDITOR_TABS } from '@/components/WorkspaceTabs';

export const dynamic = 'force-dynamic';

export default async function DataPage() {
  const admin = await requireAdminPage();

  const [{ questions, stances, claims, bridges }, lensMap] = await Promise.all([
    getAllDomainRows(),
    getNodeLensMap(),
  ]);
  const lensesFor = (type: string, id: string) => lensMap[`${type}:${id}`] ?? [];

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 820, paddingBottom: 100 }}>
        <div className="crumbs">
          <Link href="/map">Map</Link> / Data
        </div>
        <header className="pagehead" style={{ padding: '24px 0 22px' }}>
          <h1>Data</h1>
          <p className="lede">
            Edit the text of the records directly. Saves write straight to the database and show
            across the site. Confidence keeps its own editor on the detail pages, and codes stay
            fixed.
          </p>
        </header>
        <WorkspaceTabs tabs={MAP_EDITOR_TABS} active="/data" />

        <div className="data-section">
          <h2>Questions ({questions.length})</h2>
          {questions.map((qq) => (
            <div className="datacard" key={qq.id}>
              <div className="datacard__id">
                <span>{qq.slug}</span>
              </div>
              <DataField table="questions" id={qq.id} column="title" value={qq.title} label="Title" required multiline />
              <DataField table="questions" id={qq.id} column="summary" value={qq.summary} label="Summary" multiline />
            </div>
          ))}
        </div>

        <div className="data-section">
          <h2>Stances ({stances.length})</h2>
          {stances.map((s) => (
            <div className="datacard" key={s.id}>
              <div className="datacard__id">
                <span>{s.code}</span>
              </div>
              <DataField table="stances" id={s.id} column="title" value={s.title} label="Title" required multiline />
              <DataField table="stances" id={s.id} column="holder" value={s.holder} label="Holder" />
              <DataField table="stances" id={s.id} column="summary" value={s.summary} label="Summary" multiline />
              <DataField table="stances" id={s.id} column="test" value={s.test} label="Test" required multiline />
              <LensTagger targetType="stance" targetId={s.id} statement={s.title} initial={lensesFor('stance', s.id)} />
            </div>
          ))}
        </div>

        <div className="data-section">
          <h2>Claims ({claims.length})</h2>
          {claims.map((c) => (
            <div className="datacard" key={c.id}>
              <div className="datacard__id">
                <span>{c.code}</span>
                {c.is_frame && <span className="badge badge--dashed">frame</span>}
              </div>
              <DataField table="claims" id={c.id} column="statement" value={c.statement} label="Statement" required multiline />
              {!c.is_frame && (
                <DataField table="claims" id={c.id} column="test" value={c.test} label="Test" required multiline />
              )}
              <DataField table="claims" id={c.id} column="domain_note" value={c.domain_note} label="Domain note" />
              {!c.is_frame && (
                <LensTagger targetType="claim" targetId={c.id} statement={c.statement} initial={lensesFor('claim', c.id)} />
              )}
            </div>
          ))}
        </div>

        <div className="data-section">
          <h2>Bridge-claims ({bridges.length})</h2>
          {bridges.map((b) => (
            <div className="datacard" key={b.id}>
              <div className="datacard__id">
                <span>{b.code}</span>
              </div>
              <DataField table="bridge_claims" id={b.id} column="statement" value={b.statement} label="Statement" required multiline />
              <DataField table="bridge_claims" id={b.id} column="test" value={b.test} label="Test" required multiline />
              <DataField table="bridge_claims" id={b.id} column="note" value={b.note} label="Note" multiline />
              <LensTagger targetType="bridge_claim" targetId={b.id} statement={b.statement} initial={lensesFor('bridge_claim', b.id)} />
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
