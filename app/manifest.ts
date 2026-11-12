import type { MetadataRoute } from 'next';

// Installable web app: opens straight into the Ask bar. Colors are the light
// tokens in app/styles/tokens.css (--bg #f5f7fb, --accent #2d5bff). No service
// worker and no push yet.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'The AI Atlas',
    short_name: 'Atlas',
    description: 'An intelligence system for the AI economy, built on a map of the argument.',
    start_url: '/ask',
    scope: '/',
    display: 'standalone',
    background_color: '#f5f7fb',
    theme_color: '#f5f7fb',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
}
