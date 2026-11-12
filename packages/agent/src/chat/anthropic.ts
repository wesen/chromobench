// The Claude API transport for the in-app chat (guide §5.6), on the official TypeScript SDK.
//
// The API key is entered by the photographer at runtime and kept by the page (memory, or the browser's storage if
// they ask); it is never part of the build. With a bridge (`chromobench serve`, guide §5.5) the page instead points
// `baseURL` at the bridge's proxy and sends a placeholder key, which the proxy replaces.
//
// Request shape: adaptive thinking with summarised display, explicit effort, a frozen system prompt and tool list
// with prompt caching, server-side context editing (clears old tool results without editing the history), and
// server-side refusal fallbacks.
import Anthropic from '@anthropic-ai/sdk';
import { ModelError, type ChatModel, type ContentBlock, type ModelReply, type ModelRequest, type ModelSink } from './model.ts';

/** The default model (guide §2.4: Claude Opus 5.5). */
export const DEFAULT_MODEL = 'claude-opus-5-5';
/** The models the panel offers. */
export const MODELS: readonly string[] = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];

export interface AnthropicModelOptions {
  apiKey: string;
  model?: string;
  /** The bridge's proxy (`${origin}/api/claude`), or the API itself (default). */
  baseURL?: string;
  maxTokens?: number;
  /** Server-side refusal fallbacks (default on). */
  fallbacks?: boolean;
  /** Server-side context editing of old tool results (default on). */
  contextEditing?: boolean;
  /** For tests: a fetch implementation. */
  fetch?: typeof fetch;
}

export class AnthropicModel implements ChatModel {
  readonly label: string;
  readonly model: string;
  private readonly client: Anthropic;
  private readonly o: AnthropicModelOptions;

  constructor(o: AnthropicModelOptions) {
    if (!o.apiKey) throw new ModelError('auth', 'no API key');
    this.o = o;
    this.model = o.model ?? DEFAULT_MODEL;
    this.label = this.model;
    this.client = new Anthropic({
      apiKey: o.apiKey,
      ...(o.baseURL ? { baseURL: o.baseURL } : {}),
      dangerouslyAllowBrowser: true, // the photographer's own key, in their own browser
      maxRetries: 2,
      ...(o.fetch ? { fetch: o.fetch } : {}),
    });
  }

  /** The request body (also used by tests to pin the shape). */
  body(req: ModelRequest): Anthropic.Beta.Messages.MessageCreateParamsStreaming {
    const betas: Anthropic.Beta.AnthropicBeta[] = [];
    if (this.o.contextEditing !== false) betas.push('context-management-2025-06-27');
    if (this.o.fallbacks !== false) betas.push('server-side-fallback-2026-07-01');
    return {
      model: this.model,
      max_tokens: this.o.maxTokens ?? 64000,
      stream: true,
      system: [{ type: 'text', text: req.system }],
      tools: req.tools,
      messages: req.messages,
      thinking: { type: 'adaptive', display: 'summarized' } as Anthropic.Beta.Messages.BetaThinkingConfigParam,
      output_config: { effort: req.effort },
      cache_control: { type: 'ephemeral' },
      ...(this.o.contextEditing !== false ? { context_management: { edits: [{ type: 'clear_tool_uses_20250919' }] } } : {}),
      ...(this.o.fallbacks !== false ? { fallbacks: 'default' as const } : {}),
      ...(betas.length ? { betas } : {}),
    };
  }

  async send(req: ModelRequest, sink: ModelSink, signal: AbortSignal): Promise<ModelReply> {
    const toolIds = new Map<number, string>();
    try {
      const stream = this.client.beta.messages.stream(this.body(req), { signal });
      stream.on('streamEvent', (ev) => {
        if (ev.type === 'content_block_start' && ev.content_block.type === 'tool_use') {
          toolIds.set(ev.index, ev.content_block.id);
          sink.toolStart(ev.content_block.id, ev.content_block.name);
        } else if (ev.type === 'content_block_delta') {
          const d = ev.delta;
          if (d.type === 'text_delta') sink.text(d.text);
          else if (d.type === 'thinking_delta') sink.thinking(d.thinking);
          else if (d.type === 'input_json_delta') {
            const id = toolIds.get(ev.index);
            if (id) sink.toolInput(id, d.partial_json);
          }
        }
      });
      const msg = await stream.finalMessage();
      const fb = msg.content.find((b) => b.type === 'fallback') as Anthropic.Beta.Messages.BetaFallbackBlock | undefined;
      const u = msg.usage;
      return {
        content: msg.content as ContentBlock[],
        stop_reason: msg.stop_reason,
        stop_details: (msg as { stop_details?: ModelReply['stop_details'] }).stop_details ?? null,
        usage: { input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens ?? 0 },
        model: msg.model,
        ...(fb ? { fallback: `${fb.from.model} → ${fb.to.model}` } : {}),
      };
    } catch (e) {
      throw toModelError(e, signal);
    }
  }
}

/** The SDK's typed errors as the chat's one-sentence kinds. */
export function toModelError(e: unknown, signal?: AbortSignal): ModelError {
  if (e instanceof ModelError) return e;
  if (signal?.aborted || e instanceof Anthropic.APIUserAbortError) return new ModelError('aborted', 'stopped');
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return new ModelError('auth', 'The API key was not accepted.');
  if (e instanceof Anthropic.RateLimitError) return new ModelError('rate', 'Too many requests right now; your message is kept, press Send to retry.');
  if (e instanceof Anthropic.BadRequestError) return new ModelError('bad-request', `The API refused the request: ${e.message}`);
  if (e instanceof Anthropic.InternalServerError) return new ModelError('overloaded', 'The API is overloaded or failing; try again in a moment.');
  if (e instanceof Anthropic.APIConnectionError) return new ModelError('network', 'Cannot reach the Claude API.');
  if (e instanceof Anthropic.APIError) return new ModelError('api', `The API failed: ${e.message}`);
  return new ModelError('api', e instanceof Error ? e.message : String(e));
}
