// The chat kit meets the agent structurally (the kit imports neither the agent nor the DSL): the agent's ChatSession
// is a ChatSessionLike. Type-only imports, so the test file loads nothing of the package at run time; the typecheck is
// the test. (CHB-037 P7: the looks kit no longer provides the DSL's named looks: they are links the DSL builds itself.)
import { describe, expect, it } from 'vitest';
import type { ChatSession } from '@chromobench/agent';
import type { ChatSessionLike } from '../../kits/chat/src/kit.ts';

describe('the chat kit fits the agent', () => {
  it('ChatSession is a ChatSessionLike', () => {
    const chat = (s: ChatSession): ChatSessionLike => s;
    expect(typeof chat).toBe('function');
  });
});
