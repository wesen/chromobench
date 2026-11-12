// Folder access (guide §5.5): the File System Access API in Chromium (directory handles stored in
// IndexedDB, permission re-requested on a user gesture), and a fallback for other browsers
// (<input webkitdirectory>, used for the session or imported into OPFS).

export const SCAN_EXTENSIONS = ['tif', 'tiff', 'dng', 'png', 'jpg', 'jpeg'];

/** Adds the extensions the host's decoder accepts (camera RAW, CHB-023). */
export function addScanExtensions(exts: readonly string[]): void {
  for (const e of exts) if (!SCAN_EXTENSIONS.includes(e.toLowerCase())) SCAN_EXTENSIONS.push(e.toLowerCase());
}

export const isScan = (name: string): boolean => SCAN_EXTENSIONS.includes((/\.([^.]+)$/.exec(name)?.[1] ?? '').toLowerCase());

/** A file in a picked folder or a fallback input, before its hash is known. */
export interface PickedFile {
  name: string;
  relPath: string;
  size: number;
  lastModified: number;
  file(): Promise<File>;
  /** The file's handle when the File System Access API gave one: kept with the library, so the file opens again after a reload (F5). */
  handle?: FileSystemFileHandle;
}

interface PickerWindow {
  showDirectoryPicker?: (o: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
}

export const hasDirectoryPicker = (): boolean => typeof (globalThis as PickerWindow).showDirectoryPicker === 'function';

export async function pickDirectory(): Promise<FileSystemDirectoryHandle> {
  return (globalThis as PickerWindow).showDirectoryPicker!({ id: 'scans', mode: 'read' });
}

type PermHandle = FileSystemHandle & {
  queryPermission?: (o: { mode: 'read' }) => Promise<PermissionState>;
  requestPermission?: (o: { mode: 'read' }) => Promise<PermissionState>;
};

/** 'granted' | 'prompt' | 'denied' without asking. */
export async function permission(h: FileSystemHandle): Promise<PermissionState> {
  const q = (h as PermHandle).queryPermission;
  return q ? q.call(h, { mode: 'read' }) : 'granted';
}

/** Asks again (needs a user gesture). */
export async function reconnect(h: FileSystemHandle): Promise<boolean> {
  const r = (h as PermHandle).requestPermission;
  return (r ? await r.call(h, { mode: 'read' }) : 'granted') === 'granted';
}

type IterDir = FileSystemDirectoryHandle & { entries(): AsyncIterable<[string, FileSystemHandle]> };

/** Scan files in a directory and one level of subfolders, sorted by path. */
export async function listScans(dir: FileSystemDirectoryHandle, prefix = '', depth = 1): Promise<PickedFile[]> {
  const out: PickedFile[] = [];
  for await (const [name, h] of (dir as IterDir).entries()) {
    if (h.kind === 'directory' && depth > 0) out.push(...(await listScans(h as FileSystemDirectoryHandle, `${prefix}${name}/`, depth - 1)));
    else if (h.kind === 'file' && isScan(name)) {
      const f = await (h as FileSystemFileHandle).getFile();
      out.push({ name, relPath: `${prefix}${name}`, size: f.size, lastModified: f.lastModified, file: () => (h as FileSystemFileHandle).getFile(), handle: h as FileSystemFileHandle });
    }
  }
  return out.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

/** Resolves a relative path inside a stored directory handle. */
export async function fileAt(dir: FileSystemDirectoryHandle, relPath: string): Promise<File> {
  const parts = relPath.split('/');
  let d = dir;
  for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p);
  return (await d.getFileHandle(parts.at(-1)!)).getFile();
}

/** Files from <input type=file> (with or without webkitdirectory). */
export function fromFileList(list: FileList | File[]): PickedFile[] {
  return [...list]
    .filter((f) => isScan(f.name))
    .map((f) => ({ name: f.name, relPath: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, size: f.size, lastModified: f.lastModified, file: async () => f }))
    .sort((a, b) => a.relPath.localeCompare(b.relPath));
}

/** SHA-256 of bytes through WebCrypto (async, off the main parser path). */
export async function sha256(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
