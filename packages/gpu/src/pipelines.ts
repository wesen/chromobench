// Pipeline cache (guide §5.2): key = hash of WGSL text, entry point, override constants and layout.
// Compilation errors become E_KERNEL_COMPILE diagnostics with line numbers (after gpu.js pipeline,
// 3538–3548). Pipelines are compiled with createComputePipelineAsync and can be prewarmed.
import { ChromobenchError, canonicalJSON, sha256Hex, type Diagnostic } from '@chromobench/contract';

export interface KernelSpec {
  /** Short name for diagnostics, e.g. 'solve'. */
  name: string;
  code: string;
  entryPoint?: string;
  constants?: Record<string, number>;
  /** Explicit bind group layouts; omitted means layout 'auto'. */
  layout?: { key: string; layouts: GPUBindGroupLayout[] };
}

/**
 * The hash of a kernel's WGSL, memoised by the string: every dispatch asks for its pipeline, and hashing 30 kB of WGSL
 * per pointwise program and per combine pass cost a tiled export tens of milliseconds (CHB-037 P8a, measured on Metal).
 */
const codeHashes = new Map<string, string>();
function codeHash(code: string): string {
  let h = codeHashes.get(code);
  if (h === undefined) {
    h = sha256Hex(code);
    codeHashes.set(code, h);
  }
  return h;
}

export function kernelKey(k: KernelSpec): string {
  return sha256Hex(canonicalJSON({ code: codeHash(k.code), entry: k.entryPoint ?? 'main', constants: k.constants ?? {}, layout: k.layout?.key ?? 'auto' }));
}

/** Turns compilation messages into one diagnostic (first error's position in `where`). */
export function compileDiagnostic(name: string, messages: readonly { type: string; lineNum: number; linePos: number; message: string }[]): Diagnostic | null {
  const errs = messages.filter((m) => m.type === 'error');
  if (!errs.length) return null;
  const first = errs[0]!;
  return {
    code: 'E_KERNEL_COMPILE',
    message: `WGSL ${name}: ` + errs.map((m) => `line ${m.lineNum}:${m.linePos}: ${m.message}`).join('; '),
    where: { line: first.lineNum, col: first.linePos },
  };
}

export class PipelineCache {
  private readonly pipes = new Map<string, Promise<GPUComputePipeline>>();
  /** Compile time per kernel in ms (first compile only). */
  readonly compileMs = new Map<string, number>();
  private readonly device: GPUDevice;
  constructor(device: GPUDevice) {
    this.device = device;
  }

  get(k: KernelSpec): Promise<GPUComputePipeline> {
    const key = kernelKey(k);
    let p = this.pipes.get(key);
    if (!p) {
      p = this.compile(k);
      this.pipes.set(key, p);
      p.catch(() => this.pipes.delete(key));
    }
    return p;
  }

  private async compile(k: KernelSpec): Promise<GPUComputePipeline> {
    const t0 = performance.now();
    const module = this.device.createShaderModule({ code: k.code, label: k.name });
    const info = await module.getCompilationInfo();
    const d = compileDiagnostic(k.name, info.messages);
    if (d) throw new ChromobenchError(d);
    this.device.pushErrorScope('validation');
    let pipe: GPUComputePipeline;
    try {
      pipe = await this.device.createComputePipelineAsync({
        label: k.name,
        layout: k.layout ? this.device.createPipelineLayout({ bindGroupLayouts: k.layout.layouts }) : 'auto',
        compute: { module, entryPoint: k.entryPoint ?? 'main', ...(k.constants ? { constants: k.constants } : {}) },
      });
    } catch (e) {
      await this.device.popErrorScope();
      throw new ChromobenchError({ code: 'E_KERNEL_COMPILE', message: `WGSL ${k.name}: ${e instanceof Error ? e.message : String(e)}` });
    }
    const err = await this.device.popErrorScope();
    if (err) throw new ChromobenchError({ code: 'E_KERNEL_COMPILE', message: `WGSL ${k.name}: ${err.message}` });
    this.compileMs.set(k.name, performance.now() - t0);
    return pipe;
  }

  /** Compile every kernel up front so the first slider move does not pay for compilation. */
  async prewarm(ks: KernelSpec[]): Promise<void> {
    await Promise.all(ks.map((k) => this.get(k)));
  }

  get size(): number { return this.pipes.size; }
  clear(): void { this.pipes.clear(); }
}
