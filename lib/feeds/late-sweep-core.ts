// The late feed sweep's pure core (lib/feeds/late-sweep.ts calls into this).
// DELIBERATELY dependency-light (no runtime imports) so
// scripts/test-late-sweep.mjs can load it under plain-Node type stripping,
// the lib/scan/core.ts precedent.

// Splits one invocation's work budget between the two engines: scan goes
// first and gets a fixed share of the window measured from `now`; intel gets
// whatever remains up to the overall deadline (so a scan leg that finishes
// early hands intel more room, and a scan leg that runs the full share still
// leaves intel a full remaining window rather than a shrinking one).
export function splitDeadline(now: number, deadlineAt: number): { scanDeadline: number; intelDeadline: number } {
  const total = Math.max(0, deadlineAt - now);
  const scanDeadline = now + Math.round(total * 0.45);
  return { scanDeadline, intelDeadline: deadlineAt };
}

// The run-note line appended after a sweep (matches the scan/intel notes
// style: short, plain, no em dash).
export function sweepNote(n: number): string {
  return n > 0 ? `late feed sweep: ${n} new item${n === 1 ? '' : 's'}` : 'late feed sweep: nothing new';
}
