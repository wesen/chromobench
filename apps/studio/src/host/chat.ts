// The studio's assistant (CHB-008): a ChatSession whose evals run in a DSL session in a Web Worker, against the
// studio's engine and the frames, offered to the chat kit's panel as the service `chat`. This module (and so
// @chromobench/agent) is loaded on first use through host/lazy-chat.ts: the studio boots without it.
//
// CHB-037 P5b-1: the frames' edits are documents in the store's log now (studio.log, studio.propose); the agent
// package is being brought onto the log in parallel (P6a): the frame source below is handed over as the studio's
// frames until the agent takes the log's API (studio.change / studio.propose / studio.log).
//
// The model transport is chosen by the photographer in the panel: the Claude API with a key they type (kept in
// memory, or in this browser's localStorage when they tick "remember"; never in the build or the document), or the
// scripted demo (no network). Mode changes go through the studio's `agent.mode` command, so the chat, the
// approvals panel and the studio's policy (studio.mode) agree.
import type { AgentMode, EvalRequest } from '@chromobench/contract';
import { AnthropicModel, BridgePageClient, ChatSession, createDslWorker, DEFAULT_MODEL, demoModel, DslWorkerClient, MODELS, type FrameSource } from '@chromobench/agent';
import type { ChatService } from '@chromobench/studio-kit/kits/chat';
import type { Runtime } from '@chromobench/shell';
import type { Studio } from '@chromobench/studio-kit';

const KEY_STORE = 'chromobench.chat.anthropic-key';

const storage = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

export interface StudioChat extends ChatService {
  readonly session: ChatSession;
  attach(rt: Runtime): void;
  /**
   * Connects the page to a running bridge (`chromobench serve`) so external agents (Claude Code, Claude Desktop over
   * MCP) can run evals here, each MCP session in its own DSL worker session.
   */
  connectBridge(url: string, onStatus?: (s: string) => void): BridgePageClient;
  /** the dev entry point window.chromobench.eval(code): its own DSL session */
  devEval(code: string, o?: { frame?: string; timeoutMs?: number; signal?: AbortSignal }): ReturnType<DslWorkerClient['eval']>;
}

export function createStudioChat(studio: Studio): StudioChat {
  let rt: Runtime | null = null;
  const frames = studio.frames as unknown as FrameSource;
  const sessions = new Map<string, Promise<DslWorkerClient>>();
  const dsl = (prefix: string): Promise<DslWorkerClient> => {
    let s = sessions.get(prefix);
    if (!s) {
      s = DslWorkerClient.create({ spawn: createDslWorker, engine: studio.engine, frames, txPrefix: prefix });
      sessions.set(prefix, s);
    }
    return s;
  };
  const session = new ChatSession({
    host: {
      evaluate: async (req: EvalRequest, signal: AbortSignal) => (await dsl('chat')).eval(req, { signal }),
      currentFrame: () => studio.current,
      frames,
      mode: () => studio.mode,
      setMode: (m: AgentMode) => {
        if (rt) rt.runCommand('agent.mode', null, m);
        else studio.mode = m;
      },
    },
  });
  const size = (): { width: number; height: number } | null => {
    const f = studio.current;
    const e = f ? studio.frames.get(f) : undefined;
    return e ? { width: e.info.width, height: e.info.height } : null;
  };
  return {
    session,
    providers: [
      { id: 'anthropic', label: 'Claude (your API key)', needsKey: true, models: MODELS, defaultModel: DEFAULT_MODEL, note: 'The key stays in this browser and is sent only to api.anthropic.com; usage is billed to your Anthropic account. Pictures the assistant looks at are sent with the conversation.' },
      { id: 'demo', label: 'Scripted demo (offline)', note: 'Plays a fixed grey balance on the open frame through the real evals and approval cards; no network, no key.' },
    ],
    connect(provider, o) {
      if (provider === 'demo') {
        session.setModel(demoModel({ size }));
        return null;
      }
      if (provider !== 'anthropic') return `unknown provider ${provider}`;
      const key = o.apiKey || storage()?.getItem(KEY_STORE) || '';
      if (!key) return 'Enter your Anthropic API key.';
      if (!/^sk-ant-/.test(key)) return 'That does not look like an Anthropic API key (they start with sk-ant-).';
      try {
        session.setModel(new AnthropicModel({ apiKey: key, ...(o.model ? { model: o.model } : {}) }));
      } catch (e) {
        return (e as Error).message;
      }
      if (o.remember && o.apiKey) storage()?.setItem(KEY_STORE, o.apiKey);
      return null;
    },
    disconnect: () => session.setModel(null),
    savedKey: () => !!storage()?.getItem(KEY_STORE),
    forgetKey: () => storage()?.removeItem(KEY_STORE),
    attach(r) {
      rt = r;
    },
    connectBridge(url, onStatus) {
      let n = 0;
      const known = new Set(['default']);
      const b = new BridgePageClient({
        url,
        frames,
        currentFrame: () => studio.current,
        mode: () => studio.mode,
        focused: () => document.hasFocus(),
        session: (id) => (known.has(id) ? dsl(id === 'default' ? 'mcp' : `mcp-${id}`) : null),
        createSession: () => {
          const id = `s-${++n}`;
          known.add(id);
          return id;
        },
        ...(onStatus ? { onStatus } : {}),
      });
      b.start();
      return b;
    },
    async devEval(code, o = {}) {
      const f = o.frame ?? studio.current ?? undefined;
      return (await dsl('dev')).eval({ code, ...(f ? { frame: f } : {}), ...(o.timeoutMs ? { timeoutMs: o.timeoutMs } : {}) }, o.signal ? { signal: o.signal } : {});
    },
  };
}
