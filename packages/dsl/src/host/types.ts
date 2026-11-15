// The DSL host's records (CHB-032 split; contract 1.0): handles, frames and their views, queued edits, show
// requests, log lines, and the providers the session injects (named looks, docs).
import type { Diagnostic, Document, Domain, SourceInfo, Preset, Roll } from '@chromobench/contract';
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
 * The shared data a frame's links resolve against (CHB-037 P7), supplied by the host as data (it crosses to a worker as
 * JSON): the rolls (a frame on a roll links its scan to the roll) and the photographer's presets. Looks need nothing:
 * they are the contract's registered look functions.
 */
export interface DslLinks {
  rolls?: Readonly<Record<string, Roll>>;
  presets?: Readonly<Record<string, Preset>>;
}

export interface DocsProvider {
  help(name: string | null): unknown;
  docs(a: Record<string, unknown>): unknown;
}
