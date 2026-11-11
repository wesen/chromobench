// Independent re-implementation (not the imported code) of read / secant / tangent / base-weighted K on Chromogen's st-data.
const fs = require('fs'), path = require('path');
const dir = process.argv[2];
const J = (p) => JSON.parse(fs.readFileSync(path.join(dir, p), 'utf8'));
const st = J('stocks/kodak_portra_400.json').data, cam = J('cameras/generic-bayer.json'), led = J('lights/white-led.json');
const wl = st.wavelengths, n = wl.length;
const interp = (xs, ys, x) => { if (x < xs[0] || x > xs[xs.length-1]) return 0; let i = 0; while (xs[i+1] < x) i++; const t = (x - xs[i]) / (xs[i+1] - xs[i] || 1); return ys[i] + t * ((ys[i+1] ?? ys[i]) - ys[i]); };
const camK = ['R','G','B'].map(k => wl.map(w => interp(cam.wl, cam[k], w)));
const ledP = wl.map(w => interp(led.wl, led.values || led.power || led.R, w));
const gauss = (mu, fw) => wl.map(w => Math.exp(-0.5 * ((w - mu) / (fw / 2.3548)) ** 2));
const norm = (p) => { const s = p.reduce((a, b) => a + b, 0); return p.map(v => v / s); };
const white = [0,1,2].map(k => norm(camK[k].map((v, i) => v * ledP[i])));
const nb = [[660,20],[530,25],[450,20]].map(([m,f],k) => norm(camK[k].map((v,i)=>v*gauss(m,f)[i])));
const E = [0,1,2].map(j => st.channel_density.map(r => Number.isFinite(r[j]) ? r[j] : 0));
const B0 = st.base_density.map(v => v || 0);
const read = (P, D) => P.map(p => -Math.log10(p.reduce((s, w, i) => s + w * Math.pow(10, -D[i]), 0)));
const spec = (c, B) => B.map((b, i) => b + c[0]*E[0][i] + c[1]*E[1][i] + c[2]*E[2][i]);
const secant = (P) => P.map((_, k) => E.map(e => read(P, e)[k]));
const tangent = (P, D) => P.map(p => { const t = p.map((w,i) => w * Math.pow(10, -D[i])); const s = t.reduce((a,b)=>a+b,0); return E.map(e => t.reduce((a,w,i)=>a + w*e[i], 0) / s); });
const f3 = (M) => M.map(r => r.map(v => v.toFixed(3)).join(' ')).join(' | ');
// curve value at logH 0
const le = st.log_exposure; const curveAt = (j, x) => { const ys = st.density_curves.map(r => r[j]); return interp(le, ys, x); };
const cg = [0,1,2].map(j => curveAt(j, 0));
const cmin = [0,1,2].map(j => Math.min(...st.density_curves.map(r => r[j]).filter(Number.isFinite)));
console.log('curves at 0', cg.map(v=>v.toFixed(4)), 'min', cmin);
const c = [0.687, 0.704, 0.864];
console.log('grey narrowband read', read(nb, spec(c, B0)).map(v=>v.toFixed(4)));
console.log('grey white read', read(white, spec(c, B0)).map(v=>v.toFixed(4)), 'rebate', read(white, B0).map(v=>v.toFixed(4)));
console.log('white secant', f3(secant(white)));
console.log('white tangent0', f3(tangent(white, new Array(n).fill(0))));
console.log('white J at grey', f3(tangent(white, spec(c, B0))));
console.log('nb secant diag', secant(nb).map((r,k)=>r[k].toFixed(3)), 'nb tangent0 diag', tangent(nb, new Array(n).fill(0)).map((r,k)=>r[k].toFixed(3)));
const pb = white.map(p => norm(p.map((w,i)=>w*Math.pow(10,-B0[i]))));
console.log('white base-weighted tangent0', f3(tangent(pb, new Array(n).fill(0))));
// solves
const inv3 = (A) => { const d = A[0][0]*(A[1][1]*A[2][2]-A[1][2]*A[2][1]) - A[0][1]*(A[1][0]*A[2][2]-A[1][2]*A[2][0]) + A[0][2]*(A[1][0]*A[2][1]-A[1][1]*A[2][0]);
  const C = (i,j) => { const r=[0,1,2].filter(x=>x!==i), s=[0,1,2].filter(x=>x!==j); return A[r[0]][s[0]]*A[r[1]][s[1]]-A[r[0]][s[1]]*A[r[1]][s[0]]; };
  return [0,1,2].map(i=>[0,1,2].map(j=>((i+j)%2?-1:1)*C(j,i)/d)); };
const mv = (M, v) => M.map(r => r[0]*v[0]+r[1]*v[1]+r[2]*v[2]);
const d = read(white, spec(c, B0)), Db = read(white, B0), dd = d.map((v,k)=>v-Db[k]);
for (const [name, K] of [['secant', secant(white)], ['tangent0', tangent(white, new Array(n).fill(0))], ['baseweighted', tangent(pb, new Array(n).fill(0))]]) {
  const sol = mv(inv3(K), dd); console.log(name, 'solve err', sol.map((v,k)=>(v-c[k]).toFixed(3)), 'start', sol.map(v=>v.toFixed(4)));
}
// ---- LM trace with exact grey dyes, mirroring solve.js spectral() (activeSet off, then on)
const cx = cg; // exact curve values at logH 0
const P = white, Bv = B0, LN10 = Math.LN10;
function evalF(x, dvec, withJ) {
  const s=[0,0,0], a=[[0,0,0],[0,0,0],[0,0,0]];
  for (let i=0;i<n;i++){ const t=Math.exp(-LN10*(Bv[i]+x[0]*E[0][i]+x[1]*E[1][i]+x[2]*E[2][i]));
    for (let k=0;k<3;k++){ const w=P[k][i]*t; s[k]+=w; if(withJ) for(let j=0;j<3;j++) a[k][j]+=w*E[j][i]; } }
  const r=[0,1,2].map(k=>-Math.log10(s[k])-dvec[k]); const Jm=withJ?a.map((row,k)=>row.map(v=>v/s[k])):null;
  return {F:r[0]**2+r[1]**2+r[2]**2, r, J:Jm};
}
function solve(dvec, Kstart, {activeSet=false, gtol=0, lo=0, hi=4, trace=false}={}) {
  const clip=v=>v<lo?lo:v>hi?hi:v; const Db=read(P,Bv);
  let x=mv(inv3(Kstart), dvec.map((v,k)=>v-Db[k])).map(clip), ev=evalF(x,dvec,true), mu=1e-3, it=0, passes=1;
  if(trace) console.log(0, x.map(v=>v.toFixed(4)).join(' '), Math.sqrt(ev.F).toExponential(2), mu.toExponential(1));
  for(;it<50 && ev.F>1e-12; it++){
    const Jm=ev.J, r=ev.r; const A=[0,1,2].map(i=>[0,1,2].map(j=>Jm[0][i]*Jm[0][j]+Jm[1][i]*Jm[1][j]+Jm[2][i]*Jm[2][j]));
    let g=[0,1,2].map(j=>Jm[0][j]*r[0]+Jm[1][j]*r[1]+Jm[2][j]*r[2]);
    let act=[false,false,false];
    if(activeSet){ act=x.map((v,j)=>(v<=lo&&g[j]>0)||(v>=hi&&g[j]<0)); if(Math.max(...g.map((v,j)=>act[j]?0:Math.abs(v)))<gtol) break; g=g.map((v,j)=>act[j]?0:v); }
    let improved=false, tries=0;
    for(;tries<12&&!improved;tries++){
      const Bm=A.map((row,i)=>row.map((v,j)=> i===j? v+mu*(1+A[i][i]) : v));
      for(let j=0;j<3;j++) if(act[j]) for(let k=0;k<3;k++){ Bm[j][k]=j===k?1:0; Bm[k][j]=j===k?1:0; }
      const st=mv(inv3(Bm), g); const y=x.map((v,k)=>clip(v-st[k])); const e1=evalF(y,dvec,false); passes++;
      if(e1.F<ev.F){ x=y; mu=Math.max(mu/3,1e-12); improved=true; ev=evalF(x,dvec,true); passes++; } else mu*=4;
    }
    if(trace) console.log(it+1, x.map(v=>v.toFixed(4)).join(' '), Math.sqrt(ev.F).toExponential(2), mu.toExponential(1), tries);
    if(!improved) break;
  }
  return {x, res:Math.sqrt(ev.F), it, passes};
}
const dg = read(white, spec(cx, B0));
console.log('exact grey c', cx.map(v=>v.toFixed(4)), 'white d', dg.map(v=>v.toFixed(4)));
console.log('--- secant start trace'); const s1 = solve(dg, secant(white), {trace:true}); console.log('passes', s1.passes);
console.log('--- base-weighted start trace'); const s2 = solve(dg, tangent(pb, new Array(n).fill(0)), {trace:true}); console.log('passes', s2.passes);
const Db2 = read(white, B0); const sh = [0.02,0.35,0.45].map((v,k)=>v+Db2[k]);
for (const as of [false,true]) { const r = solve(sh, secant(white), {activeSet:as, gtol:1e-9}); console.log('shadow activeSet', as, 'c', r.x.map(v=>v.toFixed(4)), 'res', r.res.toFixed(5), 'it', r.it, 'passes', r.passes); }
for (const as of [false,true]) { const r = solve(sh, tangent(pb, new Array(n).fill(0)), {activeSet:as, gtol:1e-9}); console.log('shadow bw-start activeSet', as, 'res', r.res.toFixed(5), 'it', r.it, 'passes', r.passes); }
console.log('K secant 4dp', secant(white).map(r=>r.map(v=>v.toFixed(4)).join(' ')).join(' | '));
console.log('K tangent 4dp', tangent(white,new Array(n).fill(0)).map(r=>r.map(v=>v.toFixed(4)).join(' ')).join(' | '));
console.log('J grey 4dp', tangent(white, spec(cx,B0)).map(r=>r.map(v=>v.toFixed(4)).join(' ')).join(' | '));
