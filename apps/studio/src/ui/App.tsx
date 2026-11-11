// The studio layout (guide §5.3) in Chromogen Studio's look (studio.css): bar / left / mid / right.
// Left: library, history with pending agent changes, snapshots, provenance. Mid: view bar, viewer,
// densitometer readout, film strip. Right: Controls · Tools · Chat.
import type { AgentMode } from '@chromobench/contract';
import { useEffect, useState, type ReactElement } from 'react';
import { actionFor, isTyping, SHORTCUTS } from '../core/keyboard.ts';
import type { Studio } from '../core/studio.ts';
import { download } from '../host/export.ts';
import { ControlPanel } from './Controls.tsx';
import { HistoryList, PendingCards, Snapshots, WhyPanel } from './History.tsx';
import { useLogVersion, useStore, useStudio, useStudioState } from './hooks.ts';
import { FilmStrip, LibraryPanel, OpenFilesButton } from './Library.tsx';
import { ToolsPanel } from './tools/Tools.tsx';
import { Readout, Viewer, ViewBar } from './Viewer.tsx';

function TopBar({ onHelp }: { onHelp: () => void }): ReactElement {
  const st = useStudio();
  useLogVersion();
  const lib = useStore(st.library.state, (s) => s);
  const mode = useStudioState((s) => s.mode);
  const offline = useStudioState((s) => s.offline);
  const update = useStudioState((s) => s.updateReady);
  const busy = useStudioState((s) => s.busy);
  const hasFrame = useStudioState((s) => s.frameKey !== null);
  const [space, setSpace] = useState<'srgb' | 'display-p3'>('srgb');
  const log = st.session?.log;
  const exportPng = async (): Promise<void> => {
    const x = await st.exportPng(space);
    if (x) download(x.blob, x.fileName);
  };
  const saveRecipe = (): void => {
    const r = st.recipeJson();
    if (r) download(new Blob([r.json], { type: 'application/json' }), r.fileName);
  };
  const project = lib.projects.find((p) => p.id === lib.currentProject)?.name;
  const roll = lib.rolls.find((r) => r.id === lib.currentRoll)?.name;
  const theme = (): void => {
    const root = document.documentElement;
    const dark = root.dataset['theme'] ? root.dataset['theme'] === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset['theme'] = dark ? 'light' : 'dark';
    try {
      localStorage.setItem('chromobench-theme', root.dataset['theme']);
    } catch {
      // preferences are a convenience
    }
  };
  return (
    <header className="st-bar">
      <div className="brand">Chromobench <i>studio · {st.engine.id} engine</i></div>
      <nav className="frame-t" aria-label="Breadcrumb"><small>{project ?? 'no project'}{roll ? ` ▸ ${roll}` : ''}</small><b id="frame-name">{st.session?.name ?? 'no frame'}</b></nav>
      <OpenFilesButton />
      <button id="undo" className="btn sm" disabled={!log?.canUndo()} onClick={() => st.undo()} title="Undo (Ctrl+Z)">Undo</button>
      <button id="redo" className="btn sm" disabled={!log?.canRedo()} onClick={() => st.redo()} title="Redo (Shift+Ctrl+Z)">Redo</button>
      <button id="export" className="btn sm primary" disabled={!hasFrame || busy !== null} onClick={() => void exportPng()} title="Export the print as an 8-bit PNG at the working size">Export PNG</button>
      <select id="export-space" className="bar-select" aria-label="Export colour space" value={space} onChange={(e) => setSpace(e.target.value as 'srgb' | 'display-p3')}>
        <option value="srgb">sRGB</option><option value="display-p3">Display P3</option>
      </select>
      <button id="save-recipe" className="btn sm" disabled={!hasFrame} onClick={saveRecipe} title="Download the recipe and its history as JSON (it is also kept in the browser, by the file's hash)">Save recipe</button>
      <span className="sp" />
      {update && <button className="btn sm" onClick={() => location.reload()}>A new version is ready; reload when convenient</button>}
      <span className="small mut" id="offline-state">{offline === 'ready' ? 'offline ready' : offline === 'installing' ? 'caching…' : ''}</span>
      <label className="small mut" htmlFor="mode">Agent</label>
      <select id="mode" value={mode} onChange={(e) => void st.setMode(e.target.value as AgentMode)} className="bar-select">
        <option value="ask">ask first</option><option value="auto">apply at once</option><option value="read-only">read-only</option>
      </select>
      <span className="pill" title="SHA-256 of the committed recipe"><span>state</span><b id="hash">{log ? log.stateHash.slice(0, 16) : '—'}</b></span>
      <button className="btn sm" onClick={theme} aria-label="Toggle light and dark theme">◐</button>
      <button className="btn sm" onClick={onHelp} aria-label="Keyboard shortcuts">?</button>
    </header>
  );
}

function RightPanel(): ReactElement {
  const [tab, setTab] = useState<'controls' | 'tools' | 'chat'>('controls');
  const tool = useStudioState((s) => s.tool);
  useEffect(() => {
    if (tool) setTab('tools');
  }, [tool]);
  return (
    <aside className="st-right">
      <div className="tabs" role="tablist">
        {(['controls', 'tools', 'chat'] as const).map((t) => (
          <button key={t} role="tab" id={`tab-${t}`} aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t[0]!.toUpperCase() + t.slice(1)}</button>
        ))}
      </div>
      <div role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'controls' && <ControlPanel />}
        {tab === 'tools' && <ToolsPanel />}
        {tab === 'chat' && <section className="sec"><div className="h"><b>Chat</b></div><p className="empty">The chat panel renders CHB-008's ChatSession and arrives with the bridge. Until then, agent changes enter through <code>chromobench.propose()</code> and appear under "Waiting for you".</p></section>}
      </div>
    </aside>
  );
}

function Help({ onClose }: { onClose: () => void }): ReactElement {
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="h"><b>Keyboard shortcuts</b><button className="btn sm" style={{ marginLeft: 'auto' }} onClick={onClose} autoFocus>Close</button></div>
        <table className="exp"><tbody>{SHORTCUTS.map(([k, what]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{what}</td></tr>)}</tbody></table>
      </div>
    </div>
  );
}

function useShortcuts(st: Studio, help: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isTyping(e.target)) return;
      const a = actionFor(e);
      if (!a) return;
      const views = { view1: 'print', view2: 'negative', view3: 'dyes', view4: 'classes' } as const;
      switch (a) {
        case 'undo': st.undo(); break;
        case 'redo': st.redo(); break;
        case 'beforeAfter': st.setSplit(st.s.split === null ? 0.5 : null); break;
        case 'snapshot': void st.snapshot(); break;
        case 'testStrip': st.setTool('testStrip'); break;
        case 'ringAround': st.setTool('ringAround'); break;
        case 'mask': st.setTool('mask'); break;
        case 'view1': case 'view2': case 'view3': case 'view4': st.setView(views[a]); break;
        case 'fit': st.zoomPreset('fit'); break;
        case 'oneToOne': st.zoomPreset(st.s.viewport.fit ? 1 : 'fit'); break;
        case 'zoomIn': st.zoomAt(1.25, st.s.canvas.w / st.s.canvas.dpr / 2, st.s.canvas.h / st.s.canvas.dpr / 2); break;
        case 'zoomOut': st.zoomAt(0.8, st.s.canvas.w / st.s.canvas.dpr / 2, st.s.canvas.h / st.s.canvas.dpr / 2); break;
        case 'escape':
          if (st.gesture.isActive) st.gesture.cancel();
          else if (st.s.tool) st.setTool(null);
          break;
        case 'help': help(); break;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [st, help]);
}

export function App(): ReactElement {
  const st = useStudio();
  const [help, setHelp] = useState(false);
  useShortcuts(st, () => setHelp((h) => !h));
  return (
    <div id="studio">
      <TopBar onHelp={() => setHelp(true)} />
      <aside className="st-left">
        <LibraryPanel />
        <section className="sec"><PendingCards /></section>
        <section className="sec"><div className="h"><b>History</b></div><HistoryList /></section>
        <section className="sec"><div className="h"><b>Snapshots</b></div><Snapshots /></section>
        <section className="sec"><div className="h"><b>Provenance</b><span className="tag">why</span></div><WhyPanel /></section>
      </aside>
      <main className="st-mid">
        <ViewBar />
        <Viewer />
        <Readout />
        <FilmStrip />
      </main>
      <RightPanel />
      {help && <Help onClose={() => setHelp(false)} />}
    </div>
  );
}
