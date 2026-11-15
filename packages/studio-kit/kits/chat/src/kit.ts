// cb.kits.chat (CHB-008, CHB-009 task rrhv): the in-app chat with the darkroom assistant, as builder calls on
// cb.core. Headless: the panel form, the Assistant module and the service contract; renderers are ./dom.ts
// (CHAT_RENDERERS, passed to mountStudio).
//
//   s.use(cb.kits.chat.kit).module(cb.kits.chat.modules.assistant())   // viewer in the centre, the chat on the right
//   m.right(ck.dock.column({ width: 380 }, cb.kits.chat.panels.chat()))
//
// The chat session arrives as the service `chat` (ChatService), like the engine: studio-kit imports only the
// contract and the shell. @chromobench/agent's ChatSession satisfies ChatSessionLike (a type test checks it).

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { AgentMode, Diagnostic } from '@chromobench/contract';
import { slot, type Ck } from '@chromobench/shell';
import type { Cb } from '../../../src/cb.ts';

export type ChatEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ChatLook {
  n: number;
  caption: string;
  mime: string;
  bytes: Uint8Array;
  width: number;
  height: number;
}

export interface ChatApproval {
  frame: string;
  seqs: number[];
  changes: { seq: number; text: string }[];
  outcome?: { approved: number[]; rejected: number[]; pending: number[] };
  problems?: Diagnostic[];
}

export type ChatItemView =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; thinking: string; model?: string; fallback?: string }
  | {
      kind: 'step'; id: string; code: string; frame?: string; status: 'writing' | 'running' | 'waiting' | 'done' | 'error' | 'stopped' | 'not-run';
      text?: string; looks: ChatLook[]; ms?: number; isError?: boolean; approval?: ChatApproval; applied?: { frame: string; seqs: number[] }; reverted?: boolean;
    }
  | { kind: 'notice'; id: string; level: 'info' | 'error'; text: string };

export interface ChatStateView {
  status: 'idle' | 'thinking' | 'running' | 'waiting';
  items: readonly ChatItemView[];
  mode: AgentMode;
  effort: ChatEffort;
  model: string | null;
  usage: { input: number; output: number; cacheRead: number };
  imagesSent: number;
}

/** What the panel needs from a chat session (@chromobench/agent's ChatSession). */
export interface ChatSessionLike {
  readonly state: Readonly<ChatStateView>;
  readonly busy: boolean;
  on(fn: (e: { t: string }) => void): () => void;
  send(text: string): Promise<void>;
  stop(): void;
  decide(step: string, seqs: readonly number[], decision: 'approve' | 'reject' | 'later', o?: { force?: boolean }): void;
  revertStep(step: string): boolean;
  setMode(m: AgentMode): void;
  setEffort(e: ChatEffort): void;
}

export interface ChatProvider {
  id: string;
  label: string;
  /** the provider needs an API key typed by the photographer */
  needsKey?: boolean;
  models?: readonly string[];
  defaultModel?: string;
  /** one line under the setup form */
  note?: string;
}

/** The service `chat`: the session plus the photographer's choice of model transport. */
export interface ChatService {
  readonly session: ChatSessionLike;
  readonly providers: readonly ChatProvider[];
  /** Connects a provider; returns an error message, or null. The key is never put in the store or the document. */
  connect(provider: string, o: { apiKey?: string; model?: string; remember?: boolean }): string | null;
  disconnect(): void;
  /** a key remembered on this device (the setup form offers "use the saved key") */
  savedKey?(): boolean;
  forgetKey?(): void;
}

export const chatServiceOf = (services: Record<string, unknown>): ChatService | null => (services['chat'] as ChatService | undefined) ?? null;

export const MODES: readonly { id: AgentMode; label: string; title: string }[] = [
  { id: 'read-only', label: 'Read-only', title: 'The assistant measures and looks; it cannot change anything' },
  { id: 'ask', label: 'Ask', title: 'Changes wait for your approval' },
  { id: 'auto', label: 'Auto', title: 'Changes apply at once and stay undoable' },
];
export const EFFORT_LABELS: Record<ChatEffort, string> = { low: 'Quick', medium: 'Normal', high: 'Careful', xhigh: 'Very careful', max: 'Thorough' };

const CHAT_DOCS = `## cb.kits.chat
The in-app chat with the darkroom assistant (CHB-008): the chat panel and the Assistant module. The session arrives
as the service \`chat\` (ChatService); the agent's edits are proposals on the frames' EditLogs, approved or not.`;

export function createChatKit(ck: Ck, cb: Cb) {
  const { build: b, traced: t } = slot;
  const kit = ck
    .kit('cb.chat')
    .version('1')
    .requires('cb.core')
    .forms({ name: 'cb.chat', slots: { compact: b<boolean>(), frame: t<string | null>() }, doc: 'The chat with the darkroom assistant (renderer: CHAT_RENDERERS)', kind: 'cb' })
    .docs(CHAT_DOCS);
  const chat = (o: Record<string, unknown> = {}): any => {
    const { id, title, ...rest } = o as { id?: string; title?: string };
    return ck.panel.define(id ?? 'chat', { title: title ?? 'Assistant' }, ck.node('cb.chat', rest));
  };
  /** the Assistant module: the print in the centre, the chat on the right */
  const assistant = (o: { id?: string; width?: number } = {}) =>
    ck
      .module(o.id ?? 'assistant', { label: 'Assistant', txOpts: (s: any) => ({ channel: cb.sel.current(s) }) })
      .left(ck.dock.column({ width: 220 }, cb.panels.navigator({ id: 'navigator-assistant' }), cb.panels.history({ id: 'history-assistant' })))
      .center(cb.viewer((s: any) => cb.sel.frame(s)?.print() ?? null, { id: 'assistant', views: true, compare: true, tools: ['probe'], hud: cb.hud.readout() }))
      .right(ck.dock.column({ width: o.width ?? 400 }, chat({ id: 'chat' })))
      .bottom(ck.dock.column({ width: 124 }, cb.views.strip({ id: 'strip-assistant' })))
      .keys({ ...cb.keys.views });
  return ck.product(kit, {
    panels: { chat },
    modules: { assistant },
    lib: { MODES, EFFORT_LABELS },
  });
}

export type ChatKit = ReturnType<typeof createChatKit>;
