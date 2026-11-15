// The workbench (CHB-035 design §34; CHB-037 P6b): what the agent's `wb` reaches of the studio. The studio is a client
// of the same core the agent uses, so the surface is thin: the command table (every command a key, a menu or a
// button runs, with its arguments, keys and enabled/why), running a command as the agent, writing a state path as a
// bound control does, reading state through the typed selectors, the screen (the mounted layout with live values and
// what each control writes), and layouts written in the sandbox: recorded there as data, built and checked by the
// passes on the page, proposed to the photographer.
//
// The host implements Workbench (studio-kit's chat kit: `studioWorkbench(rt, …)`); every answer is plain data, so it
// crosses the worker boundary and the sandbox unchanged. Every method may answer synchronously or with a promise: in
// the sandbox every `wb` call is awaited, like a measurement.
import type { LogEntry } from '@chromobench/values';

/** One command: what the photographer sees of it, and how the UI runs it. */
export interface WbCommand {
  id: string;
  label: string;
  group?: string;
  source?: string;
  doc?: string;
  /** the menu that places it ("File", "Layer ▸ Add") */
  menu?: string;
  /** keys that run it, with the arguments they pass (`['frame.rate', 3]` → args [3]) */
  keys: { chord: string; scope: string; args?: unknown[] }[];
  /** its arguments, by name */
  args: string[];
  enabled: boolean;
  why?: string;
  hidden: boolean;
  checked?: boolean;
  builtin: boolean;
}

/** One control on screen: what it writes (a document path, a state path or a command) and what it shows now. */
export interface WbControl {
  module: string | null;
  panel: string | null;
  form: string;
  label?: string;
  /** a document path of a frame (`main.params.time_s`): the agent writes it with frame.propose(set(path, v)) */
  path?: string;
  /** the frame whose document `path` belongs to */
  frame?: string;
  /** a state path (`view.view`, `finish.spot.r`): the agent writes it with wb.set(path, v) */
  state?: string;
  /** a command: the agent runs it with wb.run(command, ...args) */
  command?: string;
  args?: unknown[];
  value?: unknown;
}

/** What wb.run and wb.set did. */
export interface WbRun {
  ok: boolean;
  /** the command's own return value, as data */
  result?: unknown;
  /** why it did not run (disabled, unknown, read-only, refused) */
  why?: string;
  /** the log entries it made (pending in ask mode, applied in auto mode) */
  entries: LogEntry[];
  /** what became of its document edits */
  how: 'committed' | 'proposed' | 'refused' | 'none';
  /** the module and the selection after it ran */
  module: string | null;
  frame: string | null;
}

export interface WbSelector {
  name: string;
  /** its arguments after the state */
  args: string[];
}

/** The screen: the layout, the module on screen, its live explain, and its controls. */
export interface WbScreen {
  layout: { id: string; label: string; agent: boolean };
  module: string | null;
  modules: { id: string; label: string }[];
  frame: string | null;
  tool: string | null;
  /** the module's explain with live values (Runtime.explain({ live, module })) */
  text: string;
  controls: WbControl[];
}

/** A layout written in the sandbox: its recorded build (data) and its name. */
export interface WbLayoutData {
  kind: 'layout';
  id: string;
  label: string;
  description?: string;
  enlarger?: 'real' | 'normalised';
  /** the recorded `build(ck, cb, env)`: a tree of builder paths and arguments (see prelude: the recorder) */
  tree: unknown;
}

export interface WbDiagnostic {
  level: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  fix?: string;
}

/** A layout built on the page: the passes' verdict, its explain and its controls. */
export interface WbBuild {
  ok: boolean;
  layout: WbLayoutData;
  errors: WbDiagnostic[];
  warnings: WbDiagnostic[];
  /** the built program's explain (modules, regions, commands) */
  explain: string;
  controls: WbControl[];
}

export interface WbUse {
  status: 'proposed' | 'refused';
  id: string;
  label: string;
  note: string;
}

/** Who asks: the eval (provenance) and the agent's reason. */
export interface WbActor {
  eval: string;
  why?: string;
}

/** The studio as the agent's workbench sees it. */
export interface Workbench {
  commands(): WbCommand[] | Promise<WbCommand[]>;
  run(id: string, args: readonly unknown[], o: WbActor): WbRun | Promise<WbRun>;
  /** writes a state path as a bound control does (the view tier directly; a document-tier path as the agent's transaction) */
  set(path: string, value: unknown, o: WbActor): WbRun | Promise<WbRun>;
  selectors(): WbSelector[] | Promise<WbSelector[]>;
  state(name: string, args: readonly unknown[]): unknown;
  screen(o: { module?: string }): WbScreen | Promise<WbScreen>;
  /** the layout on screen and the layouts the studio can switch to */
  layouts(): { current: { id: string; label: string; agent: boolean }; available: { id: string; label: string }[] } | Promise<{ current: { id: string; label: string; agent: boolean }; available: { id: string; label: string }[] }>;
  build(layout: WbLayoutData): WbBuild | Promise<WbBuild>;
  /** proposes the layout to the photographer (it is mounted when they approve) */
  use(layout: WbLayoutData, o: WbActor): WbUse | Promise<WbUse>;
  /** registers an agent-written look (a .cblook.js source) where the studio compiles */
  defineLook?(src: string): { name: string; version: number; label: string } | Promise<{ name: string; version: number; label: string }>;
}

/** The workbench methods the sandbox reaches through deferred host calls. */
export const WB_METHODS = ['commands', 'run', 'set', 'selectors', 'state', 'screen', 'layouts', 'build', 'use', 'defineLook'] as const;
export type WbMethod = (typeof WB_METHODS)[number];
