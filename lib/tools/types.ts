// The Atlas tool registry's contract (redo Phase 1). One definition per tool:
// schema, input parser, identity scope, handler (which renders and mints
// citation tags). Every loop (Ask v2, the MCP door, later the agents) reads
// tools from here, so a tool's scope is enforced in one place.
import type { createTagger } from '../ask/deep';

export type Scope = 'admin' | 'keyholder';

export type Identity =
  | { kind: 'admin' }
  | { kind: 'keyholder'; keyId: string };

export type Tagger = ReturnType<typeof createTagger>;

// A generative view (redo Phase 4): rows the SERVER resolved from a query, sent
// to the client in a `view` event. The model never types a value into one.
export interface AtlasView {
  kind: 'table' | 'timeline' | 'chart';
  title: string;
  columns?: { key: string; label: string; type: 'text' | 'number' | 'date' }[];
  rows: Record<string, string | number | null>[];
  cite?: string; // per-row key holding the citation label
  x?: string;
  y?: string;
  series?: string;
  unit?: string;
  note?: string;
}

export interface ToolContext {
  identity: Identity;
  tagger: Tagger;
  // Progress line for the client's status strip (already de-dashed by caller).
  status?: (text: string) => void;
  // Hands a resolved view to the client (the v2 route emits a `view` event).
  view?: (v: AtlasView) => void;
}

export interface ToolResult {
  text: string;
  isError?: boolean;
}

// JSON schema for a tool's input. Every object carries
// additionalProperties:false and no minimum/maximum on integers (the strict
// validator rejects them; ranges go in descriptions and parsers clamp).
export interface JsonSchemaObject {
  type: 'object';
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: false;
}

export interface AtlasTool<I = unknown> {
  name: string;
  description: string;
  inputSchema: JsonSchemaObject;
  scopes: Scope[];
  // Returns the typed input or an error string fed back as an is_error result.
  parse(input: unknown): I | string;
  run(input: I, ctx: ToolContext): Promise<ToolResult>;
}

export const scopeOf = (id: Identity): Scope => (id.kind === 'admin' ? 'admin' : 'keyholder');
