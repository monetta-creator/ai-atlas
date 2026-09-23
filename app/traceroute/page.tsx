import { isAdmin, isPreview } from '@/lib/auth';
import Header from '@/components/Header';
import PageTop from '@/components/PageTop';
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
        <PageTop
          pathname="/traceroute"
          label="Traceroute"
          viewer={{ admin: personal, portal: personal }}
        />

        <Traceroute scNodes={scNodes} />
      </section>
    </>
  );
}
