// Assemble the engine worker bundle from the Workbench's engine files, with the small patches the shell needs.
import fs from 'node:fs';
import path from 'node:path';

// the CraftKit Workbench's engine files: vendored next to the Studio in the zip, or the Workbench checkout beside it
const WB = fs.existsSync(path.resolve(import.meta.dirname, '../vendor/wb')) ? path.resolve(import.meta.dirname, '../vendor/wb') : path.resolve(import.meta.dirname, '../../wb');
const FILES = ['ck-filters.js', 'ck-catalog.js', 'ck-runtime.js', 'ck-engine.js', 'ck-ops-image.js', 'ck-ops-vector.js', 'ck-ops-more.js', 'ck-present.js', 'ck-gpu.js'];

// each patch must apply exactly once, or the build stops: the engine moved and the patch needs a look
const PATCHES = {
  'ck-runtime.js': [
    // ck.ui.input(name, value): an engine input the shell fills from state on every render
    ["      develop: o => mkControl('develop', { value: o, label: 'develop' }),",
     "      develop: o => mkControl('develop', { value: o, label: 'develop' }),\n      input: (name, value) => mkControl('input', { label: String(name), value }),"],
    // ck.image(src, { max }) where src and max may be inputs
    ["      image: s => source('source.image', 'image', { src: String(s) }),",
     "      image: (s, o) => source('source.image', 'image', Object.assign({ src: s && s[META] ? s : String(s) }, o || {})),"],
  ],
  'ck-engine.js': [
    // fix: a stack layer is { $ref, opacity, visible, blend, … }; the signature kept only the $ref, so a layer option
    // read from an input (opacity, visible) changed the picture once and then the cache served the old one
    ["          if (v.$ref) return { $r: sigOf(v.$ref, env, memo) };",
     "          if (v.$ref) return Object.keys(v).length === 1 ? { $r: sigOf(v.$ref, env, memo) } : Object.assign({}, v, { $ref: undefined, $r: sigOf(v.$ref, env, memo) });"],
  ],
  'ck-ops-more.js': [
    // fix: settings at the top level that are not objects (treatment: 'bw', spots, masks, disabled_sections, …)
    // were dropped on the way to LightCraft, so B&W, spot removal, masks and panel switches never reached the pixels
    ["const path = (MAP[k] || k).split('.'); if (path.length < 2) continue;",
     "const path = (MAP[k] || k).split('.'); if (path.length < 2) { if (k !== 'amount') tree[k] = v; continue; }"],
  ],
  'ck-ops-image.js': [
    // load the source at the size the view asks for (a screen-sized proxy while dragging, more on commit)
    ["  def('source.image', async (n, I, P) => E.loadAsset(P.src));",
     "  def('source.image', async (n, I, P) => E.loadAsset(P.src, P.max ? Math.max(64, Math.min(4096, +P.max)) : undefined));"],
  ],
};

export function assembleEngine() {
  const parts = [];
  for (const f of FILES) {
    let src = fs.readFileSync(path.join(WB, f), 'utf8');
    for (const [from, to] of PATCHES[f] || []) {
      const n = src.split(from).length - 1;
      if (n !== 1) throw new Error(`engine patch for ${f} matched ${n} times: ${from.slice(0, 60)}`);
      src = src.replace(from, to);
    }
    parts.push(`/* ── ${f} ── */\n` + src);
  }
  parts.push(fs.readFileSync(path.join(import.meta.dirname, 'studio-worker.js'), 'utf8'));
  return parts.join('\n;\n');
}

export const WASM = ['ck_light.wasm', 'ck_photo.wasm', 'ck_vector.wasm'].map(f => path.join(WB, 'dist', f));
export const OPENTYPE = path.join(WB, 'dist', 'opentype.min.js');
