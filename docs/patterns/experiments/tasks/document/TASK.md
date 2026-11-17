# Task: the edit document of a photo editor

You are building the document model of a non-destructive photo editor. A user edits a photograph (exposure, a crop,
spot removals) in a viewer whose size changes all the time; the same edit must later be rendered as a thumbnail, on
screen and at full resolution for print, possibly on another machine. An assistant (an AI agent) can also propose
edits, which the user approves or rejects. During a slider drag the editor updates the edit dozens of times per
second, but the user expects one undo step per drag.

## The document

The serialised document (`toJSON()`) is a JSON value with `version: 2` and at least:

```ts
{
  version: 2,
  source: { id: string, width: number, height: number },  // the original photograph and its size in pixels
  exposure: number,                                        // EV, −5 … 5
  crop: null | /* your representation */,
  spots: { [id: string]: /* your representation */ },
}
```

You choose how `crop` and `spots` are represented. Earlier versions of the editor saved **version 1** documents, which
must still load:

```ts
{ version: 1, source: { id, width, height }, exposureEV: number,
  cropRect: null | { x, y, w, h },           // in pixels of the original photograph
  spots: { x: number, y: number, radius: number }[] }   // in pixels of the original photograph
```

## API (`project/src/index.ts`, ES module, TypeScript runnable with Node 24 type stripping)

```ts
export interface Mutation { path: string; value: unknown }   // value null deletes a record entry (e.g. "spots.<id>")
export interface Entry { id: string; author: string; status: 'applied' | 'pending' | 'rejected'; mutations: Mutation[] }
export interface Rect { x: number; y: number; w: number; h: number }
export interface Size { width: number; height: number }

export interface Document {
  /** Applies mutations as one undo step; returns the journal entry id. Throws (and changes nothing) on an unknown
   *  path or an invalid value. Paths you must support: "exposure", "spots.<id>" (value null only: delete). */
  apply(mutations: Mutation[], author: string): string;
  /** Records mutations as a pending proposal; the document does not change until approve(). */
  propose(mutations: Mutation[], author: string): string;
  approve(entryId: string): void;     // applies a pending entry as one undo step
  reject(entryId: string): void;      // marks it rejected; the document does not change
  undo(): boolean;                    // false when there is nothing to undo
  redo(): boolean;                    // false when there is nothing to redo
  /** Live preview (a slider drag): replaces any previous preview; not in the journal. */
  preview(mutations: Mutation[]): void;
  /** Turns the current preview into one journal entry and one undo step. */
  commitPreview(author: string): string;
  cancelPreview(): void;
  /** The committed document (no preview). */
  state(): unknown;
  /** The committed document with the current preview applied. */
  view(): unknown;
  /** Every entry ever recorded, in order, including undone, pending and rejected ones. */
  journal(): Entry[];
  toJSON(): unknown;
}

export function createDocument(source: { id: string; width: number; height: number }): Document;
export function loadDocument(json: unknown): Document;   // version 1 or 2

/** Tools: gestures arrive in pixels of the viewer, which shows the whole original photograph at `view` size. */
export function setCropFromView(doc: Document, rect: Rect, view: Size, author: string): string;
export function addSpotFromView(doc: Document, center: { x: number; y: number }, radius: number, view: Size, author: string): { entryId: string; spotId: string };

/** Geometry of a document state for a rendering of the whole original photograph at `size` (crop and spots in that rendering's pixels). */
export function geometryAt(state: unknown, size: Size): { crop: Rect | null; spots: { id: string; x: number; y: number; r: number }[] };
/** The exposure of a document state. */
export function exposureOf(state: unknown): number;
```

## Requirements

1. **Any resolution.** A crop or spot made in a viewer of one size must land on the same part of the photograph when
   rendered at any other size (thumbnail, screen, full resolution), within one pixel of the target rendering.
2. **Portable.** `toJSON()` → `JSON.stringify` → `JSON.parse` → `loadDocument` gives the same geometry and exposure.
3. **Old documents.** Version 1 documents load with the same geometry and exposure they had.
4. **Validated.** Unknown paths and invalid values are refused with an error, and the document is unchanged.
5. **Undo.** `undo` and `redo` step through applied entries; a new edit after an undo discards what could have been
   redone. Undone entries stay in the journal.
6. **Proposals.** A proposal changes nothing until approved; an approved proposal is one undo step; a rejected one
   stays in the journal as rejected. Every entry records its author.
7. **Drags.** Any number of `preview` calls followed by `commitPreview` adds exactly one journal entry and one undo
   step; `state()` does not show the preview, `view()` does.

## Deliverables

The working rules in your instructions apply: the project lives in `project/`, the API module is
`project/src/index.ts`.
