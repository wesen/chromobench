// History panel (guide §5.8): pending agent changes first (Approve / Reject / Approve all; E_STALE
// offers "Apply anyway"), then the applied units with the undo cursor, rejected entries struck
// through, snapshots, and the why(path) provenance of the focused control.
import type { ReactElement } from 'react';
import { historyGroups, lookupFor, moveCursor, pendingGroups, rejectedEntries, whyRows, WHO } from '../core/history.ts';
import { useLogVersion, useStudio, useStudioState } from './hooks.ts';

export function PendingCards(): ReactElement {
  const st = useStudio();
  useLogVersion();
  const refused = useStudioState((s) => s.refused);
  const log = st.session?.log;
  const groups = log ? pendingGroups(log, lookupFor(st.models)) : [];
  return (
    <>
      <div className="h"><b>Waiting for you</b><span className={`tag${groups.length ? ' bad' : ''}`} id="pending-count">{groups.length}</span>
        {groups.length > 1 && <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => groups.forEach((g) => st.approve(g.seqs, g.tx))}>Approve all</button>}
      </div>
      <ul id="pending" aria-live="polite" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {groups.map((g) => {
          const bad = refused[g.tx];
          return (
            <li key={g.tx} className="ask" data-tx={g.tx}>
              <p><b>Agent</b> {g.why ? `· ${g.why}` : ''}</p>
              {g.changes.map((c) => <code key={c.seq}>{c.text}</code>)}
              {bad && <p className="small" role="alert" style={{ color: 'var(--accent)' }}>{bad.map((d) => `${d.code}: ${d.message}`).join('; ')}</p>}
              <div className="row">
                <button className="btn sm primary approve" onClick={() => st.approve(g.seqs, g.tx)}>Approve</button>
                <button className="btn sm reject" onClick={() => st.reject(g.seqs, g.tx)}>Reject</button>
                {bad?.some((d) => d.code === 'E_STALE') && <button className="btn sm danger force" onClick={() => st.approve(g.seqs, g.tx, true)}>Apply anyway</button>}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

export function HistoryList(): ReactElement {
  const st = useStudio();
  useLogVersion();
  const log = st.session?.log;
  if (!log) return <p className="empty">No frame open.</p>;
  const lookup = lookupFor(st.models);
  const groups = historyGroups(log, lookup);
  const rejected = rejectedEntries(log, lookup);
  const time = (ts: number): string => new Date(ts).toTimeString().slice(0, 5);
  return (
    <div id="history" role="list">
      <button role="listitem" className={`hist-it link${log.cursor === 0 ? ' cur' : ''}`} onClick={() => moveCursor(log, 0)}>
        <span className="by">Auto</span><span>opened · default recipe</span>
      </button>
      {groups.map((g) => (
        <button role="listitem" key={`${g.tx}-${g.index}`} data-tx={g.tx} title={g.changes.map((c) => c.text).join('\n')}
          className={`hist-it link${g.index + 1 === log.cursor ? ' cur' : ''}${g.inEffect ? '' : ' undone'}${g.by === 'agent' ? ' agent' : ''}`}
          onClick={() => moveCursor(log, g.index + 1)}>
          <span className="by">{WHO[g.by]}</span>
          <span>{g.changes.length === 1 ? g.changes[0]!.text : `${g.label} · ${g.changes.length} changes`}{g.approved ? ' · approved' : ''}</span>
          <span className="sp" /><span className="mut">{time(g.ts)}</span>
        </button>
      ))}
      {rejected.map((r) => (
        <div key={r.seq} className="hist-it undone agent" title={`rejected (tx ${r.tx})`}><span className="by">Agent</span><span>{r.text} · rejected</span></div>
      ))}
    </div>
  );
}

export function Snapshots(): ReactElement {
  const st = useStudio();
  useLogVersion();
  const compare = useStudioState((s) => s.compare);
  const split = useStudioState((s) => s.split);
  const snaps = st.session?.snapshots ?? [];
  return (
    <div id="snapshots">
      {snaps.length === 0 && <p className="empty">No snapshots. Press <kbd>s</kbd> to take one.</p>}
      {snaps.map((s) => (
        <div className="hist-it" key={s.id} data-snapshot={s.name}>
          <span className="by"><b>{s.name}</b></span>
          <span className="mut">{s.stateHash.slice(0, 8)}</span>
          <span className="sp" />
          <button className={`btn sm${compare === s.id && split !== null ? ' primary' : ''}`} onClick={() => { st.setCompare(s.id); if (split === null) st.setSplit(0.5); }}>Compare</button>
          <button className="btn sm restore" onClick={() => st.restore(s.id)}>Restore</button>
          <button className="btn sm" aria-label={`Delete snapshot ${s.name}`} onClick={() => void st.deleteSnapshot(s.id)}>×</button>
        </div>
      ))}
      <button className="btn sm" disabled={!st.session} onClick={() => void st.snapshot()}>Snapshot</button>
    </div>
  );
}

export function WhyPanel(): ReactElement {
  const st = useStudio();
  useLogVersion();
  const path = useStudioState((s) => s.focusPath);
  const log = st.session?.log;
  if (!log) return <pre className="why" id="why" />;
  const w = whyRows(log, path, lookupFor(st.models));
  const text = [`${w.title}   ${path}`, ...w.rows.map((r) => `  ${r.when.padEnd(8)} ${r.who.padEnd(6)} ${r.text.padEnd(30)} ${r.note}`), `  now      ${w.now}`].join('\n');
  return <pre className="why" id="why" aria-label="provenance">{text}</pre>;
}
