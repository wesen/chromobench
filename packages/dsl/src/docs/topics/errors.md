# Errors

Every error has a `code`, a `message`, the line it happened on, and usually a `hint` and a literal `fix` you can paste. Apply the fix.

## Misspellings

```js error=E_UNKNOWN_METHOD
return frame.negative().pirnt({ time_s: 12 })
```

```js error=E_UNKNOWN_OPTION
return frame.print({ time: 12 })
```

## Options are literal values

Await a measurement and pass the number:

```js error=E_ARG_TYPE
const p = frame.print()
return frame.print({ time_s: p.measure.stats() })
```

## No network, files or timers

```js error=E_SANDBOX
return fetch('https://example.com')
```

```js fragment
await new Promise((r) => setTimeout(r, 500))   // ReferenceError: there are no timers
```

## Soft ranges warn

Values outside the usual range work, with a `RANGE` warning:

```js warns=RANGE
return (await frame.print({ time_s: 500 }).measure.densitometer({ at: [48, 32] })).visual
```

## Getting help

```js
return cb.help('print.expose')
```

```js
return cb.docs.search('test strip')
```
