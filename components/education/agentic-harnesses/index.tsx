import SpectrumSection from './SpectrumSection';
import LoopSection from './LoopSection';
import LandscapeSection from './LandscapeSection';
import McpSection from './McpSection';
import BenchmarksSection from './BenchmarksSection';

// The "Field guide to agentic harnesses" body: five specs behind an in-page
// anchor row, closed by the sources note. The page shell (app/education/
// [slug]/page.tsx) renders the .pagehead above this inside <section
// className="wrap edu">; only Spec 01 and 02 need client state, the rest is
// server JSX.

export default function GuideAgenticHarnesses() {
  return (
    <>
      <nav className="edu-toc" aria-label="Guide sections">
        <a href="#spectrum">Where it sits</a>
        <a href="#loop">The loop</a>
        <a href="#landscape">Landscape</a>
        <a href="#mcp">MCP</a>
        <a href="#benchmarks">Judging one</a>
      </nav>

      <p className="edu-hero">The model is the engine. The harness is the car.</p>
      <p className="edu-lede" style={{ maxWidth: '58ch' }}>
        Every &ldquo;AI coding agent&rdquo; you&apos;ve heard of (Claude Code, Cursor, Devin) is the same handful
        of frontier models wrapped in different scaffolding. This guide covers what that
        scaffolding does, the three interfaces the market has built it into, and why the wrapper
        now matters more than which engine sits inside it.
      </p>

      <SpectrumSection />
      <LoopSection />
      <LandscapeSection />
      <McpSection />
      <BenchmarksSection />

      <footer className="edu-sources">
        Grounded in primary sources: SpaceX&apos;s 8-K on the Anysphere merger, the Google Developers
        Blog, the GitHub Changelog, Scale AI&apos;s SWE-bench Pro leaderboard, the anomalyco/opencode
        repository, and Anthropic&apos;s help center, plus reporting from CNBC and Fortune. Current as
        of August 30, 2026. Figures marked &ldquo;roughly&rdquo; are press-reported and unverified.
      </footer>
    </>
  );
}
