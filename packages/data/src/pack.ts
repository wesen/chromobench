// The loader (guide §8): opens a pack, verifies every file's SHA-256 on first read, checks the grid
// and schema, applies the missing-data policy and hands out typed, unit-labelled arrays.
//
// Every accessor exists twice: `x()` is async and fetches what it needs; `xSync()` works once the
// files are in memory (after `await pack.preload()`, or always on a synchronous source such as the
// file system). Both share one decoding path.
import { diag, fail, type Diagnostic } from '@chromobench/contract';
import { sha256Hex } from './hash.ts';
import { GRID, validateManifest, type ManifestFile, type ManifestItem, type PackManifest, type Role } from './manifest.ts';
import { densitySpectrum, linearSensitivity, MISSING_POLICIES, zeroWhereMissing, type MissingPolicy, type Spectrum81 } from './missing.ts';
import type { DataSource } from './sources.ts';
import { column, parseSafetensors, type SafeTensors, type Tensor } from './tensors.ts';

export type Triple<T> = [T, T, T];

export interface CurveModel {
  kind: 'cdfs';
  /** [channel C,M,Y][sublayer] */
  centers: number[][];
  amplitudes: number[][];
  sigmas: number[][];
}

export interface StockData {
  id: string;
  name: string;
  role: Role;
  type: 'negative' | 'positive';
  support: 'film' | 'paper';
  stage: 'filming' | 'printing';
  use: 'still' | 'cine';
  antihalation?: 'strong' | 'weak' | 'no';
  channelModel: 'color' | 'bw';
  densitometer?: 'status_M' | 'status_A';
  referenceIlluminant?: string;
  viewingIlluminant?: string;
  targetPrint?: string | null;
  sensitivityDensityOverMin_D?: number;
  /** Info fields the source lacked and the loader filled from upstream's ProfileInfo defaults or the role. */
  infoDefaulted: string[];
  /** R, G, B layers; missing → valid 0 (zero sensitivity). */
  log10Sensitivity: Triple<Spectrum81>;
  /** 10^log10Sensitivity with missing → 0. */
  sensitivity: Triple<Spectrum81>;
  /** C, M, Y unit dye spectra under the policy. */
  unitDyes_D: Triple<Spectrum81>;
  base_D: Spectrum81;
  midscaleNeutral_D?: Spectrum81;
  /** 256 samples, −3 … 4 (grey card = 0). */
  logExposure_logH: Float64Array;
  /** Dye amounts as stored: curve minima NOT subtracted (the film develop op owns that). */
  dyeCurves: Triple<Float64Array>;
  /** 256 × 3 × 3 flattened, [logH][sublayer][channel]. */
  sublayerCurves?: Float64Array;
  curveModel?: CurveModel;
  hanatosWindow?: { c_uv_nm: number; sigma_uv_nm: number; c_ir_nm: number; sigma_ir_nm: number };
  hanatosSurface?: number[][];
  missing: MissingPolicy;
  contentHash: string;
  knownIssues: string[];
  attribution: string;
  packId: string;
  /** Tensors exactly as stored (NaN kept), for round-trip checks and adapters. */
  raw: Record<string, Tensor>;
}

export interface DirPreset {
  /** Donor rows R, G, B; receiver columns. */
  matrix: number[][];
  amount: number;
  diffusionSize_um: number;
  diffusionTail_um: number;
  diffusionTailWeight: number;
  source: string;
  upstream: Record<string, unknown>;
}

export interface HalationPreset {
  sigmaH_um: Triple<number>;
  strength: Triple<number>;
  bounces: number;
  bounceDecay: number;
  scatterCore_um: Triple<number>;
  scatterTail_um: Triple<number>;
  scatterTailWeight: Triple<number>;
}

export interface CameraData {
  id: string;
  /** R, G, B responsivities; valid 0 outside the measured range (zero there). */
  responsivity: Triple<Spectrum81>;
  illustrative: boolean;
  measuredRange_nm: [number, number] | null;
  about: string;
  contentHash: string;
}

export interface LightData {
  id: string;
  spd: Spectrum81;
  illustrative: boolean;
  about: string;
  contentHash: string;
}

export interface OpenOptions {
  /** Called for every warning (also collected in pack.warnings). */
  onWarning?: (d: Diagnostic) => void;
}

const ROLE_FILTERS = ['film', 'print'] as const;
const PROFILE_DEFAULTS = {
  type: 'negative', use: 'still', antihalation: 'weak', channel_model: 'color', densitometer: 'status_M',
  log_sensitivity_density_over_min: 0.2, reference_illuminant: 'D55', viewing_illuminant: 'D50',
} as const;

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length]![b.length]!;
}

/** Known ids ordered by edit distance to `id` (did-you-mean). */
export function closest(id: string, known: readonly string[], n = 5): string[] {
  return [...known].sort((x, y) => editDistance(id, x) - editDistance(id, y) || x.localeCompare(y)).slice(0, n);
}

const triple = <T>(f: (k: number) => T): Triple<T> => [f(0), f(1), f(2)];

export class Pack {
  readonly manifest: PackManifest;
  readonly packId: string;
  /** "sha256:<hex>" of manifest.json as read. */
  readonly packHash: string;
  readonly warnings: Diagnostic[] = [];
  private readonly src: DataSource;
  private readonly opts: OpenOptions;
  private readonly fileIndex = new Map<string, ManifestFile>();
  private readonly bytesCache = new Map<string, Uint8Array>();
  private readonly stCache = new Map<string, SafeTensors>();
  private readonly jsonCache = new Map<string, unknown>();
  private readonly stockCache = new Map<string, StockData>();
  private readonly warned = new Set<string>();

  private constructor(src: DataSource, manifest: PackManifest, packHash: string, opts: OpenOptions) {
    this.src = src;
    this.manifest = manifest;
    this.packId = manifest.packId;
    this.packHash = packHash;
    this.opts = opts;
    for (const f of manifest.files) this.fileIndex.set(f.path, f);
  }

  private static fromManifestBytes(src: DataSource, packId: string, bytes: Uint8Array, opts: OpenOptions): Pack {
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
      return fail('E_DATA_SCHEMA', `${packId}/manifest.json is not JSON (${(e as Error).message})`);
    }
    const m = validateManifest(json, `${packId}/manifest.json`);
    if (m.packId !== packId) fail('E_DATA_SCHEMA', `pack directory ${packId} holds manifest for ${m.packId}`);
    return new Pack(src, m, `sha256:${sha256Hex(bytes)}`, opts);
  }

  static async open(src: DataSource, packId: string, opts: OpenOptions = {}): Promise<Pack> {
    return Pack.fromManifestBytes(src, packId, await src.read(`${packId}/manifest.json`), opts);
  }

  static openSync(src: DataSource, packId: string, opts: OpenOptions = {}): Pack {
    if (!src.readSync) fail('E_DATA_SCHEMA', 'openSync needs a synchronous DataSource (file system or memory)');
    return Pack.fromManifestBytes(src, packId, src.readSync(`${packId}/manifest.json`), opts);
  }

  get attribution(): string {
    return this.manifest.license.attribution;
  }

  // -- bytes, hashes, caches ------------------------------------------------------------------

  private verify(path: string, b: Uint8Array): Uint8Array {
    const f = this.fileIndex.get(path)!;
    const h = sha256Hex(b);
    if (b.length !== f.bytes || h !== f.sha256) {
      fail('E_DATA_HASH', `${this.packId}/${path}: content hash mismatch (got ${b.length} B sha256 ${h.slice(0, 12)}…, manifest says ${f.bytes} B ${f.sha256.slice(0, 12)}…)`, {
        path, hint: 'the file was modified or truncated; re-export the pack',
      });
    }
    return b;
  }

  private entry(path: string): ManifestFile {
    return this.fileIndex.get(path) ?? fail('E_DATA_SCHEMA', `${this.packId}: ${path} is not in the manifest`, { path });
  }

  private onDemandFail(path: string, e: unknown): never {
    const f = this.entry(path);
    if (f.onDemand) fail('E_DATA_SCHEMA', `${this.packId}/${path} is generated on demand and is not present`, { path, hint: f.onDemand });
    throw e;
  }

  /** Fetch and verify files into memory (idempotent). */
  async load(paths: readonly string[]): Promise<void> {
    for (const p of paths) {
      if (this.bytesCache.has(p)) continue;
      this.entry(p);
      let b: Uint8Array;
      try {
        b = await this.src.read(`${this.packId}/${p}`);
      } catch (e) {
        this.onDemandFail(p, e);
      }
      this.bytesCache.set(p, this.verify(p, b));
    }
  }

  /** Load every committed file (on-demand files only when asked). */
  async preload(o: { onDemand?: boolean } = {}): Promise<void> {
    await this.load(this.manifest.files.filter((f) => o.onDemand || !f.onDemand).map((f) => f.path));
  }

  private bytes(path: string): Uint8Array {
    const hit = this.bytesCache.get(path);
    if (hit) return hit;
    this.entry(path);
    if (!this.src.readSync) fail('E_DATA_SCHEMA', `${this.packId}/${path} is not loaded; await the async accessor or pack.preload() first`, { path });
    let b: Uint8Array;
    try {
      b = this.src.readSync(`${this.packId}/${path}`);
    } catch (e) {
      this.onDemandFail(path, e);
    }
    this.bytesCache.set(path, this.verify(path, b));
    return b;
  }

  private st(path: string): SafeTensors {
    let s = this.stCache.get(path);
    if (!s) {
      s = parseSafetensors(this.bytes(path), `${this.packId}/${path}`);
      this.stCache.set(path, s);
    }
    return s;
  }

  private json<T = any>(path: string): T {
    if (!this.jsonCache.has(path)) this.jsonCache.set(path, JSON.parse(new TextDecoder().decode(this.bytes(path))));
    return this.jsonCache.get(path) as T;
  }

  private tensor(path: string, name: string): Tensor {
    return this.st(path).tensors.get(name) ?? fail('E_DATA_SCHEMA', `${this.packId}/${path} has no tensor ${name}`);
  }

  private warn(key: string, code: Parameters<typeof diag>[0], message: string, extra: Omit<Diagnostic, 'code' | 'message'> = {}): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    const d = diag(code, message, extra);
    this.warnings.push(d);
    this.opts.onWarning?.(d);
  }

  // -- items ----------------------------------------------------------------------------------

  items(kind?: string): ManifestItem[] {
    return this.manifest.items.filter((i) => kind === undefined || i.kind === kind);
  }

  item(kind: string, id: string): ManifestItem {
    const hit = this.manifest.items.find((i) => i.kind === kind && i.id === id);
    if (hit) return hit;
    const known = this.items(kind).map((i) => i.id);
    const valid = closest(id, known);
    const code = kind === 'stock' ? 'E_STOCK_UNKNOWN' : 'E_DATA_SCHEMA';
    return fail(code, `${this.packId} has no ${kind} "${id}"`, { valid, ...(valid[0] ? { hint: `did you mean "${valid[0]}"?` } : {}) });
  }

  /** Fetch an item's files (async accessors call this first). */
  async ensure(kind: string, id: string): Promise<ManifestItem> {
    const it = this.item(kind, id);
    await this.load(it.files);
    return it;
  }

  // -- stocks ---------------------------------------------------------------------------------

  stockIds(filter: { role?: Role; type?: 'negative' | 'positive' } = {}): string[] {
    if (filter.role && !ROLE_FILTERS.includes(filter.role)) fail('E_DATA_SCHEMA', `unknown role "${filter.role}"`, { valid: [...ROLE_FILTERS] });
    return this.items('stock')
      .filter((i) => (!filter.role || i.role === filter.role) && (!filter.type || i.type === filter.type))
      .map((i) => i.id);
  }

  async stock(id: string, o: { missing?: MissingPolicy } = {}): Promise<StockData> {
    await this.ensure('stock', id);
    return this.stockSync(id, o);
  }

  stockSync(id: string, o: { missing?: MissingPolicy } = {}): StockData {
    const policy = o.missing ?? this.manifest.missing.default;
    if (!MISSING_POLICIES.includes(policy)) fail('E_DATA_POLICY', `unknown missing-data policy "${String(policy)}"`, { valid: [...MISSING_POLICIES] });
    if (!this.manifest.missing.supported.includes(policy)) {
      fail('E_DATA_POLICY', `${this.packId} supports only ${this.manifest.missing.supported.join(', ')}; "${policy}" cannot be reproduced from its source`, {
        valid: [...this.manifest.missing.supported], ...(this.manifest.missing.note ? { hint: this.manifest.missing.note } : {}),
      });
    }
    const key = `${id}|${policy}`;
    const hit = this.stockCache.get(key);
    if (hit) return hit;
    const it = this.item('stock', id);
    const jf = it.files.find((f) => f.endsWith('.json'))!;
    const tf = it.files.find((f) => f.endsWith('.safetensors'))!;
    const side = this.json(jf);
    const t = (n: string): Tensor => this.tensor(tf, n);
    const opt = (n: string): Tensor | undefined => this.st(tf).tensors.get(n);
    const where = `${this.packId}/${tf}`;

    const wl = t('wavelengths_nm');
    if (wl.data.length !== GRID.count || wl.data.some((v, i) => v !== GRID.start_nm + i * GRID.step_nm)) {
      fail('E_DATA_GRID', `${where}: wavelengths are not 380–780 nm in 5 nm steps`);
    }
    const spectral = (n: string, cols: number): Tensor => {
      const x = t(n);
      if (x.shape[0] !== GRID.count || (cols > 1 && x.shape[1] !== cols)) fail('E_DATA_GRID', `${where}: ${n} has shape [${x.shape.join(', ')}], expected [81${cols > 1 ? `, ${cols}` : ''}]`);
      return x;
    };
    const ls = spectral('log10_sensitivity', 3);
    const dyes = spectral('unit_dye_density_D', 3);
    const base = spectral('base_density_D', 1);
    const mid = opt('midscale_neutral_density_D');
    const le = t('log_exposure_logH');
    const curves = t('dye_amount_curves');
    const sub = opt('sublayer_dye_amount_curves');

    const info = side.info ?? {};
    const role: Role = it.role ?? side.role;
    const defaulted: string[] = [];
    const pick = <K extends keyof typeof PROFILE_DEFAULTS>(k: K): (typeof PROFILE_DEFAULTS)[K] => {
      if (info[k] !== undefined && info[k] !== null) return info[k];
      defaulted.push(k);
      return PROFILE_DEFAULTS[k];
    };
    const log10Sensitivity = triple((k) => zeroWhereMissing(column(ls, k), 'log10'));
    const raw: Record<string, Tensor> = {};
    for (const [n, x] of this.st(tf).tensors) raw[n] = x;
    const model = side.curve_model;
    const win = side.hanatos_window;
    const issues = this.manifest.knownIssues.filter((k) => k.items.includes(id));
    const d: StockData = {
      id,
      name: info.name ?? id,
      role,
      type: pick('type') as StockData['type'],
      support: info.support ?? (defaulted.push('support'), role === 'print' ? 'paper' : 'film'),
      stage: info.stage ?? (defaulted.push('stage'), role === 'print' ? 'printing' : 'filming'),
      use: pick('use') as StockData['use'],
      antihalation: pick('antihalation') as NonNullable<StockData['antihalation']>,
      channelModel: pick('channel_model') as StockData['channelModel'],
      densitometer: pick('densitometer') as NonNullable<StockData['densitometer']>,
      referenceIlluminant: pick('reference_illuminant'),
      viewingIlluminant: pick('viewing_illuminant'),
      targetPrint: info.target_print ?? null,
      sensitivityDensityOverMin_D: pick('log_sensitivity_density_over_min'),
      infoDefaulted: defaulted,
      log10Sensitivity,
      sensitivity: triple((k) => linearSensitivity(log10Sensitivity[k]!)),
      unitDyes_D: triple((k) => densitySpectrum(column(dyes, k), policy)),
      base_D: densitySpectrum(base.data, policy),
      ...(mid ? { midscaleNeutral_D: densitySpectrum(mid.data, policy) } : {}),
      logExposure_logH: Float64Array.from(le.data),
      dyeCurves: triple((k) => column(curves, k)),
      ...(sub ? { sublayerCurves: Float64Array.from(sub.data) } : {}),
      ...(model ? { curveModel: { kind: 'cdfs' as const, centers: model.centers, amplitudes: model.amplitudes, sigmas: model.sigmas } } : {}),
      ...(win ? { hanatosWindow: { c_uv_nm: win.c_uv_nm, sigma_uv_nm: win.sigma_uv_nm, c_ir_nm: win.c_ir_nm, sigma_ir_nm: win.sigma_ir_nm } } : {}),
      ...(side.hanatos_surface ? { hanatosSurface: side.hanatos_surface.params } : {}),
      missing: policy,
      contentHash: it.contentHash,
      knownIssues: issues.map((k) => k.text),
      attribution: side.attribution ?? this.attribution,
      packId: this.packId,
      raw,
    };
    if (curves.shape[0] !== le.data.length || curves.shape[1] !== 3) fail('E_DATA_SCHEMA', `${where}: dye_amount_curves shape [${curves.shape.join(', ')}] does not match log exposure`);
    for (const k of issues) this.warn(`issue:${id}:${k.id}`, 'W_STOCK_KNOWN_ISSUE', `${id}: ${k.text}`, { path: `stock:${id}` });
    if (role === 'print' && !model) {
      this.warn(`nomodel:${id}`, 'W_STOCK_NO_MODEL', `${id} has no fitted 3-CDF curve model in ${this.packId}; engines must use the 256-point table`, { path: `stock:${id}` });
    }
    this.stockCache.set(key, d);
    return d;
  }

  // -- light, observer, enlarger ----------------------------------------------------------------

  illuminantIds(): string[] {
    return this.items('illuminant').map((i) => i.id);
  }

  async illuminant(id: string): Promise<Spectrum81> {
    await this.ensure('illuminant', id);
    return this.illuminantSync(id);
  }

  illuminantSync(id: string): Spectrum81 {
    const it = this.item('illuminant', id);
    return zeroWhereMissing(this.tensor(it.files[0]!, it.tensor!).data, 'relMean1');
  }

  async cmf(id = 'cie1931-2deg'): Promise<Triple<Spectrum81>> {
    await this.ensure('cmf', id);
    return this.cmfSync(id);
  }

  cmfSync(id = 'cie1931-2deg'): Triple<Spectrum81> {
    const it = this.item('cmf', id);
    const t = this.tensor(it.files[0]!, it.tensor!);
    return triple((k) => zeroWhereMissing(column(t, k), 'cmf'));
  }

  dichroicSets(): string[] {
    return this.items('dichroics').map((i) => i.id);
  }

  async dichroics(set = 'custom'): Promise<Triple<Spectrum81>> {
    await this.ensure('dichroics', set);
    return this.dichroicsSync(set);
  }

  /** C, M, Y filter transmittances; samples outside a measured filter's range have valid 0. */
  dichroicsSync(set = 'custom'): Triple<Spectrum81> {
    const it = this.item('dichroics', set);
    const t = this.tensor(it.files[0]!, it.tensor!);
    return triple((k) => zeroWhereMissing(column(t, k), 'fraction'));
  }

  async neutralFilters(q: { paper: string; lamp?: string; film: string }): Promise<{ c_cc: number; m_cc: number; y_cc: number } | undefined> {
    await this.ensure('neutral-print-filters', 'neutral-print-filters');
    return this.neutralFiltersSync(q);
  }

  /** The C, M, Y pack that prints the film's mid-grey neutral; lamp defaults to TH-KG3. */
  neutralFiltersSync(q: { paper: string; lamp?: string; film: string }): { c_cc: number; m_cc: number; y_cc: number } | undefined {
    const it = this.item('neutral-print-filters', 'neutral-print-filters');
    const v = this.json(it.files[0]!).table?.[q.paper]?.[q.lamp ?? 'TH-KG3']?.[q.film] as number[] | undefined;
    return v ? { c_cc: v[0]!, m_cc: v[1]!, y_cc: v[2]! } : undefined;
  }

  // -- presets (spektrafilm parameters that live in code) ---------------------------------------

  async dirPreset(film: string, which: 'applied' | 'schema-default' = 'applied'): Promise<DirPreset> {
    await this.ensure('preset', 'dir-couplers');
    return this.dirPresetSync(film, which);
  }

  dirPresetSync(film: string, which: 'applied' | 'schema-default' = 'applied'): DirPreset {
    const j = this.json(this.item('preset', 'dir-couplers').files[0]!);
    let e: any;
    let source: string;
    if (which === 'schema-default') {
      e = j.schemaDefault;
      source = 'schema-default';
    } else {
      e = j.applied[film];
      if (!e) {
        const known = Object.keys(j.applied);
        const valid = closest(film, known);
        fail('E_STOCK_UNKNOWN', `no applied DIR preset for "${film}" (films only)`, { valid, ...(valid[0] ? { hint: `did you mean "${valid[0]}"?` } : {}) });
      }
      source = e.source;
    }
    return {
      matrix: e.matrix, amount: e.amount, diffusionSize_um: e.diffusion_size_um, diffusionTail_um: e.diffusion_tail_um,
      diffusionTailWeight: e.diffusion_tail_weight, source, upstream: e,
    };
  }

  async halationPreset(use: 'still' | 'cine', antihalation: 'strong' | 'weak' | 'no'): Promise<HalationPreset> {
    await this.ensure('preset', 'halation');
    return this.halationPresetSync(use, antihalation);
  }

  halationPresetSync(use: 'still' | 'cine', antihalation: 'strong' | 'weak' | 'no'): HalationPreset {
    const j = this.json(this.item('preset', 'halation').files[0]!);
    const p = (j.presets as any[]).find((x) => x.use === use && x.antihalation === antihalation);
    if (!p) fail('E_DATA_SCHEMA', `no halation preset for (${use}, ${antihalation})`, { valid: (j.presets as any[]).map((x) => `${x.use}/${x.antihalation}`) });
    const d = j.defaults;
    return {
      sigmaH_um: p.halation_first_sigma_um, strength: p.halation_strength, bounces: d.halation_n_bounces, bounceDecay: d.halation_bounce_decay,
      scatterCore_um: d.scatter_core_um, scatterTail_um: d.scatter_tail_um, scatterTailWeight: d.scatter_tail_weight,
    };
  }

  async grainDefaults(): Promise<Record<string, unknown>> {
    await this.ensure('preset', 'grain');
    return this.json(this.item('preset', 'grain').files[0]!).defaults;
  }

  /** The hanatos2025 irradiance table: F16 bits, [tc_x][tc_y][wavelength]. Fetched only when asked. */
  async upsamplingTable(id = 'hanatos2025-irradiance-xy-tc'): Promise<{ data: Uint16Array; shape: [number, number, number] }> {
    const it = await this.ensure('upsampling', id);
    const t = this.tensor(it.files[0]!, it.tensor!);
    if (t.dtype !== 'F16' || t.shape.length !== 3 || t.shape[2] !== GRID.count) fail('E_DATA_GRID', `${id}: expected F16 [n, n, 81], got ${t.dtype} [${t.shape.join(', ')}]`);
    return { data: t.data as Uint16Array, shape: t.shape as [number, number, number] };
  }

  // -- cameras and lights (scanner packs) -------------------------------------------------------

  cameraIds(): string[] {
    return this.items('camera').map((i) => i.id);
  }

  lightIds(): string[] {
    return this.items('light').map((i) => i.id);
  }

  async camera(id: string): Promise<CameraData> {
    await this.ensure('camera', id);
    return this.cameraSync(id);
  }

  cameraSync(id: string): CameraData {
    const it = this.item('camera', id);
    const t = this.tensor(it.files[0]!, it.tensor!);
    if (t.shape[0] !== GRID.count || t.shape[1] !== 3) fail('E_DATA_GRID', `camera ${id}: shape [${t.shape.join(', ')}], expected [81, 3]`);
    if (it.illustrative) this.warn(`illustrative:camera:${id}`, 'W_DATA_ILLUSTRATIVE', `camera "${id}" is illustrative, not measured (${this.packId})`, { path: `camera:${id}` });
    return {
      id, responsivity: triple((k) => zeroWhereMissing(column(t, k), 'responsivity')), illustrative: !!it.illustrative,
      measuredRange_nm: (it['measuredRange_nm'] as [number, number] | null | undefined) ?? null, about: it.about ?? '', contentHash: it.contentHash,
    };
  }

  async light(id: string): Promise<LightData> {
    await this.ensure('light', id);
    return this.lightSync(id);
  }

  lightSync(id: string): LightData {
    const it = this.item('light', id);
    const t = this.tensor(it.files[0]!, it.tensor!);
    if (t.data.length !== GRID.count) fail('E_DATA_GRID', `light ${id}: ${t.data.length} samples, expected 81`);
    if (it.illustrative) this.warn(`illustrative:light:${id}`, 'W_DATA_ILLUSTRATIVE', `light "${id}" is illustrative, not measured (${this.packId})`, { path: `light:${id}` });
    return { id, spd: zeroWhereMissing(t.data, 'relPeak'), illustrative: !!it.illustrative, about: it.about ?? '', contentHash: it.contentHash };
  }
}

export const openPack = (src: DataSource, packId: string, opts?: OpenOptions): Promise<Pack> => Pack.open(src, packId, opts);
