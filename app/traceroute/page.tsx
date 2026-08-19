import Link from 'next/link';
import { isAdmin, isPreview } from '@/lib/auth';
import Header from '@/components/Header';
import Traceroute from '@/components/traceroute/Traceroute';
import { getSupplyChain } from '@/lib/supply-chain/data';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Traceroute · The AI Atlas',
  description: 'What happens between pressing enter on a cloud language model and the first token coming back.',
};

// No maxDuration: nothing on this page calls a model. The whole inference walkthrough is
// scripted, which is what keeps the app's property that no public surface can trigger an
// LLM call (see the deliberate isAdmin gate on app/api/ask/route.ts).

export default async function TraceroutePage() {
  const admin = await isAdmin();
  const preview = await isPreview();
  const personal = admin && !preview;

  // Only the supply-chain overlay needs the server. The stop, prop, architecture, and run
  // data are pure modules the client imports directly, so none of it rides the wire twice.
  const { nodes } = await getSupplyChain(personal);
  const scNodes = nodes.map((n) => ({
    slug: n.slug,
    name: n.name,
    risk: n.risk,
    isChokepoint: n.isChokepoint,
    signalCount: n.signalCount,
    actors: n.actors,
    blurb: n.blurb ?? null,
  }));

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 1180, paddingBottom: 100 }}>
        <div className="crumbs">
          <Link href="/map">Map</Link> / Traceroute
        </div>
        <header className="pagehead" style={{ padding: '24px 0 22px' }}>
          <h1>Traceroute</h1>
          <p className="lede">
            Language models run locally or in a datacenter. This traces a cloud request end to
            end: what happens between pressing enter and the first token coming back.
          </p>
        </header>

        <Traceroute scNodes={scNodes} />
      </section>
    </>
  );
}
