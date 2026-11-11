// Independent check of textbook §2.3 numbers on Chromogen's Portra 400 data (spektrafilm curves).
const fs = require('fs');
const st = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).data;
const le = st.log_exposure, N = le.length;
const raw = [0,1,2].map(j => st.density_curves.map(r => r[j]));
const f = raw.map(c => { const m = Math.min(...c); return c.map(v => v - m); });       // develop(): subtract min
const M = [[0.336,0.353,0.302],[0.154,0.319,0.353],[0.168,0.226,0.273]];            // donor rows, receiver cols
const interp = (x, xp, fp) => { if (x <= xp[0]) return fp[0]; if (x >= xp[xp.length-1]) return fp[fp.length-1]; let lo=0, hi=xp.length-1; while (hi-lo>1){const m=(lo+hi)>>1; if(xp[m]<=x) lo=m; else hi=m;} const t=(x-xp[lo])/(xp[hi]-xp[lo]); return fp[lo]+t*(fp[hi]-fp[lo]); };
// f0_j(t - sum_k M_kj f_k(t)) = f_j(t)  ->  f0_j = interp(le, le - (f@M)_j, f_j)
const shifted = [0,1,2].map(j => le.map((x,i) => x - (f[0][i]*M[0][j] + f[1][i]*M[1][j] + f[2][i]*M[2][j])));
const f0 = [0,1,2].map(j => le.map(x => interp(x, shifted[j], f[j])));
const F = (j,x) => interp(x, le, f[j]), F0 = (j,x) => interp(x, le, f0[j]);
const film = (u) => { const d0 = [0,1,2].map(j => F(j,u[j])); const a = [0,1,2].map(m => d0[0]*M[0][m]+d0[1]*M[1][m]+d0[2]*M[2][m]); return [0,1,2].map(j => F0(j, u[j]-a[j])); };
const g = [0,0,0]; const d0 = [0,1,2].map(j=>F(j,0));
console.log('f(0)', d0.map(v=>v.toFixed(4)), 'a', [0,1,2].map(m => (d0[0]*M[0][m]+d0[1]*M[1][m]+d0[2]*M[2][m]).toFixed(3)));
console.log('film(0)', film(g).map(v=>v.toFixed(4)));
const h = 0.05, J = [0,1,2].map(i => [0,1,2].map(j => { const up=[0,0,0], dn=[0,0,0]; up[j]=h; dn[j]=-h; return (film(up)[i]-film(dn)[i])/(2*h); }));
console.log('J(0)', J.map(r=>r.map(v=>v.toFixed(3)).join(' ')).join(' | '), 'row sums', J.map(r=>(r[0]+r[1]+r[2]).toFixed(3)));
const sl = [0,1,2].map(j => (F(j,0.1)-F(j,-0.1))/0.2); console.log('datasheet slopes ±0.1', sl.map(v=>v.toFixed(3)));
// neutral ramp reproduction
let worst = 0; for (let t=-2.5; t<=3.0001; t+=0.05) { const d = film([t,t,t]); for (let j=0;j<3;j++) worst = Math.max(worst, Math.abs(d[j]-F(j,t))); }
console.log('neutral ramp max |couple(t1) - f(t)|', worst.toFixed(4));
// red ramp with G,B in toe at -1.5
const red = film([1,-1.5,-1.5]); console.log('u=(+1,-1.5,-1.5) magenta', red[1].toFixed(4));
// parametric magenta (gamma 0.501, x0 -1.41, D 1.79, t .34, s .45), dmin 0
const sp=(x,s)=>s*Math.log10(1+Math.pow(10,x/s)); const pf=(x)=>0.501*sp(x+1.41,0.34)-0.501*sp(x+1.41-1.79/0.501,0.45);
const L=(u)=>1/(1+Math.pow(10,-u)); const pd=(x)=>0.501*(L((x+1.41)/0.34)-L((x+1.41-1.79/0.501)/0.45));
console.log('parametric magenta f(0)', pf(0).toFixed(4), "f'(0)", pd(0).toFixed(4), 'table f(0)', F(1,0).toFixed(4), 'table slope', sl[1].toFixed(3));
