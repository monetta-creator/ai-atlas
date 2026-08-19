import Link from 'next/link';
import { loginAdmin, enterAsGuest } from './actions';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div className="text-center" style={{ marginBottom: 28 }}>
          <span
            className="mark"
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 680,
              fontSize: 22,
              letterSpacing: '-0.02em',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              color: 'var(--ink)',
            }}
          >
            <svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4">
              <circle cx="10" cy="10" r="8" />
              <circle cx="10" cy="10" r="3.4" />
              <path d="M10 1.5v4M10 14.5v4M1.5 10h4M14.5 10h4" strokeLinecap="round" />
            </svg>
            The AI Atlas
          </span>
          <p className="lede" style={{ fontSize: 14.5, marginTop: 12 }}>
            A structured map for staying oriented in the AI economy debate.
          </p>
        </div>

        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius)',
            padding: 24,
            boxShadow: '0 1px 2px rgba(15,23,42,.04), 0 12px 36px rgba(15,23,42,.08)',
          }}
        >
          <form action={loginAdmin} className="flex flex-col gap-3">
            <div className="field">
              <label htmlFor="password">Admin</label>
              <input
                id="password"
                name="password"
                type="password"
                placeholder="Password"
                autoFocus
                className="input"
              />
            </div>
            {error && <p style={{ color: 'var(--heat-4)', fontSize: 12 }}>Incorrect password.</p>}
            <button type="submit" className="btn btn--primary" style={{ width: '100%', justifyContent: 'center' }}>
              Admin Login
            </button>
          </form>

          <div className="flex items-center gap-3" style={{ margin: '20px 0' }}>
            <div style={{ height: 1, flex: 1, background: 'var(--line)' }} />
            <span style={{ color: 'var(--faint-ink)', fontSize: 12 }}>or</span>
            <div style={{ height: 1, flex: 1, background: 'var(--line)' }} />
          </div>

          <form action={enterAsGuest}>
            <button type="submit" className="btn btn--ghost" style={{ width: '100%', justifyContent: 'center' }}>
              Enter as Guest
            </button>
          </form>

          <p
            className="text-center"
            style={{ color: 'var(--faint-ink)', fontSize: 11.5, lineHeight: 1.5, marginTop: 16 }}
          >
            Guest opens the share view: the public map with the personal layer hidden.
          </p>
        </div>

        <p className="text-center" style={{ marginTop: 20, fontSize: 12 }}>
          <Link href="/about" style={{ color: 'var(--dim)' }} className="hover:underline">
            About the AI Atlas →
          </Link>
        </p>
      </div>
    </main>
  );
}
