# Sources: CraftKit Studio v1

`craftkit-studio/` is the contents of `~/Downloads/craftkit-studio-v1.zip`
(sha256 `c7666aced5613a3ae03566a981945f06ced7e337e8466c2ad054fe1e83343a1e`, 18 490 036 bytes, files dated
2026-10-22), imported on 2026-11-11 for the CHB-016 study.

Left out of the import, because they duplicate files that are kept:

- `dist/` — the build output of `node build.mjs` (copies of `src/`, the wasm crates and the photos, plus the
  generated `engine.js`, `studio.bundle.js`, `app/docs.js` and `index.html`);
- `test/perf/www/` — a perf page with second copies of the three wasm crates, the photos and a built `engine.js`.

Everything else is as it came: `src/shell` (the CraftKit Shell v1), `src/app` (the Studio modules), `engine/`
(worker bridge and assembler), `vendor/wb` (the CraftKit Workbench engine, including `dist/*.wasm`), `docs/`,
`test/` and `assets/photos` (the Kodak test suite). Read-only reference material: do not edit.
