import type { ReactNode } from 'react';
import { Sacramento } from 'next/font/google';

// The Savant imprint's script signature. next/font/google here (not the
// embedded TTF the PDF kit registers): the web masthead needs only the CSS
// variable, and this subtree is the one place --font-savant is defined.
const sacramento = Sacramento({
  weight: '400',
  variable: '--font-savant',
  subsets: ['latin'],
  display: 'swap',
});

export default function SavantLayout({ children }: { children: ReactNode }) {
  return <div className={sacramento.variable}>{children}</div>;
}
