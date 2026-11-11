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
