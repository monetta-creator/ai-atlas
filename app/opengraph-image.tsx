import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// The social card every page shares by default (2026-09-27): the Atlas
// wordmark, the one-line description, and the cobalt accent on the plotting
// grid the site itself sits on. Fonts are the PDF kit's bundled TTFs
// (lib/pdf/fonts, traced for this route in next.config.ts).

export const alt = 'The AI Atlas: an intelligence system for the AI economy, built on a map of the argument.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OpengraphImage() {
  const [anton, schibsted, mono] = await Promise.all([
    readFile(join(process.cwd(), 'lib/pdf/fonts/Anton-Regular.ttf')),
    readFile(join(process.cwd(), 'lib/pdf/fonts/SchibstedGrotesk-Regular.ttf')),
    readFile(join(process.cwd(), 'lib/pdf/fonts/JetBrainsMono-Regular.ttf')),
  ]);
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
          padding: '72px 80px', background: '#f4f6fa', color: '#0f172a',
          backgroundImage: 'radial-gradient(circle, rgba(15,23,42,0.13) 1.4px, transparent 1.6px)',
          backgroundSize: '28px 28px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div style={{ width: 18, height: 18, borderRadius: 999, border: '3px solid #2d5bff', display: 'flex' }} />
          <div style={{ fontFamily: 'JetBrains', fontSize: 22, letterSpacing: 6, color: '#5b6675' }}>THE AI ATLAS</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ width: 96, height: 8, background: '#2d5bff', marginBottom: 34, display: 'flex' }} />
          <div style={{ fontFamily: 'Anton', fontSize: 92, lineHeight: 1.02, letterSpacing: -1, maxWidth: 1000 }}>
            An intelligence system for the AI economy, built on a map of the argument.
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'Schibsted', fontSize: 26, color: '#5b6675' }}>
          <span>Signals · a daily edition · Savant weekly · claims and evidence · data · research · tools</span>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Anton', data: anton, style: 'normal', weight: 400 },
        { name: 'Schibsted', data: schibsted, style: 'normal', weight: 400 },
        { name: 'JetBrains', data: mono, style: 'normal', weight: 400 },
      ],
    }
  );
}
