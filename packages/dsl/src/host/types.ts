// The DSL host's records (split from host.ts, CHB-032): handles, frames, queued edits, look requests, log lines,
// and the providers the session injects (looks, docs).
import type { Diagnostic, Domain, EditLog, FrameRecipe, Mutation } from '@chromobench/contract';

export interface HandleInfo {
  id: string;
  kind: 'Image' | 'Value';
  domain?: Domain;
  op: string;
  frame: string | null;
  label: string;
  expr: string;
  width?: number;
  height?: number;
  fields?: string[];
}

export interface FrameEntry {
  log: EditLog;
  name?: string;
}

export interface QueuedEdit {
  id: string;
  frame: string;
  mutations: Mutation[];
  was: unknown[];
  why?: string;
  line?: number;
  /** cross-frame batch (cb.looks.apply): proposed with LoggedMutation.batch so the studio shows one card */
  batch?: string;
}

export interface LookRequest {
  n: number;
  ids: string[];
  frame: string | null;
  label: string;
  opts: Record<string, unknown>;
  line?: number;
  key: string;
}

export interface LogLine {
  level: string;
  text: string;
  line?: number;
}

export interface FrameState {
  base: FrameRecipe;
  draft: FrameRecipe;
}

export type At = { eval: number; line: number } | null;

/**
 * The studio's looks, injected by the host (CHB-021: packages/studio-kit's cb.kits.looks.provider()). Resolving a look
 * is pure: the frame's recipe in, `set` mutations out, with the Amount and diff passes of the studio.
 */
export interface LooksProvider {
  list(): { id: string; name: string; group: string; requires: string; params: Record<string, { type: string; unit?: string; min?: number; max?: number; default?: unknown }> }[];
  resolve(
    id: string,
    frame: { id: string; recipe: FrameRecipe },
    params: Record<string, unknown>,
    opts: { amount?: number; from?: 'current' | 'defaults' },
  ): { look: { id: string; name: string }; label: string; mutations: Mutation[]; diff: { path: string; shown: string }[]; skip?: Diagnostic };
  diff(a: FrameRecipe, b: FrameRecipe): { path: string; shown: string }[];
}

export interface DocsProvider {
  help(name: string | null): unknown;
  docs(a: Record<string, unknown>): unknown;
}
