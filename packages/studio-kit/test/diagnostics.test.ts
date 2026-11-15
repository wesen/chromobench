// cb.kits.diagnostics (CHB-038): a report holds the chosen parts and nothing else, reads back with its frames'
/* eslint-disable @typescript-eslint/no-explicit-any */
// documents and history, the journal's tail survives a restart through the KV, and the commands need the service.
import { describe, expect, it } from 'vitest';
import { createCk, Journal } from '@chromobench/shell';
import { createCb } from '../src/cb.ts';
import { memoryKV } from '../src/bridge/kv.ts';
import { FRAME_SAVE_FORMAT, FRAME_SAVE_VERSION, type FrameSave } from '../src/bridge/saved.ts';
import { buildLayout } from '../src/layout.ts';
import { JOURNAL_KEY, keepJournal, readReport, reportFiles, reportName, summaryText, type ReportInput } from '../kits/diagnostics/src/index.ts';

const save = (): FrameSave => ({
  format: FRAME_SAVE_FORMAT, version: FRAME_SAVE_VERSION, initial: { frame: 'f1' } as never,
  applied: [{ id: 't1', label: 'Time', by: 'user', source: { kind: 'gesture' }, mutations: [{ op: 'set', path: 'main.params.time_s', value: 12 }] }], pending: [],
});

function input(parts: ReportInput['parts']): ReportInput {
  const j = new Journal({ session: 's1' });
  j.error('gpu', 'engine: validation error: [Texture "src"] is destroyed', { code: 'GPU_VALIDATION' });
  j.error('gpu', 'engine: validation error: [Texture "src"] is destroyed', { code: 'GPU_VALIDATION' });
  j.info('command', 'frame.next');
  return {
    created: Date.UTC(2026, 10, 15, 14, 32), description: 'the picture went black', app: { version: '0.1.0', commit: 'abc1234' }, parts,
    environment: { browser: { userAgent: 'UA', summary: 'Chrome 142 on macOS' }, engine: { label: 'GPU · apple' }, gpu: { engine: { name: 'apple metal-3' } } },
    journal: j.toJSON(), settings: { prefs: {} }, view: { module: 'print' },
    frames: [{
      id: 'f1', name: 'scan-007.tif', sha256: 'ab12cd34'.padEnd(64, '0'), kind: 'negative-scan', document: { frame: 'f1' }, save: save(),
      entries: [{ seq: 1, at: 1, by: 'user', label: 'Time', status: 'applied', mutations: [] }],
      preview: new Uint8Array([137, 80, 78, 71]), original: { name: 'scan-007.tif', bytes: new Uint8Array(1000) },
    }],
    screenshot: new Uint8Array([137, 80, 78, 71, 1]),
  };
}

describe('the report', () => {
  it('holds exactly the chosen parts', () => {
    const paths = (p: ReportInput['parts']) => reportFiles(input(p)).files.map(([x]) => x).sort();
    const always = ['README.txt', 'environment.json', 'journal.json', 'journal.txt', 'report.json', 'settings.json'];
    expect(paths([])).toEqual(always);
    expect(paths(['documents'])).toEqual([...always, 'frames/f1/document.json', 'frames/f1/history.json', 'view.json'].sort());
    expect(paths(['pictures'])).toEqual([...always, 'previews/f1.png', 'screenshot.png'].sort());
    expect(paths(['originals'])).toEqual([...always, 'originals/ab12cd34-scan-007.tif'].sort());
    const { manifest } = reportFiles(input(['documents']));
    expect(manifest.parts).toEqual(['environment', 'journal', 'settings', 'documents']);
    expect(manifest.summary).toEqual({ errors: 2, warnings: 0, rows: 2, sessions: 1 });
    expect(manifest.frames[0]).toMatchObject({ id: 'f1', steps: 1, document: 'frames/f1/document.json' });
    expect(manifest.frames[0]!.original).toBeUndefined();
  });

  it('reads back: frames with their document, history, picture and original; the README says what happened', () => {
    const { files } = reportFiles(input(['documents', 'pictures', 'originals']));
    const r = readReport(new Map(files));
    expect(r.manifest.description).toBe('the picture went black');
    expect(r.frames[0]!.save!.applied[0]!.label).toBe('Time');
    expect(r.frames[0]!.entries).toHaveLength(1);
    expect(r.frames[0]!.document).toEqual({ frame: 'f1' });
    expect(r.frames[0]!.original!.length).toBe(1000);
    expect(r.frames[0]!.file).toBe('scan-007.tif');
    expect(r.journal!.rows[0]!.count).toBe(2);
    expect(r.readme).toMatch(/the picture went black/);
    expect(r.readme).toMatch(/GPU_VALIDATION ×2/);
    expect(() => readReport(new Map())).toThrow(/not a Chromobench problem report/);
    expect(reportName(Date.UTC(2026, 10, 15, 14, 32), 'a1b2c3d4e5')).toMatch(/^chromobench-report-2026-11-15-\d{4}-a1b2c3d4\.zip$/);
    expect(summaryText({ app: { version: '0.1.0', commit: 'abc' }, environment: input([]).environment, journal: r.journal! })).toMatch(/2 errors, 0 warnings\.\n.*GPU_VALIDATION ×2/);
  });
});

describe('the journal across a restart', () => {
  it('keepJournal restores the earlier tail and saves the new one', async () => {
    const kv = memoryKV();
    const a = new Journal({ session: 'a' });
    const ka = await keepJournal(a, kv, { delayMs: 5 });
    a.error('gpu', 'device lost', { code: 'GPU_DEVICE_LOST' });
    await ka.flush();
    ka.stop();
    const b = new Journal({ session: 'b' });
    const kb = await keepJournal(b, kv);
    expect(kb.restored).toBe(1);
    expect(b.rows().map((r) => `${r.session}:${r.message}`)).toEqual(['a:device lost']);
    b.info('app', 'start');
    await kb.flush();
    expect(((await kv.get<{ rows: unknown[] }>('settings', JOURNAL_KEY))!.rows).length).toBe(2);
    kb.stop();
  });
});

describe('the kit', () => {
  it('every layout has Help ▸ Report a Problem…; without the service the commands are hidden', () => {
    const cb = createCb(createCk());
    expect(cb.kits['diagnostics'].commands).toEqual(['diagnostics.report', 'diagnostics.show', 'diagnostics.openReport', 'diagnostics.copySummary']);
    const built = buildLayout({ id: 't', label: 'T', build: (ck: any, c: any) => c.studio('T').menus(...c.menus.standard()).module(ck.module('m', { label: 'M' }).center(ck.text('x'))) });
    const rt = built.app.start({});
    expect(rt.commands.status('diagnostics.report', rt.store.readonly()).ok).toBe(false);
    let reported = 0;
    const rt2 = built.app.start({ diagnostics: { journal: new Journal(), report: () => void reported++, show: () => undefined, openReport: () => undefined, copySummary: () => undefined } });
    rt2.run('diagnostics.report');
    expect(reported).toBe(1);
  });
});
