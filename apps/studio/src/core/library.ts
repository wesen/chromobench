// LibraryStore (guide §5.5): projects, rolls, frames and where their bytes live. Frames are
// identified by the SHA-256 of their bytes; edit logs are stored by hash, so a renamed or moved
// file, or a re-picked session file, re-attaches its recipe.
import type { EditLogData } from '@chromobench/contract';
import type { KV } from '../storage/db.ts';
import { fileAt, permission, reconnect, sha256, type PickedFile } from '../storage/fsa.ts';
import { importPath, type Opfs } from '../storage/opfs.ts';
import { Store } from './store.ts';

export interface Project { id: string; name: string; created: number }
export type RollSource = 'session' | 'import' | 'folder';
export interface Roll { id: string; projectId: string; name: string; source: RollSource; handleId?: string; created: number }
export interface FrameRecord {
  key: string;
  rollId: string;
  name: string;
  relPath: string;
  size: number;
  lastModified: number;
  sha256: string;
  badges: { edited: boolean; pending: number };
}

export interface LibraryState {
  projects: Project[];
  rolls: Roll[];
  frames: FrameRecord[];
  /** Rolls whose bytes are reachable now (session in memory, imports, granted folders). */
  connected: Record<string, boolean>;
  currentProject: string | null;
  currentRoll: string | null;
}

const uid = (p: string): string => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export class LibraryStore {
  readonly state = new Store<LibraryState>({ projects: [], rolls: [], frames: [], connected: {}, currentProject: null, currentRoll: null });
  private readonly kv: KV;
  private readonly opfs: Opfs | null;
  /** Session bytes by frame key (fallback "use for this session"). */
  private readonly session = new Map<string, PickedFile>();
  private readonly handles = new Map<string, FileSystemDirectoryHandle>();

  constructor(kv: KV, opfs: Opfs | null) {
    this.kv = kv;
    this.opfs = opfs;
  }

  get s(): LibraryState {
    return this.state.get();
  }

  async load(): Promise<void> {
    const [projects, rolls, frames, handles] = await Promise.all([
      this.kv.all<Project>('projects'), this.kv.all<Roll>('rolls'), this.kv.all<FrameRecord>('frames'),
      this.kv.all<{ id: string; handle: FileSystemDirectoryHandle }>('handles'),
    ]);
    for (const h of handles) this.handles.set(h.id, h.handle);
    const connected: Record<string, boolean> = {};
    for (const r of rolls) {
      if (r.source === 'import') connected[r.id] = true;
      else if (r.source === 'folder' && r.handleId && this.handles.has(r.handleId)) connected[r.id] = (await permission(this.handles.get(r.handleId)!)) === 'granted';
      else connected[r.id] = false;
    }
    const byCreated = <T extends { created: number }>(a: T, b: T): number => a.created - b.created;
    projects.sort(byCreated);
    rolls.sort(byCreated);
    this.state.set({ projects, rolls, frames, connected, currentProject: projects.at(-1)?.id ?? null, currentRoll: rolls.at(-1)?.id ?? null });
  }

  async createProject(name: string): Promise<Project> {
    const p: Project = { id: uid('proj'), name, created: Date.now() };
    await this.kv.put('projects', p.id, p);
    this.state.update({ projects: [...this.s.projects, p], currentProject: p.id });
    void navigator.storage?.persist?.().catch(() => false);
    return p;
  }

  private async project(): Promise<string> {
    return this.s.currentProject ?? (await this.createProject('Unsorted')).id;
  }

  /** Adds a roll of files. Hashes each file; for 'import', copies the bytes into OPFS. */
  async addRoll(name: string, files: PickedFile[], source: RollSource, handle?: FileSystemDirectoryHandle): Promise<Roll> {
    const projectId = await this.project();
    const roll: Roll = { id: uid('roll'), projectId, name, source, created: Date.now() };
    if (handle) {
      roll.handleId = uid('h');
      this.handles.set(roll.handleId, handle);
      await this.kv.put('handles', roll.handleId, { id: roll.handleId, name: handle.name, handle });
    }
    const frames: FrameRecord[] = [];
    for (const f of files) {
      const bytes = new Uint8Array(await (await f.file()).arrayBuffer());
      const sha = await sha256(bytes);
      const key = `${roll.id}:${f.relPath}`;
      const log = await this.kv.get<EditLogData>('logs', sha);
      const fr: FrameRecord = { key, rollId: roll.id, name: f.name, relPath: f.relPath, size: f.size, lastModified: f.lastModified, sha256: sha, badges: { edited: (log?.cursor ?? 0) > 0, pending: log?.entries.filter((e) => e.status === 'pending').length ?? 0 } };
      if (source === 'import') {
        if (!this.opfs) throw new Error('OPFS is not available in this browser');
        await this.opfs.write(importPath(sha, f.name), bytes);
      }
      if (source === 'session') this.session.set(key, f);
      frames.push(fr);
      await this.kv.put('frames', key, fr);
    }
    await this.kv.put('rolls', roll.id, roll);
    this.state.update({ rolls: [...this.s.rolls, roll], frames: [...this.s.frames, ...frames], connected: { ...this.s.connected, [roll.id]: true }, currentRoll: roll.id, currentProject: projectId });
    return roll;
  }

  /** Re-attaches session files picked again, by hash. Returns the number of frames reconnected. */
  async reattach(files: PickedFile[]): Promise<number> {
    let n = 0;
    const connected = { ...this.s.connected };
    for (const f of files) {
      const sha = await sha256(new Uint8Array(await (await f.file()).arrayBuffer()));
      for (const fr of this.s.frames.filter((x) => x.sha256 === sha && !this.s.connected[x.rollId])) {
        this.session.set(fr.key, f);
        connected[fr.rollId] = true;
        n++;
      }
    }
    this.state.update({ connected });
    return n;
  }

  /** "Reconnect <roll>": asks for the folder permission again (user gesture). */
  async reconnectRoll(rollId: string): Promise<boolean> {
    const r = this.s.rolls.find((x) => x.id === rollId);
    const h = r?.handleId ? this.handles.get(r.handleId) : undefined;
    if (!h) return false;
    const ok = await reconnect(h);
    this.state.update({ connected: { ...this.s.connected, [rollId]: ok } });
    return ok;
  }

  frame(key: string): FrameRecord | undefined {
    return this.s.frames.find((f) => f.key === key);
  }

  framesOf(rollId: string | null): FrameRecord[] {
    return this.s.frames.filter((f) => f.rollId === rollId);
  }

  /** The bytes of a frame, from wherever they live; null when disconnected. */
  async bytes(fr: FrameRecord): Promise<Uint8Array | null> {
    const roll = this.s.rolls.find((r) => r.id === fr.rollId);
    let file: File | null = null;
    if (this.session.has(fr.key)) file = await this.session.get(fr.key)!.file();
    else if (roll?.source === 'import' && this.opfs) file = await this.opfs.read(importPath(fr.sha256, fr.name));
    else if (roll?.source === 'folder' && roll.handleId && this.s.connected[roll.id]) file = await fileAt(this.handles.get(roll.handleId)!, fr.relPath);
    return file ? new Uint8Array(await file.arrayBuffer()) : null;
  }

  selectRoll(rollId: string): void {
    const r = this.s.rolls.find((x) => x.id === rollId);
    this.state.update({ currentRoll: rollId, ...(r ? { currentProject: r.projectId } : {}) });
  }

  selectProject(id: string): void {
    this.state.update({ currentProject: id, currentRoll: this.s.rolls.filter((r) => r.projectId === id).at(-1)?.id ?? null });
  }

  async loadLog(sha: string): Promise<EditLogData | null> {
    return (await this.kv.get<EditLogData>('logs', sha)) ?? null;
  }

  async saveLog(sha: string, data: EditLogData): Promise<void> {
    await this.kv.put('logs', sha, data);
    const edited = data.cursor > 0;
    const pending = data.entries.filter((e) => e.status === 'pending').length;
    const changed = this.s.frames.filter((f) => f.sha256 === sha && (f.badges.edited !== edited || f.badges.pending !== pending));
    if (!changed.length) return;
    const frames = this.s.frames.map((f) => (f.sha256 === sha ? { ...f, badges: { edited, pending } } : f));
    for (const f of frames.filter((x) => x.sha256 === sha)) await this.kv.put('frames', f.key, f);
    this.state.update({ frames });
  }
}
