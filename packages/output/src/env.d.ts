// Ambient declarations for @chromobench/output: Vite asset URLs and the untyped lcms-wasm module.
declare module '*?url' {
  const url: string;
  export default url;
}
declare module 'lcms-wasm' {
  export const LCMS_VERSION: number;
  export function instantiate(o?: object): Promise<unknown>;
}
