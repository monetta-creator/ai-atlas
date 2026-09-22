// Shared display labels for the AI Tooling Monitor's fixed value sets.
// Mirrors the enums lib/tooling/enrich.ts writes (DEPLOYMENTS, PRICING_MODELS,
// TARGET_BUYERS) that the human fact editor also edits. Kept local to
// components/tooling rather than lib/format.ts so this work package doesn't
// touch a shared file another package may be editing concurrently.

export const DEPLOYMENT_LABEL: Record<string, string> = {
  saas: 'SaaS',
  vpc: 'VPC',
  on_prem: 'On-prem',
  api: 'API',
  open_source: 'Open source',
  desktop: 'Desktop',
};

export const DEPLOYMENT_OPTIONS = Object.keys(DEPLOYMENT_LABEL);

export const PRICING_LABEL: Record<string, string> = {
  free: 'Free',
  freemium: 'Freemium',
  per_seat: 'Per seat',
  usage: 'Usage based',
  enterprise: 'Enterprise',
  unknown: 'Pricing unknown',
};

// The filter chip row offers only the five meaningful picks (spec); "unknown"
// stays a valid stored value, just not a filterable one.
export const PRICING_OPTIONS = ['free', 'freemium', 'per_seat', 'usage', 'enterprise'];

export const TARGET_BUYER_LABEL: Record<string, string> = {
  engineering: 'Engineering',
  data: 'Data',
  operations: 'Operations',
  compliance: 'Compliance',
  risk: 'Risk',
  contact_center: 'Contact center',
  sales: 'Sales',
  marketing: 'Marketing',
  legal: 'Legal',
  hr: 'HR',
  finance: 'Finance',
  strategy: 'Strategy',
  everyone: 'Everyone',
};

export const TARGET_BUYER_OPTIONS = Object.keys(TARGET_BUYER_LABEL);

export const FIT_BAND_LABEL: Record<string, string> = {
  strong: 'Strong fit',
  solid: 'Solid fit',
  marginal: 'Marginal fit',
  weak: 'Weak fit',
};

// Known acronyms that should render uppercase (or in their canonical casing)
// rather than title-cased, keyed by the value with separators stripped.
const ACRONYMS: Record<string, string> = {
  soc2: 'SOC 2',
  hipaa: 'HIPAA',
  gdpr: 'GDPR',
  pci: 'PCI',
  iso27001: 'ISO 27001',
  fedramp: 'FedRAMP',
  api: 'API',
  sso: 'SSO',
  sla: 'SLA',
  llm: 'LLM',
  rag: 'RAG',
  gpt: 'GPT',
};

// Turns a raw snake/kebab-case extraction tag (compliance claims,
// integrations, models used) into a readable label: underscores/hyphens
// become spaces, the first letter capitalizes, and known acronyms render in
// their canonical casing. Free-text fields (feature tags) should not go
// through this, they are meant to render verbatim.
export function humanize(v: string): string {
  const key = v.trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (ACRONYMS[key]) return ACRONYMS[key];
  const spaced = v.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!spaced) return spaced;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
