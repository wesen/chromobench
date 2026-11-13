// The vocabulary of a store write: a patch (with its before value, for undo), a plain write, the options of a
// transaction and what listeners are told about a write.

import type { Key } from '../util.ts';

export interface Patch {
  path: Key[];
  before: unknown;
  after: unknown;
}
export interface Write {
  path: Key[];
  value: unknown;
}
/** A value an adapter publishes into the tree (its projection). */
export type Mirror = Write;

export interface TxOpts {
  /** merge consecutive transactions with the same key within 1.5 s */
  coalesce?: string | null;
  /** the per-channel History list this step files into (a photo, a frame) */
  channel?: string | null;
  snapPath?: Key[] | null;
  snapBefore?: unknown;
  /** the value shown next to the label */
  detail?: string;
  seedLabel?: string;
  /** false: write without a history entry */
  record?: boolean;
  /** false: do not add to the channel list (stepping back in a channel) */
  channelEntry?: boolean;
  /** a transaction elsewhere does not cancel the open gesture */
  keepPreview?: boolean;
  [k: string]: unknown;
}

export interface WriteInfo {
  label?: string;
  tier?: 'document' | 'view' | 'route';
  tx?: boolean;
  preview?: boolean;
  cancel?: boolean;
  undo?: boolean;
  redo?: boolean;
  init?: boolean;
  layer?: string;
  route?: string;
  [k: string]: unknown;
}
