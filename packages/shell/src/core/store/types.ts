// The vocabulary of a store write: a write (a path and its new value), the options of a transaction, what
// listeners are told about a write, and the declaration of where documents are mounted.

import type { Author, JsonObject } from '@chromobench/values';
import type { Key } from '../util.ts';

export interface Write {
  path: Key[];
  value: unknown;
}

export interface TxOpts {
  /** fold consecutive transactions with the same key, within the store's coalescing window, into one undo step */
  coalesce?: string | null;
  /** the value shown next to the label (stored as source.detail) */
  detail?: string;
  /** who makes the change (default 'user') */
  by?: Author;
  /** where it came from, added to the transaction's source (a gesture's control, a command id) */
  source?: JsonObject;
  /** a transaction elsewhere does not cancel the open gesture */
  keepPreview?: boolean;
}

export interface WriteInfo {
  label?: string;
  tier?: 'document' | 'view';
  tx?: boolean;
  preview?: boolean;
  cancel?: boolean;
  undo?: boolean;
  redo?: boolean;
  init?: boolean;
  /** the named draft a preview write belongs to */
  draft?: string;
  [k: string]: unknown;
}

/**
 * Where documents of the log appear in the state: `prefix` plus `keyDepth` key segments (recipes.<frameId>) is a
 * document's root. A kit declares it so the build can check bindings under it; the host opens the documents.
 */
export interface MountDecl {
  /** a dotted prefix: 'recipes' */
  prefix: string;
  /** how many segments after the prefix are keys (recipes.<frameId> → 1) */
  keyDepth?: number;
  /** the documents' kind (names their rules in the log) */
  kind?: string;
  /** checks a path under the prefix (without the prefix and key segments); returns an error message or null */
  checkPath?: (rest: Key[]) => string | null | undefined | { message: string; fix?: string; valid?: string[] };
  source?: string;
}
