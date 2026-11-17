# Task: a render scheduler for an interactive image viewer

You are building the part of an image editor that decides which renders run and which results reach the screen. The
user drags sliders and pans; the editor asks for a new render of the main viewer on every pointer event (every
~16 ms), and renders take anywhere from 5 ms to several seconds depending on the engine. Thumbnails in a filmstrip are
rendered in the background. Renders are asynchronous and can be cancelled through an `AbortSignal`.

## API (`project/src/index.ts`, ES module, TypeScript runnable with Node 24 type stripping)

```ts
export type Pass = 'draft' | 'screen' | 'refine';
export type Lane = 'live' | 'background';

export interface RenderJob {
  slot: string;          // which display place: "main", "before", "thumb:42", …
  key: string;           // what to render: equal keys mean interchangeable results
  pass: Pass;
  generation: number;    // the number request() returned for this job
  signal: AbortSignal;   // aborted when the scheduler no longer wants the result
}

export interface SchedulerOptions<R> {
  /** Starts a render; may reject (a failure) or reject after its signal aborts (an abort). */
  render(job: RenderJob): Promise<R>;
  /** Shows a result in its slot. */
  present(slot: string, result: R, info: { generation: number; key: string; pass: Pass }): void;
  /** Called exactly once for every result that is not shown, or that a newer shown result replaces. Optional. */
  release?(result: R): void;
  /** Called for render failures (not for aborts). Optional. */
  onError?(slot: string, error: unknown): void;
  /** See requirement 5; 0 or absent disables it. */
  progressMs?: number;
  /** The clock in milliseconds (tests replace it); default performance.now(). */
  now?(): number;
}

export interface Scheduler {
  /** Asks for a render; returns its generation (strictly increasing per slot). */
  request(slot: string, key: string, opts: { pass: Pass; lane?: Lane }): number;
  /** The slot's view went away: drop waiting work, abort running work, release what will not be shown. */
  close(slot: string): void;
  /** Resolves when no slot has running or waiting work. */
  idle(): Promise<void>;
}

export function createScheduler<R>(opts: SchedulerOptions<R>): Scheduler;
```

## Requirements

1. **Never backwards.** For one slot, a result must never be presented after the result of a newer request has been
   presented.
2. **Bounded work.** At most one render runs per slot at any time. Requests arriving while a render runs must not
   pile up: when the running render ends, only the newest request for that slot may start.
3. **Cancel superseded work.** When a newer request for a slot makes a running render useless, abort it through its
   signal (subject to requirement 5).
4. **Live before background.** A background-lane render must not start while any live-lane slot has running or
   waiting work; it starts when live work is done. Different live slots render independently of each other.
5. **Progress.** With slow renders and continuous draft requests, the viewer must still show something: if a slot has
   presented nothing for at least `progressMs` milliseconds, a newer *draft* request must not abort the running
   render; that render completes and is presented, then the newest request runs. A newer `screen` or `refine`
   request (the user stopped) aborts as usual.
6. **No duplicate work.** A request whose key and pass equal those of the render already running for the slot must not
   start a second render of the same thing; the running render's result serves the newer request.
7. **Failures do not wedge.** A failing render is reported through `onError`; later requests for the slot render
   normally. An aborted render is not reported as a failure.
8. **No leaks.** Every result that is not presented (stale, aborted but still resolved, closed slot) is released, and a
   presented result is released when a newer result replaces it in its slot.

## Deliverables

The working rules in your instructions apply: the project lives in `project/`, the API module is
`project/src/index.ts`.
