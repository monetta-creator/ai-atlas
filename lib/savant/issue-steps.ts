// The Friday issue's legs as run-panel steps (2026-09-27): shared by the
// desk's run button (client) and the job wrapper around runSavantIssue
// (server). Zero imports. Features name the ai_cost_log slugs each leg
// spends; `feature:leg` entries use the per-leg medians (lib/data/jobs.ts
// getFeatureStats), since the lead's many short research rounds and its one
// long final write would otherwise average into a misleading number.

import type { StepSpec } from '../jobs/core';

export const SAVANT_ISSUE_STEPS: StepSpec[] = [
  { key: 'pack', label: 'Evidence pack', running: 'Reading the week: the notebook, what moved, peers, regulation, research, tools…' },
  { key: 'lead', label: 'Lead research', running: 'Researching the lead: searching the Atlas and the web, then writing the analysis…', features: ['savant_lead:research', 'savant_lead:research', 'savant_lead:research', 'savant_lead:research', 'savant_lead:final'] },
  { key: 'front', label: 'Front page', running: 'Writing the executive summary and the hypothesis readings…', features: ['savant_sections:front'] },
  { key: 'departments', label: 'Departments', running: 'Writing the six departments…', features: ['savant_sections:departments'] },
  { key: 'peers', label: 'Peer watch', running: 'Writing the peer and market watch…', features: ['savant_sections:peers'] },
  { key: 'editor', label: 'Editor', running: 'The editor persona is reading the draft…', features: ['savant_editor'] },
  { key: 'revise', label: 'Revision', running: 'Revising the sections the editor named…', features: ['savant_revise'] },
  { key: 'figures', label: 'Figures', running: 'Choosing and drawing the figures…', features: ['savant_figures'] },
  { key: 'save', label: 'Published', running: 'Gating every link, saving and publishing the issue…' },
];

const ORDER = SAVANT_ISSUE_STEPS.map((s) => s.key);

export function nextSavantStep(key: string): string | null {
  const i = ORDER.indexOf(key);
  return i >= 0 && i < ORDER.length - 1 ? ORDER[i + 1] : null;
}
