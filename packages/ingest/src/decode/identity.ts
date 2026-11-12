// Source identity (guide §5.2): SHA-256 over the file's bytes, never over decoded pixels.
import { sha256Hex, type SourceRef } from '@chromobench/contract';

export function sourceSha256(bytes: Uint8Array | ArrayBuffer): string {
  return sha256Hex(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
}

/** sha256("triplet:v1\n" + R + "\n" + G + "\n" + B), roles in order. */
export function tripletSha256(r: string, g: string, b: string): string {
  return sha256Hex(`triplet:v1\n${r}\n${g}\n${b}`);
}

export function tripletRef(parts: { role: 'R' | 'G' | 'B'; sha256: string; path?: string }[]): SourceRef {
  const by = (r: 'R' | 'G' | 'B'): string => parts.find((p) => p.role === r)?.sha256 ?? '';
  return { kind: 'triplet', sha256: tripletSha256(by('R'), by('G'), by('B')), parts: [...parts].sort((a, b) => 'RGB'.indexOf(a.role) - 'RGB'.indexOf(b.role)) };
}
