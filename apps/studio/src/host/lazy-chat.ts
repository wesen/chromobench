// The assistant, loaded on first use (CHB-037 P5b-1): host/chat.ts imports @chromobench/agent (models, the DSL
// worker, the bridge), which the studio does not need to start. This module offers the chat kit its service `chat`
// at once (a session whose state is empty until the agent is loaded) and loads host/chat.ts when the photographer
// connects a model, a bridge asks for the page, or a dev eval runs. A failure to load is said (onError: a toast and a
// diagnostic), never a page error, and the studio keeps working without the assistant.
import type { AgentMode } from '@chromobench/contract';
import type { Runtime } from '@chromobench/shell';
import type { Studio } from '@chromobench/studio-kit';
import type { ChatEffort, ChatProvider, ChatService, ChatSessionLike, ChatStateView } from '@chromobench/studio-kit/kits/chat';
import type { StudioChat } from './chat.ts';

/** What a bridge client is to the page (BridgePageClient, structurally). */
export interface BridgeLike {
  update(): void;
}

export interface LazyChat extends ChatService {
  attach(rt: Runtime): void;
  /** Loads the assistant (once); null when it cannot load (the reason went to onError). */
  load(): Promise<StudioChat | null>;
  connectBridge(url: string, onStatus?: (s: string) => void): Promise<BridgeLike | null>;
  devEval(code: string, o?: { frame?: string; timeoutMs?: number; signal?: AbortSignal }): Promise<unknown>;
}

const EMPTY: ChatStateView = { status: 'idle', items: [], mode: 'ask', effort: 'medium', model: null, usage: { input: 0, output: 0, cacheRead: 0 }, imagesSent: 0 };

export function lazyChat(studio: Studio, onError: (message: string, err: unknown) => void): LazyChat {
  let real: StudioChat | null = null;
  let loading: Promise<StudioChat | null> | null = null;
  let rt: Runtime | null = null;
  const listeners = new Set<(e: { t: string }) => void>();
  const load = (): Promise<StudioChat | null> =>
    (loading ??= import('./chat.ts').then(
      (m) => {
        real = m.createStudioChat(studio);
        if (rt) real.attach(rt);
        for (const f of listeners) real.session.on(f);
        for (const f of listeners) f({ t: 'changed' });
        // the providers' model lists come with the agent
        const a = real.providers.find((p) => p.id === 'anthropic');
        const mine = providers.find((p) => p.id === 'anthropic');
        if (a && mine) Object.assign(mine, a);
        return real;
      },
      (err) => {
        onError('The assistant could not be loaded: the studio works without it', err);
        return null;
      },
    ));
  const session: ChatSessionLike = {
    get state() {
      return real?.session.state ?? { ...EMPTY, mode: studio.mode };
    },
    get busy() {
      return real?.session.busy ?? false;
    },
    on(fn) {
      listeners.add(fn);
      const off = real?.session.on(fn);
      return () => {
        listeners.delete(fn);
        off?.();
      };
    },
    send: async (text) => {
      const c = await load();
      if (c) await c.session.send(text);
    },
    stop: () => real?.session.stop(),
    decide: (step, seqs, decision, o) => real?.session.decide(step, seqs, decision, o),
    revertStep: (step) => real?.session.revertStep(step) ?? false,
    setMode: (m: AgentMode) => {
      if (real) return real.session.setMode(m);
      if (rt) rt.runCommand('agent.mode', null, m);
      else studio.mode = m;
      // the panel draws the mode from the session's state: tell it (the agent is not loaded, so nobody else does)
      for (const f of [...listeners]) f({ t: 'changed' });
    },
    setEffort: (e: ChatEffort) => real?.session.setEffort(e),
  };
  const providers: ChatProvider[] = [
    { id: 'anthropic', label: 'Claude (your API key)', needsKey: true, note: 'The key stays in this browser and is sent only to api.anthropic.com; usage is billed to your Anthropic account. Pictures the assistant looks at are sent with the conversation.' },
    { id: 'demo', label: 'Scripted demo (offline)', note: 'Plays a fixed grey balance on the open frame through the real evals and approval cards; no network, no key.' },
  ];
  return {
    session,
    providers,
    connect(provider, o) {
      if (real) return real.connect(provider, o);
      // what the form can say before the assistant is loaded (the same words as host/chat.ts)
      if (provider !== 'demo' && provider !== 'anthropic') return `unknown provider ${provider}`;
      if (provider === 'anthropic') {
        let stored = '';
        try {
          stored = globalThis.localStorage?.getItem('chromobench.chat.anthropic-key') ?? '';
        } catch {
          /* no storage */
        }
        const key = o.apiKey || stored;
        if (!key) return 'Enter your Anthropic API key.';
        if (!/^sk-ant-/.test(key)) return 'That does not look like an Anthropic API key (they start with sk-ant-).';
      }
      void load().then((c) => {
        const err = c?.connect(provider, o);
        if (err) onError(err, null);
      });
      return null;
    },
    disconnect: () => real?.disconnect(),
    savedKey: () => {
      try {
        return !!globalThis.localStorage?.getItem('chromobench.chat.anthropic-key');
      } catch {
        return false;
      }
    },
    forgetKey: () => {
      try {
        globalThis.localStorage?.removeItem('chromobench.chat.anthropic-key');
      } catch {
        /* no storage */
      }
    },
    attach(r) {
      rt = r;
      real?.attach(r);
    },
    load,
    async connectBridge(url, onStatus) {
      const c = await load();
      return c ? (c.connectBridge(url, onStatus) as BridgeLike) : null;
    },
    async devEval(code, o = {}) {
      const c = await load();
      if (!c) throw new Error('the assistant is not available');
      return c.devEval(code, o);
    },
  };
}
