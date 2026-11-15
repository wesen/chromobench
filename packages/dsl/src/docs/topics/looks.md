# Looks

## Looks are links

`cb.looks` is the library of named looks: registered look functions such as `warm-print`, `soft-contrast` or `crisp-warm`, some with parameters, and the photographer's presets (looks without parameters). A look is not a list of edits: on a frame it is a **link** — one entry per stage it touches — that the compiler expands into ordinary layers (filters, a preflash, density masks, burns in the darkroom; clarity on the print). The photographer can fade it, mask it, switch it off, bake it into plain layers or remove it as one unit.

```js
return cb.looks.list().map((l) => ({ name: l.name, label: l.label, kind: l.kind, params: Object.keys(l.params).join(', ') }))
```

## Try a look without changing anything

`cb.looks.whatIf(frame, name, params, { amount })` is a what-if: a view of the document with the look's link, whose cuts you can measure or show; `diff` lists the layers the look gives this frame. `amount` is the stage's own fade, 0 to 2: in the darkroom it scales the look's light and density (0.5 = half the filter, half the burn), on the print it is opacity (at most 1).

```js
const v = cb.looks.whatIf(frame, 'warm print', { warmth: 6 }, { amount: 0.5 })
const d = await v.print().measure.densitometer({ at: [48, 32] })
return { layers: v.diff, D: d.D }
```

Compare a frame with a what-if, or two frames:

```js
return cb.looks.diff(frame, cb.looks.whatIf(frame, 'soft contrast'))
```

## Apply a look

`cb.looks.apply(name, params, { amount, to, where, why })` proposes the look's link on every target frame as one batch: the photographer approves or rejects it on one card, and one undo takes it back. Applying a look a frame already has adjusts its parameters and amount. `to` is the bound frame by default, a frame id, an array of ids or `'all'`; `where` filters the frames, for example the ones nobody has edited yet.

```js
return cb.looks.apply('warm print', { warmth: 4 }, { amount: 0.6, to: 'all', where: (x) => x.unedited, why: 'warm print at 60 % on the unedited frames' })
```

`cb.looks.bake(link)` turns the frame's link into the plain groups it expands to (its source records the look); the receipt of `apply` names the link (`warm-print1`). Parameters are checked like op arguments:

```js error=E_ARG_RANGE
cb.looks.apply('warm print', { warmth: 12 })
```
