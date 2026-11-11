// zlib (RFC 1950) through CompressionStream('deflate'), ported from Chromogen export.js 3245–3248 and
// made streaming: what PNG's IDAT and TIFF's Adobe Deflate (compression 8) expect.

/** Streaming compressor: write() as often as needed, then finish(); compressed bytes go to onData in order. */
export class DeflateStream {
  private readonly writer: WritableStreamDefaultWriter<Uint8Array>;
  private readonly pump: Promise<void>;
  private failed: unknown = null;

  constructor(onData: (u8: Uint8Array) => Promise<void> | void) {
    const cs = new CompressionStream('deflate');
    this.writer = cs.writable.getWriter() as WritableStreamDefaultWriter<Uint8Array>;
    const reader = cs.readable.getReader();
    this.pump = (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          await onData(value);
        }
      } catch (e) {
        this.failed = e;
        await reader.cancel(e).catch(() => undefined);
        throw e;
      }
    })();
    // a failure surfaces through write/finish; keep it from being reported as unhandled meanwhile
    this.pump.catch(() => undefined);
  }

  /** Hands `u8` to the compressor. The caller must not modify `u8` afterwards. */
  async write(u8: Uint8Array): Promise<void> {
    if (this.failed) throw this.failed;
    await this.writer.ready;
    await this.writer.write(u8);
  }

  /** Flushes the compressor and waits until every compressed byte went to onData. */
  async finish(): Promise<void> {
    if (this.failed) throw this.failed;
    await this.writer.close();
    await this.pump;
  }

  async abort(reason?: unknown): Promise<void> {
    await this.writer.abort(reason).catch(() => undefined);
    await this.pump.catch(() => undefined);
  }
}

/** One-shot zlib compression. */
export async function deflateAll(u8: Uint8Array): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let n = 0;
  const d = new DeflateStream((c) => { parts.push(c); n += c.length; });
  await d.write(u8);
  await d.finish();
  return concat(parts, n);
}

/** One-shot zlib decompression (tests, readers). */
export async function inflateAll(u8: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate');
  const w = ds.writable.getWriter();
  void w.write(u8 as Uint8Array<ArrayBuffer>).then(() => w.close()).catch(() => undefined);
  const r = ds.readable.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    parts.push(value);
    n += value.length;
  }
  return concat(parts, n);
}

export function concat(parts: readonly Uint8Array[], n = parts.reduce((s, p) => s + p.length, 0)): Uint8Array {
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
