/// <reference types="@webgpu/types" />
// WGSL kernels are imported as text through Vite's ?raw suffix (works in Vitest too).
declare module '*.wgsl?raw' {
  const code: string;
  export default code;
}
declare module '*.json?raw' {
  const text: string;
  export default text;
}
// Vite's import.meta.glob (eager JSON), used by physics/data.ts; works in Vitest too.
interface ImportMeta {
  glob<T = unknown>(pattern: string, options: { eager: true; import?: string }): Record<string, T>;
}
