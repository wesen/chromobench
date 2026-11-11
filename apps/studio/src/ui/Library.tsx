// Library panel and film strip (guide §5.5): projects, rolls, folder access with the
// session/import fallback, reconnect after reload, and the film strip of the current roll.
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { fromFileList, hasDirectoryPicker, listScans, pickDirectory, type PickedFile } from '../storage/fsa.ts';
import { useStore, useStudio, useStudioState } from './hooks.ts';

const mb = (n: number): string => `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB`;

export function OpenFilesButton(): ReactElement {
  const st = useStudio();
  return (
    <label className="btn">Open files…
      <input id="file" type="file" multiple accept=".tif,.tiff,.dng,.png,.jpg,.jpeg,image/tiff"
        onChange={(e) => {
          const files = fromFileList(e.target.files ?? []);
          e.target.value = '';
          void st.addFiles(files, files.length === 1 ? files[0]!.name : `Session ${new Date().toLocaleDateString()}`, 'session');
        }} />
    </label>
  );
}

export function LibraryPanel(): ReactElement {
  const st = useStudio();
  const lib = useStore(st.library.state, (s) => s);
  const [pending, setPending] = useState<{ files: PickedFile[]; name: string } | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const [usage, setUsage] = useState('');
  useEffect(() => {
    void st.opfs?.usage().then((u) => setUsage(`${mb(u.imports)} imported · ${mb(u.cache)} cache${u.quota ? ` · quota ${mb(u.quota)}` : ''}`));
  }, [st, lib.frames.length]);
  const rolls = lib.rolls.filter((r) => r.projectId === lib.currentProject);

  const addFolder = async (): Promise<void> => {
    try {
      const dir = await pickDirectory();
      await st.addFiles(await listScans(dir), dir.name, 'session', dir);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') st.report(e);
    }
  };

  return (
    <section className="sec" id="library">
      <div className="h"><b>Library</b><span className="tag">{lib.frames.length} frames</span></div>
      <div className="sel-row">
        <label htmlFor="project">Project</label>
        <select id="project" value={lib.currentProject ?? ''} onChange={(e) => st.library.selectProject(e.target.value)}>
          {lib.projects.length === 0 && <option value="">—</option>}
          {lib.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button className="btn sm" onClick={() => setNewName('')}>New</button>
      </div>
      {newName !== null && (
        <form className="sel-row" onSubmit={(e) => { e.preventDefault(); if (newName.trim()) void st.library.createProject(newName.trim()); setNewName(null); }}>
          <input aria-label="Project name" autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} style={{ flex: 1 }} />
          <button className="btn sm primary" type="submit">Create</button>
        </form>
      )}
      <div className="row-btns">
        {hasDirectoryPicker() && <button className="btn sm" onClick={() => void addFolder()}>Add folder…</button>}
        <label className="btn sm">{hasDirectoryPicker() ? 'Folder (fallback)…' : 'Add folder…'}
          <input id="folder" type="file" multiple {...{ webkitdirectory: '' }}
            onChange={(e) => {
              const files = fromFileList(e.target.files ?? []);
              e.target.value = '';
              const name = files[0]?.relPath.split('/')[0] ?? 'Folder';
              setPending({ files, name });
            }} />
        </label>
      </div>
      {pending && (
        <div className="ask" role="dialog" aria-label="Use or import" style={{ borderColor: 'var(--ink)' }}>
          <p><b>{pending.name}</b>: {pending.files.length} scans, {mb(pending.files.reduce((s, f) => s + f.size, 0))}</p>
          <p className="small mut">This browser cannot keep a link to the folder. Use the files for this session (pick them again after a reload), or copy them into Chromobench's private storage.</p>
          <div className="row">
            <button className="btn sm primary" onClick={() => { void st.addFiles(pending.files, pending.name, 'session'); setPending(null); }}>Use for this session</button>
            <button className="btn sm" id="import" onClick={() => { void st.addFiles(pending.files, pending.name, 'import'); setPending(null); }}>Import ({mb(pending.files.reduce((s, f) => s + f.size, 0))})</button>
            <button className="btn sm" onClick={() => setPending(null)}>Cancel</button>
          </div>
        </div>
      )}
      <div role="list" aria-label="Rolls">
        {rolls.map((r) => (
          <div role="listitem" key={r.id} className={`hist-it${r.id === lib.currentRoll ? ' cur' : ''}`} data-roll={r.name}>
            <button className="link" onClick={() => st.library.selectRoll(r.id)}>{r.name}</button>
            <span className="mut">{r.source}</span>
            <span className="sp" />
            {!lib.connected[r.id] && (r.source === 'folder'
              ? <button className="btn sm danger" onClick={() => void st.library.reconnectRoll(r.id)}>Reconnect</button>
              : <span className="small" style={{ color: 'var(--accent)' }}>disconnected</span>)}
          </div>
        ))}
      </div>
      {usage && <p className="small mut" id="storage-usage">{usage}</p>}
    </section>
  );
}

export function FilmStrip(): ReactElement {
  const st = useStudio();
  const lib = useStore(st.library.state, (s) => s);
  const thumbs = useStore(st.thumbs, (t) => t);
  const current = useStudioState((s) => s.frameKey);
  const ref = useRef<HTMLDivElement>(null);
  const frames = st.library.framesOf(lib.currentRoll);
  const connected = lib.currentRoll ? lib.connected[lib.currentRoll] : false;
  const idx = frames.findIndex((f) => f.key === current);
  const go = (i: number): void => {
    const f = frames[i];
    if (f) void st.openFrame(f.key);
  };
  return (
    <div className="strip" ref={ref} role="listbox" aria-label="Film strip" tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') { e.preventDefault(); go(Math.min(frames.length - 1, idx + 1)); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); go(Math.max(0, idx - 1)); }
      }}>
      {frames.length === 0 && <span className="mut small">No roll open. Open files or add a folder.</span>}
      {frames.map((f, i) => (
        <button key={f.key} role="option" aria-selected={f.key === current} tabIndex={-1} className={`cell${f.key === current ? ' on' : ''}`} onClick={() => go(i)} title={f.relPath} data-frame={f.name}>
          {thumbs[f.sha256] ? <img src={thumbs[f.sha256]} alt="" /> : <span className="ph" />}
          <span className="n">{String(i + 1).padStart(2, '0')} {f.name}</span>
          <span className="badges">
            {f.badges.edited && <span title="edited">●</span>}
            {f.badges.pending > 0 && <span className="pend" title={`${f.badges.pending} agent changes waiting`}>◆{f.badges.pending}</span>}
          </span>
        </button>
      ))}
      <span className="sp" />
      {frames.length > 0 && !connected && <span className="small" style={{ color: 'var(--accent)' }}>disconnected · pick the files again</span>}
    </div>
  );
}
