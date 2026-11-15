// cb.core's agent commands (CHB-029 item 3: one declarative table per area): the agent's proposals (show, include a change, approve, reject, approve all) and the agent mode.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { CommandTable } from '@chromobench/shell';
import { sel, type CbState } from '../sel.ts';
import { studioOf, approve } from './env.ts';

export const agentCommands = (): CommandTable<CbState> => ({
  'proposal.show': {
    label: 'Show Proposal',
    palette: false,
    run: (ctx, tx: string | null) => ctx.set({ ui: { showProposal: ctx.state.ui.showProposal === tx ? null : tx } }),
  },
  'proposal.toggle': {
    label: 'Include Change',
    palette: false,
    run: (ctx, tx: string, seq: number) => {
      const off = ctx.state.ui.approvals?.[tx]?.off ?? [];
      ctx.set({ ui: { approvals: { [tx]: { off: off.includes(seq) ? off.filter((x: number) => x !== seq) : [...off, seq] } } } });
    },
  },
  'proposal.approve': {
    label: 'Approve Agent Change',
    palette: false,
    run: (ctx, f: string, tx: string, force = false) => approve(ctx, f, tx, !!force),
  },
  'proposal.reject': {
    label: 'Reject Agent Change',
    palette: false,
    run: (ctx, f: string, tx: string) => {
      const p = (sel.proposals(ctx.state, f)).find((x: any) => x.tx === tx);
      if (!p) return;
      studioOf(ctx).route.reject(f, p.seqs);
      ctx.set({ ui: { showProposal: ctx.state.ui.showProposal === tx ? null : ctx.state.ui.showProposal } });
    },
  },
  'proposal.approveAll': {
    label: 'Approve All Agent Changes',
    enabled: (s: any) => sel.proposals(s).length > 0,
    why: 'No pending agent changes on this frame',
    run: ctx => {
      const f = sel.current(ctx.state)!;
      for (const p of [...(sel.proposals(ctx.state, f))]) approve(ctx, f, p.tx, false);
    },
  },
  'agent.mode': {
    label: 'Agent Mode',
    palette: false,
    run: (ctx, mode: 'read-only' | 'ask' | 'auto') => {
      studioOf(ctx).frames.setMode(mode);
      ctx.set({ prefs: { agentMode: mode } });
    },
  },
});
