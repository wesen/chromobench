// The eval contract between agent transports (CHB-008), the DSL runtime (CHB-007) and the host.
// Shapes follow goja-cv's cvsession result processor; Look and ContextBlock per CHB-007/008.
import type { Domain } from './domains.ts';
import type { Diagnostic } from './errors.ts';
import type { AgentMode, LogEntry } from './editlog.ts';
import type { Box } from './spec.ts';

export type { Diagnostic } from './errors.ts';

export interface EvalRequest {
  code: string;
  frame?: string;
  timeoutMs?: number;
}

/** An image returned to the agent, always paired with the numbers it shows. */
export interface Look {
  /** Look number, burned into the image band. */
  n: number;
  /** What it shows: node path, crop, scale. */
  caption: string;
  node?: string;
  domain?: Domain;
  region?: Box;
  scale?: number;
  /** The numbers it shows. */
  numbers: Record<string, unknown>;
  image: { mime: 'image/png' | 'image/jpeg'; width: number; height: number; bytes: Uint8Array };
}

export interface ContextBlock {
  frame?: string;
  mode: AgentMode;
  /** Document paths this eval's transactions touched, in order (id-anchored, design §24). */
  changed: string[];
  /** Pending proposal transaction ids. */
  proposals: string[];
  /** mem keys. */
  mem: string[];
  functions: string[];
  newFunctions: string[];
}

export interface EvalResult {
  /** Returned value, ≤ 9000 chars, compact tables for record arrays. */
  yaml: string;
  /** ≤ 4 images. */
  looks: Look[];
  /** With line numbers. */
  warnings: Diagnostic[];
  context: ContextBlock;
  /** The log entries EditLog.propose returned for this eval (seq, frame, transaction, why). */
  transactions: LogEntry[];
  error?: Diagnostic;
  /** Recorded by the harness, not rendered to the model. */
  trace?: { ms: number; ops: Record<string, number> };
}

export const EVAL_LIMITS = Object.freeze({ yamlChars: 9000, looks: 4 });
