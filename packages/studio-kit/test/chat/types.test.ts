// The chat and looks kits meet the agent and the DSL structurally (the kits import neither): the agent's
// ChatSession is a ChatSessionLike, and the looks kit's provider is the DSL's LooksProvider. Type-only imports,
// so the test file loads nothing of either package at run time; the typecheck is the test.
import { describe, expect, it } from 'vitest';
import type { ChatSession } from '@chromobench/agent';
import type { LooksProvider } from '@chromobench/dsl';
import type { ChatSessionLike } from '../../kits/chat/src/kit.ts';
import type { LooksProviderShape } from '../../kits/looks/src/engine/provider.ts';

describe('the kits fit the agent and the DSL', () => {
  it('ChatSession is a ChatSessionLike; the looks provider is a LooksProvider', () => {
    const chat = (s: ChatSession): ChatSessionLike => s;
    const looks = (p: LooksProviderShape): LooksProvider => p;
    expect(typeof chat).toBe('function');
    expect(typeof looks).toBe('function');
  });
});
