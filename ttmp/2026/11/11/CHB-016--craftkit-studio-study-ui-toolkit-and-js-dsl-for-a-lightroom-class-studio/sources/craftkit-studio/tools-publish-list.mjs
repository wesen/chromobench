// list the published files of dist/ (everything but index.html and test pages), for the Artifact publish call
import fs from 'node:fs'; import path from 'node:path';
const D = process.env.DIST || 'dist'; const out = [];
const walk = d => { for (const f of fs.readdirSync(d)) { const a = path.join(d, f); if (fs.statSync(a).isDirectory()) walk(a); else out.push(path.relative(D, a)); } };
walk(D);
console.log(JSON.stringify(out.filter(f => f !== 'index.html' && !f.startsWith('test/')).sort()));
