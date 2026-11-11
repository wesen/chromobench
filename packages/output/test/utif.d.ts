// Minimal types for utif 3.1.0 (an independent TIFF decoder used only in tests).
declare module 'utif' {
  interface Ifd { width: number; height: number; data: Uint8Array; [tag: string]: unknown }
  const UTIF: {
    decode(buf: ArrayBuffer): Ifd[];
    decodeImage(buf: ArrayBuffer, ifd: Ifd): void;
  };
  export default UTIF;
}
