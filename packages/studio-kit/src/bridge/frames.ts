// The open frames: per frame its source info, its own content-addressed Graph and its EditLog (what CHB-009's
// FrameSession held). Logs are saved by source SHA-256 on every non-preview event and resumed by hash, so a moved
// file re-attaches its recipe.
import {
  EditLog, Graph, sha256Hex,
  type AgentMode, type EditLogData, type Engine, type FrameRecipe, type SourceInfo,
} from '@chromobench/contract';
import { defaultFor } from '../model/recipes.ts';
import type { KV } from './kv.ts';

export interface FrameEntry {
  readonly id: string;
  readonly sha: string;
  readonly name: string;
  readonly info: SourceInfo;
  readonly graph: Graph;
  readonly log: EditLog;
  /** the recipe frame.add created */
  readonly initial: FrameRecipe;
}

/**
 * A frame's first recipe computed from the opened frame (CHB-023: the automatic first print). It gets the default
 * recipe and the frame's graph (the source is registered in it); it runs only when no log is saved for the hash.
 */
export type InitialRecipe = (defaults: FrameRecipe, graph: Graph) => Promise<FrameRecipe>;

export interface FramesOptions {
  kv?: KV | null;
  mode?: AgentMode;
  now?: () => number;
}

export class Frames {
  readonly engine: Engine;
  readonly kv: KV | null;
  mode: AgentMode;
  private readonly now: (() => number) | undefined;
  private readonly map = new Map<string, FrameEntry>();
  private readonly listeners = new Set<(e: FrameEntry) => void>();
  private saving: Promise<unknown> = Promise.resolve();

  constructor(engine: Engine, o: FramesOptions = {}) {
    this.engine = engine;
    this.kv = o.kv ?? null;
    this.mode = o.mode ?? 'ask';
    this.now = o.now;
  }

  get(id: string): FrameEntry | undefined {
    return this.map.get(id);
  }
  ids(): string[] {
    return [...this.map.keys()];
  }
  all(): FrameEntry[] {
    return [...this.map.values()];
  }
  /** called for frames added now and later */
  onAdded(f: (e: FrameEntry) => void): () => void {
    for (const e of this.map.values()) f(e);
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  /** Opens bytes in the engine and creates (or resumes, by hash) the frame's edit log. */
  async open(bytes: Uint8Array, name: string, o: { initial?: FrameRecipe | InitialRecipe } = {}): Promise<FrameEntry> {
    const sha = sha256Hex(bytes);
    const existing = this.all().find(e => e.sha === sha);
    if (existing) return existing;
    const info = await this.engine.open({ kind: 'file', sha256: sha, name, bytes });
    const graph = new Graph();
    graph.registerSource(info);
    const saved = this.kv ? await this.kv.get<EditLogData>('logs', sha) : undefined;
    const opts = { mode: this.mode, graph, ...(this.now ? { now: this.now } : {}) };
    const first = saved ? null : typeof o.initial === 'function' ? await o.initial(defaultFor(sha, name), graph) : o.initial;
    const again = this.all().find(e => e.sha === sha);
    if (again) return again; // opened twice at once: the first open wins
    const log = saved ? new EditLog(saved, opts) : EditLog.create(first ?? defaultFor(sha, name), { ...opts, by: 'auto' });
    return this.add({ id: log.frame, sha, name, info, graph, log, initial: log.toJSON().initial });
  }

  add(e: FrameEntry): FrameEntry {
    this.map.set(e.id, e);
    e.log.on(ev => {
      if (ev.type !== 'preview') this.save(e);
    });
    this.save(e);
    for (const f of this.listeners) f(e);
    return e;
  }

  setMode(mode: AgentMode): void {
    this.mode = mode;
    for (const e of this.map.values()) e.log.setMode(mode);
  }

  private save(e: FrameEntry): void {
    if (!this.kv) return;
    const kv = this.kv;
    const data = e.log.toJSON();
    this.saving = this.saving.then(() => kv.put('logs', e.sha, data)).catch(() => undefined);
  }
  /** resolves when every queued log write has finished */
  flush(): Promise<unknown> {
    return this.saving;
  }
}
