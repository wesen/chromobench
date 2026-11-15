// Vite asset imports used by the host file (host/engines.ts).
declare module '*?url' {
  const url: string;
  export default url;
}

// The build's version and commit (vite.config.ts `define`; CHB-038 problem reports name them).
declare const __CHROMOBENCH_VERSION__: string;
declare const __CHROMOBENCH_COMMIT__: string;
