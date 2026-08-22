import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Vendored variable fonts (app/fonts/*.woff2): the app must build and run with
// zero outbound network (corporate walls), so next/font/google is banned. The
// design system uses non-standard display weights (620/640/660/680), which only
// render correctly from a variable axis — so load these as variable ranges.
const schibsted = localFont({
  src: [
    { path: "./fonts/schibsted-grotesk.woff2", weight: "400 900", style: "normal" },
    { path: "./fonts/schibsted-grotesk-italic.woff2", weight: "400 900", style: "italic" },
  ],
  variable: "--font-schibsted",
  display: "swap",
});

const jetbrains = localFont({
  src: [
    { path: "./fonts/jetbrains-mono.woff2", weight: "100 800", style: "normal" },
    { path: "./fonts/jetbrains-mono-italic.woff2", weight: "100 800", style: "italic" },
  ],
  variable: "--font-jetbrains",
  display: "swap",
});

// The broadsheet headline voice (Console Broadsheet redesign): one weight, used only
// for editorial headlines and big numerals via --font-headline. Never bolded.
const anton = localFont({
  src: [{ path: "./fonts/anton.woff2", weight: "400", style: "normal" }],
  variable: "--font-anton",
  display: "swap",
});

export const metadata: Metadata = {
  title: "The Strategy Atlas",
  description: "A structured board for tracking strategic hypotheses, evidence, and conviction.",
};

// Without this, mobile browsers assume a ~980px layout viewport and shrink-to-fit —
// which means none of the ≤720px responsive rules ever fire on a real phone. Make the
// layout viewport the device width so the mobile CSS actually applies. No maximum-scale
// or user-scalable:false — pinch-zoom stays available for accessibility.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

// Set the saved theme before first paint to avoid a light→dark flash.
const themeInit = `(function(){try{var s=JSON.parse(localStorage.getItem("atlas-console")||"{}");if(s&&s.theme==="dark")document.documentElement.setAttribute("data-theme","dark");}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${schibsted.variable} ${jetbrains.variable} ${anton.variable} h-full`}>
      <body className="dir-console app min-h-full" data-dir="console">
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        {children}
      </body>
    </html>
  );
}
