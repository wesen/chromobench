// The page side of the external-agent bridge (CHB-008 guide §5.4): the studio connects to `chromobench serve` over a
// WebSocket, says hello, reports focus, the open frame and the mode, and runs the evals the bridge relays from MCP
// clients (Claude Code, Claude Desktop) in DSL worker sessions. Approvals never block an MCP eval: in ask mode the
// result lists the changes as pending and later context blocks report the photographer's decisions.
//
//   const bridge = new BridgePageClient({ url: 'ws://127.0.0.1:7341/ws/page', frames, currentFrame, mode, session });
//   bridge.start();   …   bridge.update();   // after the open frame or the mode changed
import type { AgentMode, EvalResult } from '@chromobench/contract';
import { toBase64 } from '../chat/session.ts';
import type { FrameSource } from '../worker/client.ts';

/** What the bridge sends (bridge/internal/hub BridgeMsg). */
export type BridgeToPage =
  | { t: 'eval'; id: string; session: string; req: { code: string; frame?: string; timeoutMs: number } }
  | { t: 'eval.cancel'; id: string; reason: 'client' | 'timeout' | 'shutdown' }
  | { t: 'session.create'; id: string };

export interface LookPayload {
  n: number;
  caption: string;
  mime: string;
  base64: string;
}

/** What the page sends (bridge/internal/hub PageMsg). */
export type PageToBridge =
  | { t: 'hello'; page: string; app: string; catalogHash: string; focused: boolean; frame?: string; frames: { id: string; name: string; open: boolean }[]; mode: AgentMode }
  | { t: 'focus'; focused: boolean; frame?: string; frames: { id: string; name: string; open: boolean }[]; mode: AgentMode }
  | { t: 'eval.result'; id: string; text: string; isError: boolean; looks: LookPayload[] }
  | { t: 'session.created'; id: string; session: string }
  | { t: 'session.error'; id: string; error: string };

/** The part of the DOM WebSocket the client uses (tests pass a fake). */
export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface EvalRunner {
  eval(req: { code: string; frame?: string; timeoutMs?: number }, o: { signal: AbortSignal }): Promise<EvalResult>;
}

export interface BridgePageOptions {
  url: string;
  frames: FrameSource;
  currentFrame(): string | null;
  mode(): AgentMode;
  /** The DSL session for a bridge session id ('default' or one created by createSession). */
  session(id: string): Promise<EvalRunner> | null;
  /** Creates a session and returns its id. */
  createSession(): string;
  pageId?: string;
  app?: string;
  focused?(): boolean;
  connect?(url: string): SocketLike;
  onStatus?(s: 'connecting' | 'connected' | 'disconnected'): void;
  /** Reconnect backoff bounds in ms (0.5 s doubling to 8 s). */
  backoff?: { min: number; max: number };
}

const OPEN = 1;

export class BridgePageClient {
  readonly pageId: string;
  status: 'idle' | 'connecting' | 'connected' | 'disconnected' = 'idle';
  private ws: SocketLike | null = null;
  private readonly o: BridgePageOptions;
  private readonly running = new Map<string, AbortController>();
  private delay: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  /** evals answered (for the status line) */
  evals = 0;

  constructor(o: BridgePageOptions) {
    this.o = o;
    this.pageId = o.pageId ?? `p-${Math.random().toString(36).slice(2, 8)}`;
    this.delay = o.backoff?.min ?? 500;
  }

  start(): void {
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    for (const ac of this.running.values()) ac.abort();
    this.running.clear();
    this.ws?.close(1000, 'page closed');
    this.ws = null;
  }

  private setStatus(s: 'connecting' | 'connected' | 'disconnected'): void {
    this.status = s;
    this.o.onStatus?.(s);
  }

  private frames(): { id: string; name: string; open: boolean }[] {
    const cur = this.o.currentFrame();
    return this.o.frames.ids().map((id) => ({ id, name: this.o.frames.get(id)?.name ?? id, open: id === cur }));
  }

  private send(m: PageToBridge): void {
    if (this.ws && this.ws.readyState === OPEN) this.ws.send(JSON.stringify(m));
  }

  private open(): void {
    if (this.stopped) return;
    this.setStatus('connecting');
    let ws: SocketLike;
    try {
      ws = this.o.connect ? this.o.connect(this.o.url) : (new WebSocket(this.o.url) as unknown as SocketLike);
    } catch {
      this.retry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.delay = this.o.backoff?.min ?? 500;
      const f = this.o.currentFrame();
      this.send({ t: 'hello', page: this.pageId, app: this.o.app ?? 'chromobench-studio', catalogHash: '', focused: this.o.focused?.() ?? true, ...(f ? { frame: f } : {}), frames: this.frames(), mode: this.o.mode() });
      this.setStatus('connected');
    };
    ws.onmessage = (ev) => {
      let m: BridgeToPage;
      try {
        m = JSON.parse(String(ev.data)) as BridgeToPage;
      } catch {
        return;
      }
      void this.handle(m);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      // evals of a dropped connection: their staged changes are discarded (the bridge already failed the calls)
      for (const ac of this.running.values()) ac.abort();
      this.running.clear();
      this.setStatus('disconnected');
      this.retry();
    };
    ws.onerror = () => undefined;
  }

  private retry(): void {
    if (this.stopped) return;
    const max = this.o.backoff?.max ?? 8000;
    const d = this.delay;
    this.delay = Math.min(max, this.delay * 2);
    this.timer = setTimeout(() => this.open(), d);
  }

  /** Report focus, the open frame and the mode (call after they change). */
  update(): void {
    const f = this.o.currentFrame();
    this.send({ t: 'focus', focused: this.o.focused?.() ?? true, ...(f ? { frame: f } : {}), frames: this.frames(), mode: this.o.mode() });
  }

  private async handle(m: BridgeToPage): Promise<void> {
    switch (m.t) {
      case 'eval.cancel':
        this.running.get(m.id)?.abort();
        return;
      case 'session.create':
        try {
          this.send({ t: 'session.created', id: m.id, session: this.o.createSession() });
        } catch (e) {
          this.send({ t: 'session.error', id: m.id, error: (e as Error).message });
        }
        return;
      case 'eval': {
        const s = this.o.session(m.session);
        if (!s) {
          this.send({ t: 'eval.result', id: m.id, isError: true, looks: [], text: `error: E_SESSION\nmessage: "unknown session ${m.session}; omit sessionId to use the default session"\n` });
          return;
        }
        const ac = new AbortController();
        this.running.set(m.id, ac);
        try {
          const frame = m.req.frame || this.o.currentFrame() || undefined;
          const r = await (await s).eval({ code: m.req.code, ...(frame ? { frame } : {}), timeoutMs: m.req.timeoutMs }, { signal: ac.signal });
          if (ac.signal.aborted && r.error?.code === 'E_CANCELLED') return; // nobody waits for it any more
          this.evals++;
          this.send({ t: 'eval.result', id: m.id, text: r.yaml, isError: !!r.error, looks: r.looks.map((l) => ({ n: l.n, caption: l.caption, mime: l.image.mime, base64: toBase64(l.image.bytes) })) });
        } finally {
          this.running.delete(m.id);
        }
        return;
      }
      default:
        return;
    }
  }
}
