// The Claude API transport against a fake fetch that streams recorded-style SSE: request shape (model, adaptive
// thinking, explicit effort, frozen system and tools with eager input streaming, context editing, fallbacks),
// stream parsing into text and tool-input deltas, the final content, and typed errors as one-sentence kinds.
import { describe, expect, it } from 'vitest';
import { AnthropicModel, DEFAULT_MODEL, EVAL_TOOL, ModelError, systemPrompt, type ModelSink } from '../src/index.ts';

const sse = (events: object[]): string => events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join('');

const TWO_BLOCKS = sse([
  { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 120, output_tokens: 1, cache_read_input_tokens: 100 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Let me ' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'measure.' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_01', name: 'eval', input: {} } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"code": "ret' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: 'urn 1"}' } },
  { type: 'content_block_stop', index: 1 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 30 } },
  { type: 'message_stop' },
]);

function fakeFetch(body: string, status = 200, seen: { url?: string; headers?: Headers; body?: Record<string, unknown> } = {}): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    seen.url = String(url);
    seen.headers = new Headers(init?.headers);
    seen.body = JSON.parse(String(init?.body ?? '{}'));
    if (status !== 200) return new Response(JSON.stringify({ type: 'error', error: { type: status === 401 ? 'authentication_error' : 'rate_limit_error', message: 'nope' } }), { status, headers: { 'content-type': 'application/json' } });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }) as typeof fetch;
}

const sinkLog = () => {
  const out: string[] = [];
  const sink: ModelSink = { text: (d) => out.push(`t:${d}`), thinking: (d) => out.push(`k:${d}`), toolStart: (id, n) => out.push(`s:${id}:${n}`), toolInput: (id, j) => out.push(`i:${id}:${j}`) };
  return { out, sink };
};

describe('AnthropicModel', () => {
  it('sends the guide\'s request shape and streams text and tool input', async () => {
    const seen: { url?: string; headers?: Headers; body?: Record<string, unknown> } = {};
    const m = new AnthropicModel({ apiKey: 'sk-test-not-a-key', fetch: fakeFetch(TWO_BLOCKS, 200, seen) });
    const { out, sink } = sinkLog();
    const r = await m.send({ system: 'SYS', tools: [EVAL_TOOL], messages: [{ role: 'user', content: 'hi' }], effort: 'high' }, sink, new AbortController().signal);
    expect(seen.url).toMatch(/\/v1\/messages\?beta=true$/);
    expect(seen.headers!.get('x-api-key')).toBe('sk-test-not-a-key');
    expect(seen.headers!.get('anthropic-beta')).toBe('context-management-2025-06-27,server-side-fallback-2026-07-01');
    expect(seen.body).toMatchObject({
      model: DEFAULT_MODEL, stream: true, max_tokens: 64000,
      system: [{ type: 'text', text: 'SYS' }],
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'high' },
      cache_control: { type: 'ephemeral' },
      context_management: { edits: [{ type: 'clear_tool_uses_20250919' }] },
      fallbacks: 'default',
    });
    expect((seen.body!['tools'] as { eager_input_streaming?: boolean }[])[0]!.eager_input_streaming).toBe(true);
    expect(seen.body!['tool_choice']).toBeUndefined(); // forced tool choice is rejected on the default model
    expect(out).toEqual(['t:Let me ', 't:measure.', 's:toolu_01:eval', 'i:toolu_01:{"code": "ret', 'i:toolu_01:urn 1"}']);
    expect(r.stop_reason).toBe('tool_use');
    expect(r.content).toMatchObject([{ type: 'text', text: 'Let me measure.' }, { type: 'tool_use', id: 'toolu_01', name: 'eval', input: { code: 'return 1' } }]);
    expect(r.usage).toEqual({ input: 120, output: 30, cacheRead: 100 });
  });

  it('typed API errors become one-sentence kinds', async () => {
    const bad = new AnthropicModel({ apiKey: 'sk-x', fetch: fakeFetch('', 401) });
    const { sink } = sinkLog();
    await expect(bad.send({ system: 's', tools: [], messages: [{ role: 'user', content: 'x' }], effort: 'low' }, sink, new AbortController().signal)).rejects.toMatchObject({ kind: 'auth' });
    expect(() => new AnthropicModel({ apiKey: '' })).toThrow(ModelError);
  });

  it('the system prompt carries the generated DSL instructions and reference; the eval tool is strict about its input', () => {
    const s = systemPrompt({ houseNotes: 'Say "cast", not "tint".' });
    expect(s).toContain('# You are the darkroom assistant in Chromobench');
    expect(s).toContain('# Chromobench DSL: instructions');
    expect(s).toContain('frame.edit(');
    expect(s).toContain('Say "cast", not "tint".');
    expect(s.length).toBeGreaterThan(20000);
    expect(EVAL_TOOL.input_schema).toMatchObject({ required: ['code'], additionalProperties: false });
  });
});
