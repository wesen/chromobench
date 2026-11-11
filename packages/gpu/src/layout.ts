// Uniform/storage struct packing with WGSL's alignment rules (WGSL §14.4 "Memory layout").
// One struct description generates the byte offsets, the packer and the WGSL declaration, so the
// host side and the kernel can never disagree about where a field lives (the Studio packed its
// 112-byte SOLVE uniform by hand: gpu.js gpuSolve 3584–3595).

export type Scalar = 'f32' | 'u32' | 'i32';
export type FieldType =
  | Scalar
  | 'vec2f' | 'vec3f' | 'vec4f'
  | 'vec2u' | 'vec3u' | 'vec4u'
  | 'vec2i' | 'vec3i' | 'vec4i'
  | 'mat3x3f' | 'mat4x4f'
  | { array: FieldType; n: number };

export type AddressSpace = 'uniform' | 'storage';

interface TypeInfo { align: number; size: number; scalar: Scalar; wgsl: string }

const roundUp = (k: number, n: number): number => Math.ceil(n / k) * k;

function typeInfo(t: FieldType, space: AddressSpace): TypeInfo {
  if (typeof t === 'object') {
    const el = typeInfo(t.array, space);
    // uniform address space: array element alignment rounds up to 16 (WGSL §14.4.4)
    const align = space === 'uniform' ? roundUp(16, el.align) : el.align;
    const stride = roundUp(align, el.size);
    return { align, size: stride * t.n, scalar: el.scalar, wgsl: `array<${el.wgsl}, ${t.n}>` };
  }
  switch (t) {
    case 'f32': case 'u32': case 'i32': return { align: 4, size: 4, scalar: t, wgsl: t };
    case 'vec2f': return { align: 8, size: 8, scalar: 'f32', wgsl: 'vec2<f32>' };
    case 'vec2u': return { align: 8, size: 8, scalar: 'u32', wgsl: 'vec2<u32>' };
    case 'vec2i': return { align: 8, size: 8, scalar: 'i32', wgsl: 'vec2<i32>' };
    case 'vec3f': return { align: 16, size: 12, scalar: 'f32', wgsl: 'vec3<f32>' };
    case 'vec3u': return { align: 16, size: 12, scalar: 'u32', wgsl: 'vec3<u32>' };
    case 'vec3i': return { align: 16, size: 12, scalar: 'i32', wgsl: 'vec3<i32>' };
    case 'vec4f': return { align: 16, size: 16, scalar: 'f32', wgsl: 'vec4<f32>' };
    case 'vec4u': return { align: 16, size: 16, scalar: 'u32', wgsl: 'vec4<u32>' };
    case 'vec4i': return { align: 16, size: 16, scalar: 'i32', wgsl: 'vec4<i32>' };
    case 'mat3x3f': return { align: 16, size: 48, scalar: 'f32', wgsl: 'mat3x3<f32>' }; // three 16-byte columns
    case 'mat4x4f': return { align: 16, size: 64, scalar: 'f32', wgsl: 'mat4x4<f32>' };
  }
}

export interface FieldLayout { name: string; type: FieldType; offset: number; size: number }

export interface StructLayout {
  name: string;
  space: AddressSpace;
  size: number;
  align: number;
  fields: FieldLayout[];
  offset(name: string): number;
  /** WGSL `struct Name { … }` declaration. */
  wgsl(): string;
  /**
   * Packs values into a new ArrayBuffer. Vectors are number arrays; matrices are given row-major
   * (`M[row][col]`, the way maths is written) and stored column-major as WGSL expects.
   * Missing fields are zero. `opts.rowMajor` stores matrices row-major — a deliberate bug for tests.
   */
  pack(values: Record<string, unknown>, opts?: { rowMajor?: boolean }): ArrayBuffer;
}

export function defineStruct(name: string, fields: [string, FieldType][], space: AddressSpace = 'uniform'): StructLayout {
  let off = 0;
  let align = 4;
  const out: FieldLayout[] = [];
  const decl: string[] = [];
  for (const [fname, ftype] of fields) {
    const ti = typeInfo(ftype, space);
    off = roundUp(ti.align, off);
    out.push({ name: fname, type: ftype, offset: off, size: ti.size });
    decl.push(`  ${fname}: ${ti.wgsl},`);
    off += ti.size;
    align = Math.max(align, ti.align);
  }
  if (space === 'uniform') align = roundUp(16, align);
  const size = roundUp(align, off);
  const byName = new Map(out.map((f) => [f.name, f]));
  return {
    name, space, size, align, fields: out,
    offset(n) {
      const f = byName.get(n);
      if (!f) throw new Error(`layout ${name}: no field ${n}`);
      return f.offset;
    },
    wgsl: () => `struct ${name} {\n${decl.join('\n')}\n};`,
    pack(values, opts = {}) {
      const buf = new ArrayBuffer(size);
      const dv = new DataView(buf);
      for (const [k] of Object.entries(values)) if (!byName.has(k)) throw new Error(`layout ${name}: unknown field ${k}`);
      for (const f of out) {
        const v = values[f.name];
        if (v === undefined) continue;
        writeField(dv, f.offset, f.type, v, space, opts.rowMajor === true, `${name}.${f.name}`);
      }
      return buf;
    },
  };
}

function writeScalar(dv: DataView, at: number, s: Scalar, v: unknown, label: string): void {
  if (typeof v === 'boolean') v = v ? 1 : 0;
  if (typeof v !== 'number') throw new Error(`layout: ${label} expects a number`);
  if (s === 'f32') dv.setFloat32(at, v, true);
  else if (s === 'u32') dv.setUint32(at, v >>> 0, true);
  else dv.setInt32(at, v | 0, true);
}

function writeField(dv: DataView, at: number, t: FieldType, v: unknown, space: AddressSpace, rowMajor: boolean, label: string): void {
  if (typeof t === 'object') {
    const el = typeInfo(t.array, space);
    const align = space === 'uniform' ? roundUp(16, el.align) : el.align;
    const stride = roundUp(align, el.size);
    const arr = v as ArrayLike<unknown>;
    if (arr.length > t.n) throw new Error(`layout: ${label} has ${arr.length} elements, room for ${t.n}`);
    for (let i = 0; i < arr.length; i++) writeField(dv, at + i * stride, t.array, arr[i], space, rowMajor, `${label}[${i}]`);
    return;
  }
  const ti = typeInfo(t, space);
  if (t === 'mat3x3f' || t === 'mat4x4f') {
    const n = t === 'mat3x3f' ? 3 : 4;
    const M = v as number[][];
    for (let c = 0; c < n; c++) for (let r = 0; r < n; r++) {
      const val = rowMajor ? M[c]![r]! : M[r]![c]!;
      dv.setFloat32(at + 16 * c + 4 * r, val, true);
    }
    return;
  }
  if (t === 'f32' || t === 'u32' || t === 'i32') return writeScalar(dv, at, t, v, label);
  const arr = v as ArrayLike<number>;
  const n = ti.size / 4;
  if (arr.length > n) throw new Error(`layout: ${label} has ${arr.length} components, room for ${n}`);
  for (let i = 0; i < arr.length; i++) writeScalar(dv, at + 4 * i, ti.scalar, arr[i], `${label}[${i}]`);
}
