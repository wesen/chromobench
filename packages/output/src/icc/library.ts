// The photographer's printer profiles (guide §5.7): stored in OPFS under their SHA-256, with an index of
// description, class, colour space and version. Import validates before anything is stored: the file
// must parse (E_ICC_INVALID), be an output-class profile ('prtr', else E_ICC_CLASS: e.g. a display profile
// offered as a printer profile) with an RGB device space (version 1 supports the RGB profiles inkjet
// drivers use; CMYK for RIPs is an open question) and an XYZ or Lab PCS. Optionally lcms must open it too.
import { ChromobenchError } from '@chromobench/contract';
import { opfsRoot, type DirHandleLike } from '../encode/sinks.ts';
import type { Lcms } from './lcms/api.ts';
import { parseIcc } from './parse.ts';

export interface PrinterProfileEntry {
  sha256: string;
  description: string;
  class: string;
  colourSpace: string;
  pcs: string;
  version: string;
  bytes: number;
  /** A2B/B2A tags present (LUT-based device profile). */
  luts: string[];
  added: string;
}

const INDEX = 'index.json';

async function readText(dir: DirHandleLike, name: string): Promise<string | null> {
  try { return await (await (await dir.getFileHandle(name)).getFile()).text(); } catch { return null; }
}
async function writeBytes(dir: DirHandleLike, name: string, data: Uint8Array | string): Promise<void> {
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable({ keepExistingData: false });
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  await w.write(bytes as Uint8Array<ArrayBuffer>);
  await w.close();
}

/** Checks a profile for use as a printer profile; returns its index entry (not yet stored). */
export function validatePrinterProfile(bytes: Uint8Array): PrinterProfileEntry {
  const p = parseIcc(bytes);
  const h = p.header;
  if (h.class !== 'prtr') throw new ChromobenchError({ code: 'E_ICC_CLASS', message: `"${p.description || 'profile'}" is a ${h.class.trim()} profile, not a printer (output, prtr) profile`, hint: 'export to a file in this space instead, or pick the printer/paper profile' });
  if (h.colourSpace !== 'RGB ') throw new ChromobenchError({ code: 'E_ICC_CLASS', message: `printer profile "${p.description}" has device space ${h.colourSpace.trim()}; only RGB printer profiles are supported` });
  if (h.pcs !== 'XYZ ' && h.pcs !== 'Lab ') throw new ChromobenchError({ code: 'E_ICC_INVALID', message: `printer profile has PCS ${h.pcs}` });
  const luts = p.tags.filter((t) => /^[AB]2[AB]\d$/.test(t));
  return { sha256: p.sha256, description: p.description, class: h.class, colourSpace: h.colourSpace.trim(), pcs: h.pcs.trim(), version: h.version, bytes: bytes.length, luts, added: new Date().toISOString() };
}

export class ProfileLibrary {
  private readonly dir: DirHandleLike;
  private constructor(dir: DirHandleLike) { this.dir = dir; }

  /** The library in `dir`, by default OPFS `profiles/`. */
  static async open(dir?: DirHandleLike): Promise<ProfileLibrary> {
    return new ProfileLibrary(dir ?? (await (await opfsRoot()).getDirectoryHandle('profiles', { create: true })));
  }

  async list(): Promise<PrinterProfileEntry[]> {
    const t = await readText(this.dir, INDEX);
    return t ? (JSON.parse(t) as PrinterProfileEntry[]) : [];
  }

  /** Validates and stores a profile; importing the same bytes twice keeps one entry. */
  async import(bytes: Uint8Array, o: { lcms?: Lcms } = {}): Promise<PrinterProfileEntry> {
    const e = validatePrinterProfile(bytes);
    if (o.lcms) {
      const h = await o.lcms.open(bytes);
      const info = await o.lcms.info(h);
      await o.lcms.close(h);
      if (info.colourSpace !== 'RGB') throw new ChromobenchError({ code: 'E_ICC_INVALID', message: `lcms reads the device space as ${String(info.colourSpace)}` });
    }
    const all = await this.list();
    const known = all.find((x) => x.sha256 === e.sha256);
    if (known) return known;
    await writeBytes(this.dir, `${e.sha256}.icc`, bytes);
    await writeBytes(this.dir, INDEX, JSON.stringify([...all, e], null, 1));
    return e;
  }

  async get(sha256: string): Promise<Uint8Array> {
    try {
      return new Uint8Array(await (await (await this.dir.getFileHandle(`${sha256}.icc`)).getFile()).arrayBuffer());
    } catch {
      throw new ChromobenchError({ code: 'E_ICC_INVALID', message: `no stored printer profile ${sha256.slice(0, 12)}…` });
    }
  }

  async remove(sha256: string): Promise<void> {
    const all = await this.list();
    await writeBytes(this.dir, INDEX, JSON.stringify(all.filter((x) => x.sha256 !== sha256), null, 1));
    try { await this.dir.removeEntry(`${sha256}.icc`); } catch { /* gone */ }
  }
}
