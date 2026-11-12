# Looks

## Looks are the studio's presets

`cb.looks` is the photographer's library of looks: named treatments such as "warm print" or "grade 3", some with parameters. A look resolves, per frame, to ordinary recipe changes. Applying one proposes those changes like `frame.edit` does; nothing is stored symbolically.

```js
return cb.looks.list().map((l) => ({ name: l.name, group: l.group, params: Object.keys(l.params).join(', ') }))
```

## Try a look without changing anything

`cb.looks.whatIf(frame, name, params, { amount })` is a what-if: its `print()` is a handle you can measure or look at, and `diff` says what would change, in darkroom units. `amount` is 0 to 2 (1 = the look as made, 0.5 = half way).

```js
const v = cb.looks.whatIf(frame, 'warm print', { warmth: 6 }, { amount: 0.5 })
const d = await v.print().measure.densitometer({ at: [48, 32] })
return { diff: v.diff, D: d.D }
```

Compare a frame with a what-if, or two frames:

```js
return cb.looks.diff(frame, cb.looks.whatIf(frame, 'grade 3'))
```

## Apply a look

`cb.looks.apply(name, params, { amount, to, where, why })` proposes the look on every target frame as one batch. The photographer approves it on one card (and may untick frames). `to` is the bound frame by default, a frame id, an array of ids, `'all'`, or `{ roll: id }`; `where` filters the frames, for example the ones nobody has edited yet.

```js
return cb.looks.apply('warm print', { warmth: 4 }, { amount: 0.6, to: 'all', where: (x) => x.unedited, why: 'warm print at 60 % on the unedited frames' })
```

A look that does not fit a frame (a film look on a scanned negative) skips it and says why. Parameters are checked like op arguments:

```js error=E_ARG_RANGE
cb.looks.apply('warm print', { warmth: 12 })
```
