// The DOM half of the chat kit: the renderer of the `cb.chat` form (studio-kit's chat slot). It shows the
// conversation with streaming text, thinking summaries, step cards (the eval code, its result and looks), approval
// cards with per-change checkboxes, Revert, notices; the composer with Send and Stop; the mode and effort settings,
// which only the photographer changes; and the model setup (API key typed at runtime, or the scripted demo).
//
//   mountStudio(app, el, studio, { chat, renderers: { ...CHAT_RENDERERS } })

/* eslint-disable @typescript-eslint/no-explicit-any */
import { clear, h, listen, type MountCtx, type Renderer } from '@chromobench/shell/dom';
import { chatServiceOf, EFFORT_LABELS, MODES, type ChatEffort, type ChatItemView, type ChatLook, type ChatService } from './kit.ts';

const btn = (text: string, cls = '', attrs: Record<string, unknown> = {}) => h('button', { type: 'button', class: `ck-btn is-small ${cls}`, text, ...attrs });
const STATUS: Record<string, string> = { idle: '', thinking: 'thinking…', running: 'running an eval…', waiting: 'waiting for your decision' };
const STEP: Record<string, string> = { writing: 'writing', running: 'running', waiting: 'waiting for you', done: 'done', error: 'error', stopped: 'stopped', 'not-run': 'not run' };

const urls = new WeakMap<Uint8Array, string>();
function lookUrl(l: ChatLook): string {
  let u = urls.get(l.bytes);
  if (!u) {
    u = URL.createObjectURL(new Blob([l.bytes as BlobPart], { type: l.mime }));
    urls.set(l.bytes, u);
  }
  return u;
}

function setup(svc: ChatService, m: MountCtx, rerender: () => void): HTMLElement {
  const form = h('form', { class: 'cb-chat-setup', id: 'chat-setup' });
  const sel = h('select', { id: 'chat-provider', 'aria-label': 'Model' }, ...svc.providers.map((p) => h('option', { value: p.id, text: p.label }))) as HTMLSelectElement;
  const key = h('input', { type: 'password', id: 'chat-key', placeholder: 'API key (sk-ant-…)', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'API key' }) as HTMLInputElement;
  const model = h('select', { id: 'chat-model', 'aria-label': 'Model id' }) as HTMLSelectElement;
  const remember = h('input', { type: 'checkbox', id: 'chat-remember' }) as HTMLInputElement;
  const note = h('p', { class: 'cb-dim cb-chat-note' });
  const err = h('p', { class: 'cb-chat-err', role: 'alert' });
  const keyRow = h('div', { class: 'cb-chat-keyrow' }, key, h('label', { for: 'chat-remember', title: 'Keep the key in this browser (localStorage) so you need not type it again' }, remember, ' remember'));
  const saved = svc.savedKey?.() ? btn('Forget saved key', 'cb-chat-forget') : null;
  const sync = (): void => {
    const p = svc.providers.find((x) => x.id === sel.value) ?? svc.providers[0];
    keyRow.hidden = !p?.needsKey;
    model.hidden = !p?.models?.length;
    clear(model);
    for (const id of p?.models ?? []) model.append(h('option', { value: id, text: id }));
    if (p?.defaultModel) model.value = p.defaultModel;
    note.textContent = p?.note ?? '';
    key.placeholder = svc.savedKey?.() ? 'saved key (leave empty to use it)' : 'API key (sk-ant-…)';
  };
  listen(m.scope, sel, 'change', sync);
  listen(m.scope, form, 'submit', (e: Event) => {
    e.preventDefault();
    const problem = svc.connect(sel.value, { apiKey: key.value.trim(), ...(model.value ? { model: model.value } : {}), remember: remember.checked });
    key.value = '';
    if (problem) err.textContent = problem;
    else rerender();
  });
  if (saved) listen(m.scope, saved, 'click', () => {
    svc.forgetKey?.();
    rerender();
  });
  form.append(h('strong', { text: 'Connect the assistant' }), sel, keyRow, model, btn('Connect', 'is-primary', { type: 'submit', id: 'chat-connect' }), ...(saved ? [saved] : []), note, err);
  sync();
  return form;
}

function stepCard(it: Extract<ChatItemView, { kind: 'step' }>, svc: ChatService, m: MountCtx): HTMLElement {
  const s = svc.session;
  const li = h('li', { class: ['cb-chat-step', `is-${it.status}`], 'data-step': it.id, 'data-status': it.status });
  li.append(h('div', { class: 'cb-chat-step-h' }, h('span', { text: 'eval' }), it.frame ? h('span', { class: 'cb-dim', text: ` · ${it.frame}` }) : null, h('span', { class: 'cb-chat-badge', text: STEP[it.status] ?? it.status }), it.ms !== undefined ? h('span', { class: 'cb-dim', text: ` ${it.ms} ms` }) : null));
  li.append(h('pre', { class: 'cb-chat-code', text: it.code || '…' }));
  if (it.looks.length) {
    const row = h('div', { class: 'cb-chat-looks' });
    for (const l of it.looks) row.append(h('figure', { class: 'cb-chat-look' }, h('img', { src: lookUrl(l), alt: l.caption, width: String(Math.min(l.width, 340)) }), h('figcaption', { text: `look ${l.n}: ${l.caption}` })));
    li.append(row);
  }
  if (it.text !== undefined) li.append(h('details', { class: 'cb-chat-result', ...(it.isError ? { open: true } : {}) }, h('summary', { text: it.isError ? 'error' : 'result' }), h('pre', { text: it.text })));
  const ap = it.approval;
  if (ap) {
    const card = h('div', { class: 'cb-card cb-chat-approval', 'data-frame': ap.frame });
    const open = !ap.outcome && it.status === 'waiting';
    card.append(h('div', { class: 'cb-card-h' }, h('strong', { text: open ? 'The assistant asks to change' : 'Proposed' })));
    const boxes: [number, HTMLInputElement][] = [];
    for (const c of ap.changes) {
      const box = h('input', { type: 'checkbox', 'aria-label': `Include ${c.text}` }) as HTMLInputElement;
      box.checked = true;
      box.disabled = !open;
      boxes.push([c.seq, box]);
      const state = ap.outcome ? (ap.outcome.approved.includes(c.seq) ? ' ✓ approved' : ap.outcome.rejected.includes(c.seq) ? ' ✕ rejected' : ' · pending') : '';
      card.append(h('div', { class: 'cb-change' }, h('label', {}, ap.changes.length > 1 ? box : null, ' ', c.text, h('span', { class: 'cb-dim', text: state }))));
    }
    if (ap.problems?.length) card.append(h('div', { class: 'cb-stale' }, ...ap.problems.map((d) => h('div', { text: `${d.code}: ${d.message}` }))));
    if (open) {
      const row = h('div', { class: 'cb-card-b' });
      const ok = btn('Approve', 'approve is-primary');
      const no = btn('Reject', 'reject');
      const later = btn('Decide later', 'later');
      const chosen = (): number[] => boxes.filter(([, b]) => b.checked).map(([seq]) => seq);
      listen(m.scope, ok, 'click', () => s.decide(it.id, chosen(), 'approve'));
      listen(m.scope, no, 'click', () => s.decide(it.id, ap.seqs, 'reject'));
      listen(m.scope, later, 'click', () => s.decide(it.id, [], 'later'));
      row.append(ok, no, later);
      if (ap.problems?.length) {
        const force = btn('Apply anyway', 'force');
        listen(m.scope, force, 'click', () => s.decide(it.id, chosen(), 'approve', { force: true }));
        row.append(force);
      }
      card.append(row);
    }
    li.append(card);
  }
  if (it.applied && !s.busy) {
    const rv = btn(it.reverted ? 'Reverted' : 'Revert', 'revert', { disabled: it.reverted ? true : null, title: 'Undo what this step changed (as your own edit)' });
    listen(m.scope, rv, 'click', () => s.revertStep(it.id));
    li.append(h('div', { class: 'cb-chat-step-b' }, rv));
  }
  return li;
}

function item(it: ChatItemView, svc: ChatService, m: MountCtx): HTMLElement {
  switch (it.kind) {
    case 'user':
      return h('li', { class: 'cb-chat-user', text: it.text });
    case 'assistant': {
      const li = h('li', { class: 'cb-chat-assistant' });
      if (it.thinking) li.append(h('details', { class: 'cb-chat-thinking' }, h('summary', { text: 'reasoning' }), h('p', { text: it.thinking })));
      if (it.text) li.append(h('div', { class: 'cb-chat-text', text: it.text }));
      if (it.fallback) li.append(h('div', { class: 'cb-dim', text: `answered by a fallback model (${it.fallback})` }));
      return li;
    }
    case 'step':
      return stepCard(it, svc, m);
    case 'notice':
      return h('li', { class: ['cb-chat-notice', it.level === 'error' && 'is-error'], text: it.text });
  }
}

const chat: Renderer = (_n, m) => {
  const root = h('div', { class: 'cb-panel cb-chat', id: 'chat' });
  const svc = chatServiceOf(m.rt.services as Record<string, unknown>);
  if (!svc) {
    root.append(h('p', { class: 'cb-empty', text: 'No assistant in this studio (the host did not provide the chat service).' }));
    return root;
  }
  const s = svc.session;
  const head = h('div', { class: 'cb-chat-head' });
  const log = h('ol', { class: 'cb-chat-log', id: 'chat-log', 'aria-live': 'polite' });
  const status = h('div', { class: 'cb-chat-status', id: 'chat-status', role: 'status' });
  const input = h('textarea', { id: 'chat-input', rows: '3', placeholder: 'Ask the assistant… (Enter sends, Shift+Enter for a new line)', 'aria-label': 'Message to the assistant' }) as HTMLTextAreaElement;
  const send = btn('Send', 'is-primary', { id: 'chat-send' });
  const stop = btn('Stop', 'cb-chat-stop', { id: 'chat-stop' });
  const composer = h('div', { class: 'cb-chat-composer' }, input, h('div', { class: 'cb-chat-actions' }, send, stop));
  const body = h('div', { class: 'cb-chat-body' });
  root.append(head, body);

  const doSend = (): void => {
    const t = input.value;
    if (!t.trim() || s.busy) return;
    input.value = '';
    void s.send(t);
  };
  listen(m.scope, send, 'click', doSend);
  listen(m.scope, stop, 'click', () => s.stop());
  listen(m.scope, input, 'keydown', (e: KeyboardEvent) => {
    e.stopPropagation(); // typing never reaches the studio's keyboard shortcuts
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      doSend();
    }
  });

  let connected: boolean | null = null;
  const drawHead = (): void => {
    clear(head);
    const st = s.state;
    const modes = h('div', { class: 'cb-chat-modes', role: 'radiogroup', 'aria-label': 'Agent mode' });
    for (const md of MODES) {
      const b = btn(md.label, st.mode === md.id ? 'is-active' : '', { role: 'radio', 'aria-checked': String(st.mode === md.id), title: md.title, 'data-mode': md.id });
      listen(m.scope, b, 'click', () => s.setMode(md.id));
      modes.append(b);
    }
    const effort = h('select', { id: 'chat-effort', 'aria-label': 'Effort', title: 'How much the assistant thinks before it answers' }, ...(Object.keys(EFFORT_LABELS) as ChatEffort[]).map((e) => h('option', { value: e, text: EFFORT_LABELS[e] }))) as HTMLSelectElement;
    effort.value = st.effort;
    listen(m.scope, effort, 'change', () => s.setEffort(effort.value as ChatEffort));
    const who = h('span', { class: 'cb-chat-model', id: 'chat-model-label', text: st.model ?? 'not connected' });
    head.append(modes, effort, who);
    if (st.model) {
      const off = btn('Change', 'cb-chat-change', { title: 'Choose another model or key' });
      listen(m.scope, off, 'click', () => {
        svc.disconnect();
        frame();
      });
      head.append(off);
    }
  };

  const drawLog = (): void => {
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    clear(log);
    const st = s.state;
    if (!st.items.length) log.append(h('li', { class: 'cb-empty', text: 'Ask about the print in front of you: “the skin looks green”, “make a test strip around the current time”, “why is the sky so dark?”' }));
    for (const it of st.items) log.append(item(it, svc, m));
    if (nearBottom) log.scrollTop = log.scrollHeight;
    status.textContent = `${STATUS[st.status] ?? ''}${st.imagesSent ? `${st.status !== 'idle' ? ' · ' : ''}${st.imagesSent} picture(s) shared` : ''}`;
    send.toggleAttribute('disabled', s.busy);
    stop.hidden = !s.busy;
  };

  const frame = (): void => {
    const st = s.state;
    const isConnected = !!st.model;
    drawHead();
    if (isConnected !== connected) {
      connected = isConnected;
      clear(body);
      if (!isConnected) body.append(setup(svc, m, frame), log, status);
      else body.append(log, status, composer);
    }
    drawLog();
    root.dataset['status'] = st.status;
  };

  let queued = false;
  const schedule = (): void => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      frame();
    });
  };
  const off = s.on((e) => {
    if (e.t === 'changed') schedule();
  });
  m.scope.onDispose(off);
  frame();
  return root;
};

export const CHAT_RENDERERS: Record<string, Renderer> = { 'cb.chat': chat };
