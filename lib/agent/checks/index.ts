import type { AgentCheck } from '../types';
import { QUEUE_CHECKS } from './queues';
import { ENGINE_CHECKS } from './engines';
import { EDITORIAL_CHECKS } from './editorial';

// The sensor registry: every check the hourly runner executes, in order.
// Adding a check = a new entry in its domain file; nothing else to wire.
export const AGENT_CHECKS: AgentCheck[] = [...QUEUE_CHECKS, ...ENGINE_CHECKS, ...EDITORIAL_CHECKS];

export function findCheck(key: string): AgentCheck | undefined {
  return AGENT_CHECKS.find((c) => c.key === key);
}
