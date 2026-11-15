// cb.kits.diagnostics (CHB-038): the diagnostics journal and the bug report, as a kit. Headless: the commands, the
// Diagnostics panel's form, and the service contract; renderers and dialog bodies are ./dom.ts (DIAGNOSTICS_RENDERERS).
//
//   Help ▸ Report a Problem…   diagnostics.report      one dialog: what happened, what to include (with sizes), one file
//   Help ▸ Diagnostics…        diagnostics.show        the journal: filter by level and source, copy, clear, report
//   File ▸ Open Report…        diagnostics.openReport  a report someone sent: its environment, journal, frames, history
//   Copy Problem Summary       diagnostics.copySummary a few lines of text for a quick message
//
// The journal and what only the host can gather (the GPU, the pictures, the files, the zip, the download) arrive as
// the service `diagnostics` (DiagnosticsService), like the chat: each command requires its member, so a host without
// the service (the dev host, headless tests) shows none of them. Every studio has the kit (cb.studio installs it).

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Ck, Journal } from '@chromobench/shell';
import type { Cb } from '../../../src/cb.ts';
import { CHOICES } from './report.ts';

/** What the host gives the kit as `services.diagnostics`. */
export interface DiagnosticsService {
  readonly journal: Journal;
  /** Help ▸ Diagnostics…: the journal in a dialog (the badge opens it) */
  show(): unknown;
  /** Help ▸ Report a Problem…: the dialog, then one file */
  report(): unknown;
  /** File ▸ Open Report…: a report someone sent (bytes given: that one, else a file picker) */
  openReport(bytes?: Uint8Array): unknown;
  /** a few lines for a quick message, on the clipboard */
  copySummary(): unknown;
  /** what this computer and the studio are (browser, screen, GPU devices, engine): the report's environment */
  environment?(): unknown;
}

export const diagnosticsOf = (services: Record<string, unknown>): DiagnosticsService | null => (services['diagnostics'] as DiagnosticsService | undefined) ?? null;
const svc = (ctx: any): DiagnosticsService => diagnosticsOf(ctx.services)!;

const DIAGNOSTICS_DOCS = `## cb.kits.diagnostics
The diagnostics journal and problem reports (CHB-038). Help ▸ Report a Problem… makes one zip (the journal, the
environment, the settings; his edits and small pictures by default; the original files only when he ticks them);
File ▸ Open Report… opens one. The journal arrives as the service \`diagnostics\` with the host's report builder.`;

export function createDiagnosticsKit(ck: Ck, _cb: Cb) {
  const kit = ck
    .kit('cb.diagnostics')
    .version('1')
    .requires('cb.core')
    .forms({ name: 'cb.diagnostics', slots: {}, doc: 'The diagnostics journal: rows with counts, filter by level and source, copy, clear, report (renderer: DIAGNOSTICS_RENDERERS)', kind: 'cb' })
    .commands({
      'diagnostics.report': { label: 'Report a Problem…', group: 'Help', doc: 'One file to send: what happened, the journal, the settings, and what you choose to include', requires: 'diagnostics.report', run: (ctx: any) => svc(ctx).report() },
      'diagnostics.show': { label: 'Diagnostics…', group: 'Help', doc: 'What the studio recorded: errors, warnings and events, with how often each happened', requires: 'diagnostics.show', run: (ctx: any) => svc(ctx).show() },
      'diagnostics.openReport': { label: 'Open Report…', group: 'File', doc: 'Open a problem report someone sent: what happened, their journal, their photos and edits', requires: 'diagnostics.openReport', run: (ctx: any) => svc(ctx).openReport() },
      'diagnostics.copySummary': { label: 'Copy Problem Summary', group: 'Help', doc: 'A few lines about the last problems, on the clipboard, for a quick message', requires: 'diagnostics.copySummary', run: (ctx: any) => svc(ctx).copySummary() },
    })
    .docs(DIAGNOSTICS_DOCS);
  /** the Diagnostics panel (a layout may place it; Help ▸ Diagnostics… shows the same in a dialog) */
  const diagnostics = (o: Record<string, unknown> = {}): any => {
    const { id, title, ...rest } = o as { id?: string; title?: string };
    return ck.panel.define(id ?? 'diagnostics', { title: title ?? 'Diagnostics' }, ck.node('cb.diagnostics', rest));
  };
  return ck.product(kit, {
    panels: { diagnostics },
    menus: {
      /** the Help menu's items (cb.menus.help places them) */
      help: () => ['diagnostics.report', 'diagnostics.show', 'diagnostics.copySummary'],
    },
    lib: { CHOICES },
  });
}

export type DiagnosticsKit = ReturnType<typeof createDiagnosticsKit>;
