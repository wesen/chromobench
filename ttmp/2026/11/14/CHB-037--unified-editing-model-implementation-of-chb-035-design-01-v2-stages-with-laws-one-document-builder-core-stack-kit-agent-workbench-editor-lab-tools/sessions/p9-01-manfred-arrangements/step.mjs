// node step.mjs <stepfile.mjs>  — runs one step in the long-lived driver and prints its result.
import http from 'node:http'; import path from 'node:path';
const S = path.dirname(new URL(import.meta.url).pathname);
const file = path.resolve(process.argv[2]); process.chdir(S);
const req = http.request({ socketPath: '.driver.sock', method: 'POST', path: '/' }, async (res) => {
  let b = ''; for await (const c of res) b += c; console.log(b);
});
req.setTimeout(590000); req.end(JSON.stringify({ file }));
