# Checks the dgz9 splits against the original files at <rev>: each segment of the original (a line range) must be one
# contiguous block of its target module, after the stated transform (dedent by k; `this` → `store` for the store
# methods that became functions; `export ` added where a name became module-visible). Every non-blank original line
# must be in some segment or listed as replaced on purpose. Prints, per new file, the lines that are not original
# text (the glue) for review. Usage: verify-split.py <rev> [store|viewport]...
import re
import subprocess
import sys

rev = sys.argv[1]
which = sys.argv[2:] or ['store', 'viewport']


def orig(path):
    return subprocess.run(['git', 'show', f'{rev}:{path}'], capture_output=True, text=True, check=True).stdout.split('\n')


def this_to_store(x):
    return re.sub(r'\bthis\b', 'store', x)


# (from, to), target file, dedent, transform, exported-name prefixes that gained `export `
SPLITS = {
    'store': {
        'src': 'packages/shell/src/core/store.ts',
        'dir': 'packages/shell/src/core',
        'segs': [
            ((1, 19), 'store.ts', 0, None),
            ((21, 21), 'store.ts', 0, None),
            ((26, 69), 'store/types.ts', 0, None),
            ((71, 109), 'store/routes.ts', 0, None),
            ((111, 122), 'store/routes.ts', 0, None),
            ((314, 331), 'store/routes.ts', 2, this_to_store),  # Store.route body → attachRoute
            ((124, 152), 'store/readonly.ts', 0, None),
            ((362, 362), 'store/readonly.ts', 2, None),  # the doc comment, also kept on the delegate
            ((365, 390), 'store/readonly.ts', 2, this_to_store),  # Store.readonly body (after `const store = this;`)
            ((154, 209), 'store/path-index.ts', 0, None),
            ((211, 247), 'store/derived.ts', 0, None),
            ((258, 266), 'store/layers.ts', 0, None),
            ((565, 615), 'store/layers.ts', 2, this_to_store),  # Store.layer body (after `const store = this;`)
            ((625, 625), 'store/snapshot.ts', 2, None),
            ((627, 655), 'store/snapshot.ts', 2, this_to_store),  # Store.snapshot body
            ((659, 773), 'store/draft.ts', 0, None),
            ((249, 256), 'store.ts', 0, None),
            ((268, 312), 'store.ts', 0, None),
            ((333, 362), 'store.ts', 0, None),
            ((392, 562), 'store.ts', 0, None),
            ((617, 625), 'store.ts', 0, None),
            ((657, 657), 'store.ts', 0, None),
            ((775, 775), 'store.ts', 0, None),
        ],
        # original lines replaced on purpose: imports (recomputed per module), the four method signatures and closing
        # braces (now delegates), and the two `const store = this;` lines
        'replaced': [22, 23, 24, 313, 332, 363, 364, 391, 563, 564, 616, 626, 656],
        'exported': ('interface Route {', 'class Derived {'),
    },
    'viewport': {
        'src': 'packages/shell/src/dom/viewport.ts',
        'dir': 'packages/shell/src/dom',
        'segs': [
            ((1, 7), 'viewport.ts', 0, None),
            ((9, 9), 'viewport.ts', 0, None),
            ((20, 22), 'viewport/state.ts', 0, None),
            ((24, 33), 'viewport/state.ts', 0, None),
            ((84, 103), 'viewport/state.ts', 0, None),  # the V literal, now returned by viewState()
            ((35, 49), 'viewport/colour.ts', 0, None),
            ((51, 81), 'viewport.ts', 0, None),
            ((105, 118), 'viewport.ts', 0, None),
            ((121, 134), 'viewport.ts', 0, None),
            ((136, 190), 'viewport/geometry.ts', 0, None),
            ((82, 82), 'viewport/pointer.ts', 0, None),
            ((207, 207), 'viewport/pointer.ts', 0, None),
            ((248, 270), 'viewport/pointer.ts', 0, None),
            ((427, 498), 'viewport/pointer.ts', 0, None),
            ((499, 661), 'viewport/pointer.ts', -2, None),  # wrapped in listenPointer()
            ((192, 206), 'viewport/paint.ts', 0, None),
            ((208, 246), 'viewport/paint.ts', 0, None),
            ((272, 386), 'viewport/render.ts', 0, None),
            ((388, 413), 'viewport/render.ts', 0, None),
            ((415, 425), 'viewport/render.ts', 0, None),
            ((662, 677), 'viewport/render.ts', -2, None),  # wrapped in listenSpring()
            ((678, 681), 'viewport.ts', 0, None),
            ((683, 683), 'viewport/thumb.ts', 0, None),
            ((685, 722), 'viewport/thumb.ts', 0, None),
        ],
        # imports (recomputed per module); `const V = {` / `};` (the literal is viewState()'s); the API's shorthand
        # `setZoom,` and `zoomBy,` (now arrows: the API is built before the geometry that defines them); the thumb's
        # `defineRenderer('thumb', (n, m) => {` / `});` (now `const mountThumb: Renderer = (n, m) => {`, registered by
        # the entry right after the viewport)
        'replaced': list(range(10, 19)) + [83, 104, 119, 120, 684, 723],
        'exported': ('type Zoom', 'type Compare', 'const DEFAULT_COLOURS'),
    },
}


def run(name, cfg):
    L = orig(cfg['src'])
    targets = sorted({s[1] for s in cfg['segs']})
    new = {t: open(f"{cfg['dir']}/{t}", encoding='utf8').read().split('\n') for t in targets}
    placed = {t: set() for t in targets}
    covered = set()
    bad = 0
    for (a, b), t, dd, tf in cfg['segs']:
        block = []
        for l in L[a - 1:b]:
            if dd > 0:
                x = l[dd:] if l.startswith(' ' * dd) else l
            elif dd < 0:
                x = ' ' * -dd + l if l.strip() else l
            else:
                x = l
            if tf:
                x = tf(x)
            if any(x.startswith(e) for e in cfg['exported']):
                x = 'export ' + x
            block.append(x)
        covered.update(range(a, b + 1))
        T = new[t]
        n = len(block)
        hits = [i for i in range(len(T) - n + 1) if T[i:i + n] == block]
        if not hits:
            bad += 1
            print(f'FAIL {name} {a}-{b} → {t}')
            continue
        placed[t].update(range(hits[0], hits[0] + n))
        how = (f'dedent {dd}' if dd > 0 else f'indent {-dd}' if dd < 0 else '') + (', this→store' if tf else '')
        print(f'ok   {name} {a}-{b} → {t}' + (f' ({how.strip(", ")})' if how else ''))
    missing = [i + 1 for i, l in enumerate(L) if (i + 1) not in covered and (i + 1) not in cfg['replaced'] and l.strip()]
    print(f'{name}: original non-blank lines in no segment and not listed as replaced: {missing}')
    if missing:
        bad += 1
    print(f'{name}: replaced on purpose: ' + '; '.join(f'{i}: {L[i - 1].strip()[:60]}' for i in cfg['replaced']))
    for t in targets:
        T = new[t]
        glue = [f'{i + 1}: {T[i]}' for i in range(len(T)) if i not in placed[t] and T[i].strip()]
        print(f'--- {t} glue ({len(glue)} of {len(T)} lines)')
        for g in glue:
            print('   ', g[:160])
    return bad


total = 0
for w in which:
    total += run(w, SPLITS[w])
print('failures:', total)
sys.exit(1 if total else 0)
