// The DSL host's records (CHB-032 split; contract 1.0): handles, frames and their views, queued edits, show
// requests, log lines, and the providers the session injects (named looks, docs).
import type { Diagnostic, Document, Domain, SourceInfo } from '@chromobench/contract';
import type { Mutation } from '@chromobench/values';

export interface HandleInfo {
  id: string;
  kind: 'Image' | 'Value';
  domain?: Domain;
  op: string;
  frame: string | null;
  label: string;
  /** the DSL expression that names the handle (fixes are written against it) */
  expr: string;
  width?: number;
  height?: number;
  fields?: string[];
}

/** A frame the session may open: its decoded source (the graph sizes source.open from it) and display name. */
export interface FrameEntry {
  source: SourceInfo;
  name?: string;
}

/** A document the eval reads: a frame at the start of the eval, a what-if, or a receipt's preview. */
export interface View {
  frame: string;
  doc: Document;
  /** the DSL expression that names the view */
  expr: string;
}

/** One frame.propose (or one named look on one frame), validated and queued for the end of the eval (DR-3). */
export interface QueuedEdit {
  id: string;
  frame: string;
  /** normal form, as applied to the frame's draft */
  mutations: Mutation[];
  inverses: Mutation[];
  why?: string;
  label?: string;
  line?: number;
  /** the named look that made it (cb.looks.apply) */
  look?: string;
}

/** A frame during an eval: the document it read and the draft its queued edits make. */
export interface FrameState {
  base: Document;
  draft: Document;
}

export interface ShowRequest {
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

export type At = { eval: number; line: number } | null;

/**
 * The studio's named looks, injected by the host (packages/studio-kit's looks kit). Resolving a look is pure: the
 * frame's document in, mutations out, with the Amount and diff passes of the studio. Until links (P7) a named look
 * is a batch of edits over its frames.
 */
export interface LooksProvider {
  list(): { id: string; name: string; group: string; requires: string; params: Record<string, { type: string; unit?: string; min?: number; max?: number; default?: unknown }> }[];
  resolve(
    id: string,
    frame: { id: string; doc: Document },
    params: Record<string, unknown>,
    opts: { amount?: number; from?: 'current' | 'defaults' },
  ): { look: { id: string; name: string }; label: string; mutations: Mutation[]; diff: { path: string; shown: string }[]; skip?: Diagnostic };
  diff(a: Document, b: Document): { path: string; shown: string }[];
}

export interface DocsProvider {
  help(name: string | null): unknown;
  docs(a: Record<string, unknown>): unknown;
}
