// Node and value types shared by graph.ts, registry.ts, compile.ts and engine.ts.
import type { ImageInfo } from './domains.ts';
import type { Unit } from './units.ts';

/** What crosses realm boundaries: a node is rebuilt from this and must reproduce its id. */
export interface NodeDef {
  op: string;
  inputs: string[];
  args: Readonly<Record<string, unknown>>;
}

export interface FieldSpec {
  name: string;
  type: 'number' | 'vec3' | 'string' | 'box' | 'point' | 'table' | 'bool' | 'object';
  unit?: Unit;
  /** Present only in some results (e.g. densitometer `visual`). */
  optional?: boolean;
  doc: string;
}

export interface ValueInfo {
  kind: 'Value';
  /** What the op returns: a plain Value, Regions or a Table. */
  returns: 'Value' | 'Regions' | 'Table';
  fields: FieldSpec[];
}

export type NodeInfo = ImageInfo | ValueInfo;

/** What callers hold: an id and the inferred info. */
export interface NodeRef {
  id: string;
  info: NodeInfo;
}

export interface Node extends NodeDef, NodeRef {}
