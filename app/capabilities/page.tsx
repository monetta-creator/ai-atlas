import Link from 'next/link';
import type { Metadata } from 'next';
import { getPortalIdentity } from '@/lib/portal/identity';
import { capabilitiesFor } from '@/lib/capabilities/registry';
import { trigger, type AgentManifest, type Capability, type SkillManifest, type ToolManifest } from '@/lib/capabilities/types';
import PageTop from '@/components/PageTop';
import PortalUnlock from '@/components/datasets/PortalUnlock';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'What the bar can do · The AI Atlas' };

const usd = (n: number) => `$${n.toFixed(2)}`;
const timeLabel = (s: number) => (s < 90 ? `${s}s` : `about ${Math.round(s / 60)} min`);

function Examples({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <ul className="cap-examples">
      {items.map((ex) => (
        <li key={ex}>
          <Link href={`/ask?q=${encodeURIComponent(ex)}`} className="cap-example">
            <code>{ex}</code>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Card({ c }: { c: SkillManifest | AgentManifest }) {
  const meta: string[] = [];
  if (c.typical) meta.push(`Typical ${timeLabel(c.typical.seconds)}, ${usd(c.typical.usd)}`);
  meta.push(`Capped at ${usd(c.caps.perRunUsd)} a run`);
  if (c.kind === 'agent') meta.push(`Produces ${c.artifact.kind}`);
  return (
    <article className="cap-card plate">
      <h3 className="cap-title">
        <code className="cap-trigger">{trigger(c)}</code>
        <span>{c.title}</span>
      </h3>
      <p className="cap-line">{c.oneLiner}</p>
      <p className="cap-usage"><span className="cap-label">Usage</span> <code>{c.usage}</code></p>
      <Examples items={c.examples} />
      <p className="cap-meta">{meta.join(' · ')}</p>
    </article>
  );
}

function Section({ id, label, blurb, children }: { id: string; label: string; blurb: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="cap-section">
      <div className="section-label" id={id}>{label}</div>
      <p className="cap-blurb">{blurb}</p>
      {children}
    </section>
  );
}

// The catalog of everything the Ask bar can reach, generated from the
// capability manifests (lib/capabilities/registry.ts), never hand-written.
// Admins see the admin audience, access-key holders the keyholder audience.
export default async function CapabilitiesPage() {
  const identity = await getPortalIdentity();
  const admin = identity.tier === 'admin';
  const viewer = { admin, portal: identity.active };

  if (!admin && !identity.active) {
    return (
      <section className="wrap cap-page" style={{ paddingBottom: 100 }}>
        <PageTop pathname="/capabilities" label="What the bar can do" viewer={viewer} title={<h1>What the bar can do</h1>} />
        <p className="cap-blurb">
          Every skill, agent, and tool behind the Ask bar, with how to call each one. It is open to access-key holders.
        </p>
        <PortalUnlock keyState={identity.state === 'expired' || identity.state === 'revoked' ? identity : null} />
      </section>
    );
  }

  const all: Capability[] = capabilitiesFor(admin ? 'admin' : 'keyholder');
  const skills = all.filter((c): c is SkillManifest => c.kind === 'skill');
  const agents = all.filter((c): c is AgentManifest => c.kind === 'agent');
  const tools = all.filter((c): c is ToolManifest => c.kind === 'tool');

  return (
    <section className="wrap cap-page" style={{ paddingBottom: 100 }}>
      <PageTop pathname="/capabilities" label="What the bar can do" viewer={viewer} title={<h1>What the bar can do</h1>} />
      <p className="cap-blurb">
        Type <code>/</code> in the Ask bar for a skill or <code>@</code> for an agent. Click any example to run it there.
      </p>

      <Section id="cap-skills" label="Skills" blurb="Short recipes the bar follows for one answer. Start a message with the slash command.">
        <div className="cap-grid">{skills.map((c) => <Card key={c.slug} c={c} />)}</div>
      </Section>

      <Section id="cap-agents" label="Agents" blurb="Longer jobs that plan first, run in the background, and leave a finished artifact.">
        <div className="cap-grid">{agents.map((c) => <Card key={c.slug} c={c} />)}</div>
      </Section>

      <Section id="cap-tools" label="Tools the model uses on its own" blurb="You never call these. The bar picks them while it answers.">
        <ul className="cap-tools">
          {tools.map((c) => (
            <li key={c.slug} className="cap-tool">
              <span className="cap-tool-name">{c.title}</span>
              <span className="cap-tool-line">{c.oneLiner}</span>
            </li>
          ))}
        </ul>
      </Section>
    </section>
  );
}
