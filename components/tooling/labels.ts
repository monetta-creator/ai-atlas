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
