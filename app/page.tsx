import { isAdmin, isPreview } from '@/lib/auth';
import { getBoardWidgets } from '@/lib/data/home';
import LobbyAsk from '@/components/lobby/LobbyAsk';
import WidgetBoard from '@/components/lobby/WidgetBoard';
import CustomizeWidgets from '@/components/lobby/CustomizeWidgets';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'The AI Atlas' };

// The lobby (2026-08-30 widget-board rework; public-leaning since
// 2026-09-27): a greeting, the chat launcher, then the 'home' board, an
// ordered, admin-customizable set of widgets (lib/widgets/catalog.ts, the
// lobby registry in components/lobby/widgets/registry.tsx). The operations
// widgets moved to their own board at /ops. Guests see the same order minus
// any admin-only widget, filtered server-side in WidgetBoard before its data
// is ever fetched.

// Server-rendered time-of-day. Pinned to Eastern (a single-user tool with US
// colleagues) so the serverless region's clock never decides the greeting.
function greetingET(): string {
  const hour = Number(
    new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/New_York' })
  );
  return hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

// One greeting per landing, drawn at render time (the page is force-dynamic,
// so every visit rolls again): the time-of-day classic plus a few welcoming,
// Atlas-flavored lines.
function greeting(): string {
  const pool = [
    `${greetingET()}.`,
    'Welcome back.',
    'Hello, human.',
    'Signal over noise.',
    'The debate, mapped.',
    'What did AI do today?',
  ];
  return pool[Math.floor(Math.random() * pool.length)];
}

export default async function Lobby() {
  const admin = await isAdmin();
  const preview = await isPreview();
  const personal = admin && !preview;

  const widgets = await getBoardWidgets('home');

  return (
    <div className="lobby-page">
      <section className="wrap lobby-wrap" style={{ maxWidth: 1080 }}>
        <div className="lobby-hero">
          <h1 className="lobby-greeting">{greeting()}</h1>
          <p className="lobby-sub">Start with a question, or explore the Atlas below.</p>
          <LobbyAsk />
        </div>

        {personal && (
          <div className="lobby-customize-row"><CustomizeWidgets board="home" active={widgets} /></div>
        )}
        <WidgetBoard board="home" widgets={widgets} personal={personal} />
      </section>
    </div>
  );
}
