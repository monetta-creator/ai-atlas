// One manifest per capability (redo Phase 4, 10-architecture.md "One manifest
// per capability"). The catalog Kevin asked for (every agent, what it does,
// how to call it) is generated from these, never hand-kept: composer
// autocomplete for `/` and `@`, the /help answer, the /capabilities page, and
// the roster the model sees. Import-free so client components and tests load it.

export type CapabilityKind = 'tool' | 'skill' | 'agent' | 'action';
export type Audience = 'admin' | 'keyholder';

export interface CapabilityBase {
  kind: CapabilityKind;
  slug: string; // `/slug` for skills, `@slug` for agents, the tool name for tools
  title: string;
  oneLiner: string; // no em dashes (user-facing)
  usage: string; // e.g. '/brief <topic> [since]'
  examples: string[];
  audience: Audience[];
  // ai_cost_log feature slugs this capability spends under (budgets count these).
  features: string[];
  caps: { perRunUsd: number };
  typical?: { seconds: number; usd: number };
}

export interface SkillManifest extends CapabilityBase {
  kind: 'skill';
  // The recipe, injected as a mid-conversation system message for the turn.
  instructions: string;
  leansOn: string[]; // tool names the recipe tells the model to use
  depth?: '1' | '2' | '3';
}

export interface AgentManifest extends CapabilityBase {
  kind: 'agent';
  artifact: { kind: string; hrefPattern: string };
  // How the bar launches it today (the generic run card arrives with P4.4).
  launch: 'field_report_toggle' | 'plan_card';
}

export interface ToolManifest extends CapabilityBase {
  kind: 'tool';
}

export type Capability = SkillManifest | AgentManifest | ToolManifest;

export const trigger = (c: Capability): string => (c.kind === 'skill' ? `/${c.slug}` : c.kind === 'agent' ? `@${c.slug}` : c.slug);
