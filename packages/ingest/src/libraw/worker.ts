// The LibRaw worker (guide §5.4): serveRawJobs runs inside a dedicated Worker (browser: `serveRawJobs(self)`;
// Node: `serveRawJobs(parentPort)`); workerRawDecoder is the UI-side RawDecoder that posts jobs and
// transfers the file buffer in and the planes out, so a multi-second decode never blocks the UI.
import { ChromobenchError, toDiagnostic, type DecodeOptions } from '@chromobench/contract';
import { sourceSha256 } from '../decode/identity.ts';
import type { RawDecoder } from '../decode/registry.ts';
import type { RawImage } from '../decode/types.ts';
import { LibRawDecoder, setLibRawWasm } from './adapter.ts';
import { fromWire, onMessage, toWire, type Port, type RawInfo, type RawJob, type RawReply } from './protocol.ts';

export function serveRawJobs(port: Port, decoder: { probe(b: Uint8Array): Promise<{ sha256: string; info: RawInfo }>; decode(b: Uint8Array, o: Partial<DecodeOptions>): Promise<RawImage> } = new LibRawDecoder()): void {
  onMessage(port, (data) => {
    const job = data as RawJob;
    void (async () => {
      if (job.kind === 'config') {
        setLibRawWasm(job.wasmUrl);
        port.postMessage({ id: job.id, ok: true, sha256: '' } satisfies RawReply);
        return;
      }
      const bytes = new Uint8Array(job.bytes);
      let sha256: string | undefined;
      try {
        sha256 = sourceSha256(bytes);
        if (job.kind === 'probe') {
          const { info } = await decoder.probe(bytes);
          port.postMessage({ id: job.id, ok: true, sha256, info } satisfies RawReply);
          return;
        }
        const image = await decoder.decode(bytes, job.options);
        const { wire, transfer } = toWire(image);
        port.postMessage({ id: job.id, ok: true, sha256, image: wire } satisfies RawReply, transfer);
      } catch (e) {
        port.postMessage({ id: job.id, ok: false, ...(sha256 ? { sha256 } : {}), error: toDiagnostic(e) } satisfies RawReply);
      }
    })();
  });
}

/** A RawDecoder backed by a worker port. The caller's buffer is transferred (it becomes detached). */
export function workerRawDecoder(port: Port, o: { copy?: boolean; wasmUrl?: string } = {}): RawDecoder & { probe(bytes: Uint8Array): Promise<{ sha256: string; info: RawInfo }> } {
  let next = 1;
  const pending = new Map<number, (r: RawReply) => void>();
  onMessage(port, (data) => {
    const r = data as RawReply;
    pending.get(r.id)?.(r);
    pending.delete(r.id);
  });
  // A Worker that fails to load or throws reports an 'error' event: fail every pending job.
  port.addEventListener?.('error', (e) => {
    for (const [id, f] of pending) f({ id, ok: false, error: { code: 'E_INTERNAL', message: `LibRaw worker error: ${e.message ?? 'unknown'}` } });
    pending.clear();
  });
  if (o.wasmUrl) port.postMessage({ id: 0, kind: 'config', wasmUrl: o.wasmUrl } satisfies RawJob);
  const send = (job: Omit<RawJob, 'id' | 'bytes'>, bytes: Uint8Array): Promise<RawReply> => {
    const id = next++;
    const buf = o.copy || bytes.byteLength !== bytes.buffer.byteLength ? bytes.slice().buffer : (bytes.buffer as ArrayBuffer);
    return new Promise((resolve) => {
      pending.set(id, resolve);
      port.postMessage({ ...job, id, bytes: buf } as RawJob, [buf]);
    });
  };
  const unwrap = <T>(r: RawReply, f: (r: Extract<RawReply, { ok: true }>) => T): T => {
    if (!r.ok) throw new ChromobenchError(r.error);
    return f(r);
  };
  return {
    name: 'libraw-worker',
    async decode(bytes, options) {
      return unwrap(await send({ kind: 'decode', options } as Omit<RawJob, 'id' | 'bytes'>, bytes), (r) => fromWire(r.image!));
    },
    async probe(bytes) {
      return unwrap(await send({ kind: 'probe' }, bytes), (r) => ({ sha256: r.sha256, info: r.info! }));
    },
  };
}
