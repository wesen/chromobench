
var process = globalThis.process && globalThis.process.versions && globalThis.process.versions.node ? globalThis.process : (globalThis.process = { _cwd: '/', cwd() { return this._cwd; }, chdir(d) { this._cwd = d; }, env: {}, versions: {} });
(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // src/shims/path.js
  var require_path = __commonJS({
    "src/shims/path.js"(exports, module) {
      "use strict";
      var norm = (p) => {
        const abs = p.startsWith("/"), out = [];
        for (const s of p.split("/")) {
          if (!s || s === ".") continue;
          if (s === "..") {
            if (out.length && out[out.length - 1] !== "..") out.pop();
            else if (!abs) out.push("..");
          } else out.push(s);
        }
        return (abs ? "/" : "") + out.join("/") || (abs ? "/" : ".");
      };
      var cwd = () => globalThis.process && globalThis.process.cwd ? globalThis.process.cwd() : "/";
      var resolve = (...ps) => {
        let r = "";
        for (let i = ps.length - 1; i >= 0 && !r.startsWith("/"); i--) {
          const p = String(ps[i]);
          if (p) r = r ? p + "/" + r : p;
        }
        if (!r.startsWith("/")) r = cwd() + "/" + r;
        return norm(r);
      };
      var join = (...ps) => norm(ps.filter((p) => p !== "").join("/"));
      var dirname = (p) => {
        const n2 = norm(p), i = n2.lastIndexOf("/");
        return i < 0 ? "." : i === 0 ? "/" : n2.slice(0, i);
      };
      var basename = (p, ext) => {
        const b = norm(p).split("/").pop();
        return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b;
      };
      var extname = (p) => {
        const b = basename(p), i = b.lastIndexOf(".");
        return i <= 0 ? "" : b.slice(i);
      };
      var relative = (from, to) => {
        const a = resolve(from).split("/").filter(Boolean), b = resolve(to).split("/").filter(Boolean);
        let i = 0;
        while (i < a.length && i < b.length && a[i] === b[i]) i++;
        return a.slice(i).map(() => "..").concat(b.slice(i)).join("/");
      };
      module.exports = { resolve, join, dirname, basename, extname, relative, normalize: norm, isAbsolute: (p) => p.startsWith("/"), sep: "/", delimiter: ":", posix: null };
      module.exports.posix = module.exports;
    }
  });

  // src/shims/fs.js
  var require_fs = __commonJS({
    "src/shims/fs.js"(exports, module) {
      "use strict";
      var files = /* @__PURE__ */ new Map();
      var norm = (p) => require_path().resolve(String(p));
      var enoent = (p) => Object.assign(new Error(`ENOENT: no such file or directory, '${p}'`), { code: "ENOENT" });
      var isDir = (p) => {
        const pre = p.endsWith("/") ? p : p + "/";
        for (const k of files.keys()) if (k.startsWith(pre)) return true;
        return false;
      };
      module.exports = {
        files,
        existsSync: (p) => {
          p = norm(p);
          return files.has(p) || isDir(p);
        },
        statSync: (p) => {
          p = norm(p);
          if (files.has(p)) return { isFile: () => true, isDirectory: () => false, size: files.get(p).length };
          if (isDir(p)) return { isFile: () => false, isDirectory: () => true, size: 0 };
          throw enoent(p);
        },
        readFileSync: (p) => {
          p = norm(p);
          if (!files.has(p)) throw enoent(p);
          return files.get(p);
        },
        writeFileSync: (p, s) => {
          files.set(norm(p), String(s));
        },
        mkdirSync: () => {
        },
        readdirSync: (p) => {
          p = norm(p);
          const pre = p.endsWith("/") ? p : p + "/", out = /* @__PURE__ */ new Set();
          for (const k of files.keys()) if (k.startsWith(pre)) out.add(k.slice(pre.length).split("/")[0]);
          return [...out].sort();
        },
        unlinkSync: (p) => {
          files.delete(norm(p));
        },
        // the workbench's own helpers
        put: (p, s) => files.set(norm(p), s),
        clear: (prefix) => {
          for (const k of [...files.keys()]) if (k.startsWith(prefix)) files.delete(k);
        },
        list: (prefix = "/") => [...files.keys()].filter((k) => k.startsWith(prefix)).sort()
      };
    }
  });

  // ../chromogen/src/units.js
  var require_units = __commonJS({
    "../chromogen/src/units.js"(exports, module) {
      "use strict";
      var LOG2 = Math.log10(2);
      var UNITS = /* @__PURE__ */ new Set(["D", "logH", "EV", "nm", "um", "mm", "c/mm", "K", "ratio", "e"]);
      var Quantity = class _Quantity {
        constructor(value, unit) {
          if (!UNITS.has(unit)) throw new Error(`unit: unknown unit "${unit}"`);
          this.value = value;
          this.unit = unit;
          Object.freeze(this);
        }
        to(unit) {
          if (unit === this.unit) return this;
          if (this.unit === "EV" && unit === "logH") return new _Quantity(this.value * LOG2, "logH");
          if (this.unit === "mm" && unit === "um") return new _Quantity(this.value * 1e3, "um");
          if (this.unit === "um" && unit === "mm") return new _Quantity(this.value / 1e3, "mm");
          throw new Error(`unit: cannot convert ${this.unit} to ${unit}${this.unit === "D" || unit === "D" ? " (only a characteristic curve maps between density and log exposure)" : ""}`);
        }
        add(q) {
          q = quantity(q);
          if (q.unit === this.unit) return new _Quantity(this.value + q.value, this.unit);
          if (this.unit === "logH" && q.unit === "EV" || this.unit === "EV" && q.unit === "logH") return new _Quantity(this.to("logH").value + q.to("logH").value, "logH");
          throw new Error(`unit: cannot add ${q.unit} to ${this.unit}${q.unit === "D" && this.unit === "logH" || q.unit === "logH" && this.unit === "D" ? ": a density offset is not a log-exposure shift (Hunt 14.17)" : ""}`);
        }
        sub(q) {
          q = quantity(q);
          return this.add(new _Quantity(-q.value, q.unit));
        }
        scale(k) {
          if (typeof k !== "number") throw new Error("unit: scale by a plain number");
          return new _Quantity(this.value * k, this.unit);
        }
        toString() {
          return `${+this.value.toFixed(6)} ${this.unit}`;
        }
        toJSON() {
          return this.toString();
        }
      };
      function quantity(x, expect) {
        if (x instanceof Quantity) return expect ? x.to(expect) : x;
        if (typeof x === "number") return expect && expect !== "ratio" ? new Quantity(x, expect) : new Quantity(x, "ratio");
        if (typeof x !== "string") throw new Error(`unit: cannot read a quantity from ${JSON.stringify(x)}`);
        const m = x.trim().match(/^([+-]?\d*\.?\d+(?:e[+-]?\d+)?)\s*(D|logH|EV|nm|um|µm|mm|c\/mm|K|%|e)?$/i);
        if (!m) throw new Error(`unit: cannot read "${x}" as a quantity`);
        let v = parseFloat(m[1]), u = m[2] || "ratio";
        if (u === "µm") u = "um";
        if (u === "%") {
          v /= 100;
          u = "ratio";
        }
        if (/^ev$/i.test(u)) u = "EV";
        if (/^logh$/i.test(u)) u = "logH";
        const q = new Quantity(v, u);
        return expect ? q.to(expect) : q;
      }
      var num = (x, unit) => quantity(x, unit).value;
      module.exports = {
        Quantity,
        quantity,
        num,
        LOG2,
        D: (v) => new Quantity(v, "D"),
        logH: (v) => new Quantity(v, "logH"),
        ev: (v) => new Quantity(v, "EV"),
        nm: (v) => new Quantity(v, "nm"),
        um: (v) => new Quantity(v, "um"),
        mm: (v) => new Quantity(v, "mm"),
        cmm: (v) => new Quantity(v, "c/mm"),
        K: (v) => new Quantity(v, "K")
      };
    }
  });

  // ../chromogen/src/spectrum.js
  var require_spectrum = __commonJS({
    "../chromogen/src/spectrum.js"(exports, module) {
      "use strict";
      var fs = require_fs();
      var path = require_path();
      var { num } = require_units();
      var Grid = class {
        constructor(start = 380, stop = 780, step = 5) {
          this.start = start;
          this.stop = stop;
          this.step = step;
          this.n = Math.round((stop - start) / step) + 1;
          this.wl = Float64Array.from({ length: this.n }, (_, i) => start + i * step);
          Object.freeze(this);
        }
        key() {
          return `${this.start}:${this.stop}:${this.step}`;
        }
      };
      var GRID = new Grid();
      var KINDS = /* @__PURE__ */ new Set(["power", "reflectance", "transmittance", "density", "responsivity"]);
      var Spectrum = class _Spectrum {
        constructor(values, kind = "power", grid = GRID) {
          if (!KINDS.has(kind)) throw new Error(`kind: unknown spectrum kind "${kind}"`);
          if (values.length !== grid.n) throw new Error(`kind: ${values.length} values for a grid of ${grid.n}`);
          this.grid = grid;
          this.kind = kind;
          this.values = Float64Array.from(values);
          Object.freeze(this);
        }
        map(f, kind = this.kind) {
          return new _Spectrum(this.values.map(f), kind, this.grid);
        }
        mul(s) {
          if (this.kind === "density" || s.kind === "density") throw new Error("kind: densities add; multiply transmittances instead");
          const kind = this.kind === "transmittance" && s.kind === "transmittance" ? "transmittance" : this.kind === "power" || s.kind === "power" ? "power" : this.kind === "responsivity" || s.kind === "responsivity" ? "responsivity" : this.kind;
          return new _Spectrum(this.values.map((v, i) => v * s.values[i]), kind, this.grid);
        }
        add(s) {
          if (this.kind !== "density" || s.kind !== "density") {
            if (this.kind === "transmittance" || s.kind === "transmittance") throw new Error("kind: transmittances multiply; add densities instead");
            if (this.kind !== s.kind) throw new Error(`kind: cannot add ${s.kind} to ${this.kind}`);
          }
          return new _Spectrum(this.values.map((v, i) => v + s.values[i]), this.kind, this.grid);
        }
        scale(k) {
          return new _Spectrum(this.values.map((v) => v * k), this.kind, this.grid);
        }
        toDensity() {
          return new _Spectrum(this.values.map((t) => -Math.log10(Math.max(t, 1e-8))), "density", this.grid);
        }
        toTransmittance() {
          return new _Spectrum(this.values.map((d) => Math.pow(10, -d)), "transmittance", this.grid);
        }
        sum() {
          let s = 0;
          for (const v of this.values) s += v;
          return s;
        }
        at(nm) {
          const i = Math.round((nm - this.grid.start) / this.grid.step);
          return this.values[i];
        }
        peak() {
          let k = 0;
          for (let i = 1; i < this.values.length; i++) if (this.values[i] > this.values[k]) k = i;
          return this.grid.wl[k];
        }
      };
      var interp = (xs, ys, x, left = 0, right = 0) => {
        if (x < xs[0]) return left;
        if (x > xs[xs.length - 1]) return right;
        let lo = 0, hi = xs.length - 1;
        while (hi - lo > 1) {
          const m = lo + hi >> 1;
          if (xs[m] <= x) lo = m;
          else hi = m;
        }
        const t = xs[hi] === xs[lo] ? 0 : (x - xs[lo]) / (xs[hi] - xs[lo]);
        return ys[lo] + t * (ys[hi] - ys[lo]);
      };
      var table = (wl, values, kind = "power", grid = GRID) => new Spectrum(Array.from(grid.wl, (w) => interp(wl, values, w)), kind, grid);
      function blackbody(T, grid = GRID) {
        T = num(T, "K");
        const c1 = 3741771852e-25, c2 = 0.01438776877;
        const p = (w) => {
          const l = w * 1e-9;
          return c1 / Math.pow(l, 5) / (Math.exp(c2 / (l * T)) - 1);
        };
        const ref = p(560);
        return new Spectrum(Array.from(grid.wl, (w) => p(w) / ref), "power", grid);
      }
      function gaussian(centre, fwhm, peak = 1, kind = "power", grid = GRID) {
        const mu = num(centre, "nm");
        const [fl, fr] = Array.isArray(fwhm) ? fwhm.map((f) => num(f, "nm")) : [num(fwhm, "nm"), num(fwhm, "nm")];
        const sl = fl / 2.3548, sr = fr / 2.3548;
        return new Spectrum(Array.from(grid.wl, (w) => peak * Math.exp(-0.5 * Math.pow((w - mu) / (w < mu ? sl : sr), 2))), kind, grid);
      }
      function sigmoid([c0, c1, c2], grid = GRID) {
        return new Spectrum(Array.from(grid.wl, (w) => {
          const x = (w - 380) / 400, u = c0 * x * x + c1 * x + c2;
          return 0.5 + u / (2 * Math.sqrt(1 + u * u));
        }), "reflectance", grid);
      }
      var flat = (v, kind = "reflectance", grid = GRID) => new Spectrum(new Array(grid.n).fill(v), kind, grid);
      var CMF = /* @__PURE__ */ new Map();
      function cmf(grid = GRID) {
        if (CMF.has(grid.key())) return CMF.get(grid.key());
        const g = (x2, mu, s1, s2) => Math.exp(-0.5 * Math.pow((x2 - mu) / (x2 < mu ? s1 : s2), 2));
        const x = [], y = [], z = [];
        for (const w of grid.wl) {
          x.push(1.056 * g(w, 599.8, 37.9, 31) + 0.362 * g(w, 442, 16, 26.7) - 0.065 * g(w, 501.1, 20.4, 26.2));
          y.push(0.821 * g(w, 568.8, 46.9, 40.5) + 0.286 * g(w, 530.9, 16.3, 31.1));
          z.push(1.217 * g(w, 437, 11.8, 36) + 0.681 * g(w, 459, 26, 13.8));
        }
        const out = { X: new Spectrum(x, "responsivity", grid), Y: new Spectrum(y, "responsivity", grid), Z: new Spectrum(z, "responsivity", grid) };
        CMF.set(grid.key(), out);
        return out;
      }
      function xyz(reflectance, light) {
        const c = cmf(reflectance.grid);
        let X = 0, Y = 0, Z = 0, k = 0;
        for (let i = 0; i < reflectance.grid.n; i++) {
          const s = light.values[i], r = reflectance.values[i];
          X += s * r * c.X.values[i];
          Y += s * r * c.Y.values[i];
          Z += s * r * c.Z.values[i];
          k += s * c.Y.values[i];
        }
        return [X / k, Y / k, Z / k];
      }
      function fromSpec(spec, { base = process.cwd(), kind = "power", grid = GRID } = {}) {
        if (spec instanceof Spectrum) return spec;
        if (typeof spec === "string") spec = { use: spec };
        switch (spec.use) {
          case "table": {
            if (spec.file) {
              const [file, key] = spec.file.split("#");
              const j = JSON.parse(fs.readFileSync(resolveData(file, base), "utf8"));
              return table(j.wl, key ? j[key] : j.values, j.kind || kind, grid);
            }
            return table(spec.wl, spec.values, spec.kind || kind, grid);
          }
          case "blackbody":
            return blackbody(spec.T, grid);
          case "daylight":
            throw new Error("field: daylight needs the CIE S0, S1, S2 tables, which the prototype does not ship; use blackbody");
          case "gaussian":
            return gaussian(spec.centre, spec.fwhm, spec.peak == null ? 1 : spec.peak, kind, grid);
          case "sum":
            return spec.of.map((s) => fromSpec(s, { base, kind, grid }).scale(s.weight == null ? 1 : s.weight)).reduce((a, b) => a.add(b));
          case "sigmoid":
            return sigmoid(spec.coefficients, grid);
          default:
            throw new Error(`field: unknown spectrum strategy "${spec.use}"`);
        }
      }
      var DATA = path.join("/cg/src", "..", "data");
      function resolveData(file, base) {
        for (const p of [path.resolve(base, file), path.join(DATA, file)]) if (fs.existsSync(p)) return p;
        throw new Error(`field: file not found: ${file}`);
      }
      module.exports = { Grid, GRID, Spectrum, table, blackbody, gaussian, sigmoid, flat, cmf, xyz, fromSpec, interp, resolveData, DATA };
    }
  });

  // ../chromogen/src/stock.js
  var require_stock = __commonJS({
    "../chromogen/src/stock.js"(exports, module) {
      "use strict";
      var fs = require_fs();
      var path = require_path();
      var { Spectrum, GRID, interp, DATA } = require_spectrum();
      var { num, LOG2 } = require_units();
      var Curve = class _Curve {
        constructor(logH, D) {
          const d = Float64Array.from(D);
          for (let i = 1; i < d.length; i++) if (d[i] <= d[i - 1]) d[i] = d[i - 1] + 1e-9;
          this.logH = Float64Array.from(logH);
          this.D = d;
          Object.freeze(this);
        }
        at(x) {
          return interp(this.logH, this.D, x, this.D[0], this.D[this.D.length - 1]);
        }
        inverse(y) {
          return interp(this.D, this.logH, y, this.logH[0], this.logH[this.logH.length - 1]);
        }
        slope(x, h = 1e-3) {
          return (this.at(x + h) - this.at(x - h)) / (2 * h);
        }
        shift(dx) {
          return new _Curve(this.logH.map((v) => v + dx), this.D);
        }
        scaleGamma(g, about = 0) {
          const d0 = this.at(about);
          return new _Curve(this.logH, this.D.map((v) => d0 + g * (v - d0)));
        }
      };
      function parametric({ gamma, speed = 0, dmin = 0, dmax, toe = 0.3, shoulder = 0.3 }) {
        const sp = (x, s) => s * Math.log10(1 + Math.pow(10, x / s));
        const xs = Array.from({ length: 256 }, (_, i) => -3 + 7 * i / 255);
        return new Curve(xs, xs.map((x) => dmin + gamma * sp(x - speed, toe) - gamma * sp(x - speed - dmax / gamma, shoulder)));
      }
      var Stock = class _Stock {
        constructor(o) {
          Object.assign(this, o);
          Object.freeze(this);
        }
        spectral(c) {
          const v = this.base.values.map((b, i) => b + c[0] * this.dyes[0].values[i] + c[1] * this.dyes[1].values[i] + c[2] * this.dyes[2].values[i]);
          return new Spectrum(v, "density", this.base.grid);
        }
        develop(logH) {
          return logH.map((x, i) => this.curves[i].at(x));
        }
        with(o) {
          return new _Stock(Object.assign({}, this, o));
        }
      };
      var cache2 = /* @__PURE__ */ new Map();
      function load(name, { base = process.cwd() } = {}) {
        if (cache2.has(name)) return cache2.get(name);
        const candidates = [path.resolve(base, name), path.resolve(base, name + ".json"), path.join(DATA, "stocks", name + ".json")];
        const file = candidates.find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
        if (!file) throw new Error(`field: unknown stock "${name}" (looked in ${candidates.map((p) => path.relative(process.cwd(), p)).join(", ")})`);
        const j = JSON.parse(fs.readFileSync(file, "utf8"));
        const d = j.data, wl = d.wavelengths;
        if (wl.length !== GRID.n || wl[0] !== GRID.start) throw new Error(`field: stock ${name} is not on the 380–780 nm, 5 nm grid`);
        const col = (rows, i) => rows.map((r) => r[i] == null ? NaN : r[i]);
        const sensitivity = [0, 1, 2].map((i) => new Spectrum(col(d.log_sensitivity, i).map((v) => Number.isFinite(v) ? Math.pow(10, v) : 0), "responsivity"));
        const dyes = { unit: [0, 1, 2].map((i) => new Spectrum(col(d.channel_density, i).map((v) => Number.isFinite(v) ? v : 0), "density")) };
        const s = new Stock({
          name: j.info.stock,
          title: j.info.name,
          type: j.info.type,
          densitometer: j.info.densitometer,
          licence: j.metadata.license,
          sensitivity,
          dyes: dyes.unit,
          base: new Spectrum(d.base_density.map((v) => v || 0), "density"),
          curves: [0, 1, 2].map((i) => new Curve(d.log_exposure, col(d.density_curves, i))),
          unitDyes: dyes
        });
        cache2.set(name, s);
        return s;
      }
      function developed(stock, develop = {}) {
        if (!develop || !develop.push && !develop.gamma && !develop.speed) return stock;
        const push = develop.push ? num(develop.push, "EV") : 0;
        const g = develop.gamma != null ? develop.gamma : 1 + 0.12 * push;
        const sh = develop.speed != null ? num(develop.speed, "logH") : -push * LOG2;
        return stock.with({ curves: stock.curves.map((c) => c.scaleGamma(g, 0).shift(sh)) });
      }
      module.exports = { Curve, Stock, load, parametric, developed };
    }
  });

  // ../chromogen/src/channels.js
  var require_channels = __commonJS({
    "../chromogen/src/channels.js"(exports, module) {
      "use strict";
      var fs = require_fs();
      var path = require_path();
      var { Spectrum, GRID, interp, fromSpec, DATA } = require_spectrum();
      var Channels = class {
        constructor(P, name = "channels", grid = GRID) {
          this.name = name;
          this.grid = grid;
          this.P = ["R", "G", "B"].map((k) => {
            const s = P[k];
            const tot = s.sum();
            return new Spectrum(s.values.map((v) => v / tot), "responsivity", grid);
          });
          Object.freeze(this);
        }
        // integral densities of a spectral density, relative to clear light
        read(D) {
          const T = D.values.map((d) => Math.pow(10, -d));
          return this.P.map((p) => {
            let s = 0;
            for (let i = 0; i < T.length; i++) s += p.values[i] * T[i];
            return -Math.log10(s);
          });
        }
        // mean transmittance per channel, for large-area densities
        transmittance(D) {
          return this.read(D).map((d) => Math.pow(10, -d));
        }
        analytical(dyes) {
          const unit = Array.isArray(dyes) ? dyes : dyes.dyes;
          return this.P.map((_, k) => unit.map((e) => this.read(e)[k]));
        }
        centroids() {
          return this.P.map((p) => {
            let s = 0, w = 0;
            p.values.forEach((v, i) => {
              s += v * p.grid.wl[i];
              w += v;
            });
            return s / w;
          });
        }
        peaks() {
          return this.P.map((p) => p.peak());
        }
      };
      var SM = {
        R: { 620: 2.109, 630: 4.479, 640: 5, 650: 4.899, 660: 4.578, 670: 4.252, 680: 3.875, 690: 3.491, 700: 3.099, 710: 2.687, 720: 2.269, 730: 1.859, 740: 1.449, 750: 1.054, 760: 0.654, 770: 0.254 },
        G: { 470: 1.152, 480: 2.207, 490: 3.156, 500: 3.804, 510: 4.272, 520: 4.626, 530: 4.872, 540: 5, 550: 4.995, 560: 4.818, 570: 4.458, 580: 3.915, 590: 3.172, 600: 2.239, 610: 1.07 },
        B: { 410: 2.103, 420: 4.111, 430: 4.632, 440: 4.871, 450: 5, 460: 4.955, 470: 4.743, 480: 4.343, 490: 3.743, 500: 2.99, 510: 1.852 }
      };
      function statusM(grid = GRID) {
        const P = {};
        for (const k of "RGB") {
          const xs = Object.keys(SM[k]).map(Number).sort((a, b) => a - b), ys = xs.map((x) => SM[k][x]);
          P[k] = new Spectrum(Array.from(grid.wl, (w) => w < xs[0] || w > xs[xs.length - 1] ? 0 : Math.pow(10, interp(xs, ys, w) - 5)), "responsivity", grid);
        }
        return new Channels(P, "status-m", grid);
      }
      function apd(grid = GRID) {
        const rows = fs.readFileSync(path.join(DATA, "channels", "apd.txt"), "utf8").split("\n").map((l) => l.trim()).filter((l) => /^\d/.test(l)).map((l) => l.split(/\s+/).slice(0, 4).map(Number));
        const wl = rows.map((r) => r[0]);
        const P = {};
        ["R", "G", "B"].forEach((k, i) => {
          P[k] = new Spectrum(Array.from(grid.wl, (w) => interp(wl, rows.map((r) => r[i + 1]), w)), "responsivity", grid);
        });
        return new Channels(P, "apd", grid);
      }
      function printing({ paper, lamp }) {
        const P = {};
        ["R", "G", "B"].forEach((k, i) => {
          P[k] = lamp.mul(paper.sensitivity[i]);
        });
        return new Channels(P, `printing(${paper.name})`, lamp.grid);
      }
      function scanner(sc) {
        const P = {};
        for (const k of "RGB") P[k] = (sc.light[k] || sc.light).mul(sc.camera[k]);
        return new Channels(P, `scanner(${sc.name})`, sc.camera.R.grid);
      }
      function named(name) {
        if (name === "status-m") return statusM();
        if (name === "apd") return apd();
        throw new Error(`field: unknown channel set "${name}"`);
      }
      module.exports = { Channels, statusM, apd, printing, scanner, named, fromSpec };
    }
  });

  // ../chromogen/src/linalg.js
  var require_linalg = __commonJS({
    "../chromogen/src/linalg.js"(exports, module) {
      "use strict";
      var T = (A) => A[0].map((_, j) => A.map((r) => r[j]));
      var mul = (A, B) => A.map((r) => B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0)));
      var mulVec = (A, x) => A.map((r) => r.reduce((s, v, k) => s + v * x[k], 0));
      var det3 = (A) => A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
      function inv3(A) {
        const d = det3(A);
        if (Math.abs(d) < 1e-300) throw new Error("solve: singular 3×3");
        const c = (i, j) => {
          const r = [0, 1, 2].filter((x) => x !== i), s = [0, 1, 2].filter((x) => x !== j);
          return A[r[0]][s[0]] * A[r[1]][s[1]] - A[r[0]][s[1]] * A[r[1]][s[0]];
        };
        return [0, 1, 2].map((i) => [0, 1, 2].map((j) => ((i + j) % 2 ? -1 : 1) * c(j, i) / d));
      }
      var solve3 = (A, b) => mulVec(inv3(A), b);
      var norm2 = (r) => r.reduce((s, v) => s + v * v, 0);
      function lm(f, x0, { jac, lo = -Infinity, hi = Infinity, tol = 1e-12, maxIt = 50 } = {}) {
        const clip = (x2) => x2.map((v) => Math.min(hi, Math.max(lo, v)));
        const J = jac || ((x2) => {
          const r0 = f(x2), h = 1e-6;
          return r0.map((_, k) => x2.map((_2, j) => {
            const y = x2.slice();
            y[j] += h;
            return (f(y)[k] - r0[k]) / h;
          }));
        });
        let x = clip(x0), r = f(x), F = norm2(r), mu = 1e-3, it = 0;
        for (; it < maxIt && F > tol; it++) {
          const Jx = J(x), Jt = T(Jx), A = mul(Jt, Jx), g = mulVec(Jt, r);
          let improved = false;
          for (let tries = 0; tries < 12 && !improved; tries++) {
            const B = A.map((row, i) => row.map((v, j) => v + (i === j ? mu * (1 + A[i][i]) : 0)));
            let step;
            try {
              step = solve3(B, g.map((v) => -v));
            } catch (e) {
              mu *= 10;
              continue;
            }
            const x1 = clip(x.map((v, i) => v + step[i])), r1 = f(x1), F1 = norm2(r1);
            if (F1 < F) {
              x = x1;
              r = r1;
              F = F1;
              mu = Math.max(mu / 3, 1e-12);
              improved = true;
            } else mu *= 4;
          }
          if (!improved) break;
        }
        return { x, residual: Math.sqrt(F), iterations: it };
      }
      function minSingular(A) {
        let M = mul(T(A), A).map((r) => r.slice());
        for (let s = 0; s < 30; s++) {
          let p = 0, q = 1;
          for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) if (Math.abs(M[i][j]) > Math.abs(M[p][q])) {
            p = i;
            q = j;
          }
          if (Math.abs(M[p][q]) < 1e-15) break;
          const th = 0.5 * Math.atan2(2 * M[p][q], M[q][q] - M[p][p]), c = Math.cos(th), sn = Math.sin(th);
          const R = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
          R[p][p] = c;
          R[q][q] = c;
          R[p][q] = sn;
          R[q][p] = -sn;
          M = mul(mul(T(R), M), R);
        }
        return Math.sqrt(Math.max(0, Math.min(M[0][0], M[1][1], M[2][2])));
      }
      module.exports = { T, mul, mulVec, inv3, solve3, lm, norm2, minSingular };
    }
  });

  // ../chromogen/src/solve.js
  var require_solve = __commonJS({
    "../chromogen/src/solve.js"(exports, module) {
      "use strict";
      var { inv3, mulVec, lm, minSingular } = require_linalg();
      function makeSolver(channels, stock, { use = "spectral", lo = 0, hi = 4, tolerance = 1e-12, maxIterations = 50, stall = 0, activeSet = false, gtol = 0 } = {}) {
        const K2 = channels.analytical(stock.dyes), Kinv = inv3(K2), Dbase = channels.read(stock.base);
        const P = channels.P.map((p) => p.values), E = stock.dyes.map((e) => e.values), B = stock.base.values, n2 = B.length;
        const forward = (c) => {
          const T2 = new Float64Array(n2);
          for (let i = 0; i < n2; i++) T2[i] = Math.pow(10, -(B[i] + c[0] * E[0][i] + c[1] * E[1][i] + c[2] * E[2][i]));
          return { T: T2, D: P.map((p) => {
            let s = 0;
            for (let i = 0; i < n2; i++) s += p[i] * T2[i];
            return -Math.log10(s);
          }) };
        };
        const jac = (c) => {
          const { T: T2 } = forward(c);
          return P.map((p) => {
            let den = 0;
            const num = [0, 0, 0];
            for (let i = 0; i < n2; i++) {
              const w = p[i] * T2[i];
              den += w;
              num[0] += w * E[0][i];
              num[1] += w * E[1][i];
              num[2] += w * E[2][i];
            }
            return num.map((v) => v / den);
          });
        };
        const analytical = (d) => mulVec(Kinv, d.map((v, k) => v - Dbase[k]));
        const LN10 = Math.LN10, P0 = P[0], P1 = P[1], P2 = P[2], E0 = E[0], E1 = E[1], E2 = E[2];
        const T = new Float64Array(n2), J = new Float64Array(9), r = new Float64Array(3);
        const evalF = (c0, c1, c2, d, withJ) => {
          let s0 = 0, s1 = 0, s2 = 0, a00 = 0, a01 = 0, a02 = 0, a10 = 0, a11 = 0, a12 = 0, a20 = 0, a21 = 0, a22 = 0;
          for (let i = 0; i < n2; i++) {
            const t = Math.exp(-LN10 * (B[i] + c0 * E0[i] + c1 * E1[i] + c2 * E2[i])), w0 = P0[i] * t, w1 = P1[i] * t, w2 = P2[i] * t;
            s0 += w0;
            s1 += w1;
            s2 += w2;
            if (withJ) {
              const e0 = E0[i], e1 = E1[i], e2 = E2[i];
              a00 += w0 * e0;
              a01 += w0 * e1;
              a02 += w0 * e2;
              a10 += w1 * e0;
              a11 += w1 * e1;
              a12 += w1 * e2;
              a20 += w2 * e0;
              a21 += w2 * e1;
              a22 += w2 * e2;
            }
          }
          r[0] = -Math.log10(s0) - d[0];
          r[1] = -Math.log10(s1) - d[1];
          r[2] = -Math.log10(s2) - d[2];
          if (withJ) {
            J[0] = a00 / s0;
            J[1] = a01 / s0;
            J[2] = a02 / s0;
            J[3] = a10 / s1;
            J[4] = a11 / s1;
            J[5] = a12 / s1;
            J[6] = a20 / s2;
            J[7] = a21 / s2;
            J[8] = a22 / s2;
          }
          return r[0] * r[0] + r[1] * r[1] + r[2] * r[2];
        };
        const clip = (v) => v < lo ? lo : v > hi ? hi : v;
        const spectral = (d, { sigma = true } = {}) => {
          const start = analytical(d);
          let x0 = clip(start[0]), x1 = clip(start[1]), x2 = clip(start[2]), F = evalF(x0, x1, x2, d, true), mu = 1e-3, it = 0;
          for (; it < maxIterations && F > tolerance; it++) {
            const A00 = J[0] * J[0] + J[3] * J[3] + J[6] * J[6], A01_ = J[0] * J[1] + J[3] * J[4] + J[6] * J[7], A02_ = J[0] * J[2] + J[3] * J[5] + J[6] * J[8];
            const A11 = J[1] * J[1] + J[4] * J[4] + J[7] * J[7], A12_ = J[1] * J[2] + J[4] * J[5] + J[7] * J[8], A22 = J[2] * J[2] + J[5] * J[5] + J[8] * J[8];
            let g0 = J[0] * r[0] + J[3] * r[1] + J[6] * r[2], g1 = J[1] * r[0] + J[4] * r[1] + J[7] * r[2], g2 = J[2] * r[0] + J[5] * r[1] + J[8] * r[2];
            let a0 = false, a1 = false, a2 = false;
            if (activeSet) {
              a0 = x0 <= lo && g0 > 0 || x0 >= hi && g0 < 0;
              a1 = x1 <= lo && g1 > 0 || x1 >= hi && g1 < 0;
              a2 = x2 <= lo && g2 > 0 || x2 >= hi && g2 < 0;
              if (Math.max(a0 ? 0 : Math.abs(g0), a1 ? 0 : Math.abs(g1), a2 ? 0 : Math.abs(g2)) < gtol) break;
              if (a0) g0 = 0;
              if (a1) g1 = 0;
              if (a2) g2 = 0;
            }
            let improved = false;
            for (let tries = 0; tries < 12 && !improved; tries++) {
              let b00 = A00 + mu * (1 + A00), b11 = A11 + mu * (1 + A11), b22 = A22 + mu * (1 + A22), A01 = A01_, A02 = A02_, A12 = A12_;
              if (a0) {
                b00 = 1;
                A01 = 0;
                A02 = 0;
              }
              if (a1) {
                b11 = 1;
                A01 = 0;
                A12 = 0;
              }
              if (a2) {
                b22 = 1;
                A02 = 0;
                A12 = 0;
              }
              const det = b00 * (b11 * b22 - A12 * A12) - A01 * (A01 * b22 - A12 * A02) + A02 * (A01 * A12 - b11 * A02);
              if (!(Math.abs(det) > 1e-300)) {
                mu *= 10;
                continue;
              }
              const i00 = (b11 * b22 - A12 * A12) / det, i01 = (A02 * A12 - A01 * b22) / det, i02 = (A01 * A12 - A02 * b11) / det;
              const i11 = (b00 * b22 - A02 * A02) / det, i12 = (A01 * A02 - b00 * A12) / det, i22 = (b00 * b11 - A01 * A01) / det;
              const y0 = clip(x0 - (i00 * g0 + i01 * g1 + i02 * g2)), y1 = clip(x1 - (i01 * g0 + i11 * g1 + i12 * g2)), y2 = clip(x2 - (i02 * g0 + i12 * g1 + i22 * g2));
              const F1 = evalF(y0, y1, y2, d, false);
              if (F1 < F) {
                x0 = y0;
                x1 = y1;
                x2 = y2;
                mu = Math.max(mu / 3, 1e-12);
                improved = F - F1 > stall * F;
                F = evalF(x0, x1, x2, d, true);
                if (!improved) break;
              } else mu *= 4;
            }
            if (!improved) break;
          }
          const c = [x0, x1, x2];
          return { c, start, residual: Math.sqrt(F), iterations: it, sigmaMin: sigma ? minSingular(jac(c)) : null };
        };
        return {
          use,
          K: K2,
          Dbase,
          forward: (c) => forward(c).D,
          jac,
          residual: (c, d) => use === "analytical" ? NaN : Math.sqrt(evalF(clip(c[0]), clip(c[1]), clip(c[2]), d, false)),
          solve: (d, o) => use === "analytical" ? { c: analytical(d), start: null, residual: NaN, iterations: 0 } : spectral(d, o)
        };
      }
      module.exports = { makeSolver };
    }
  });

  // ../chromogen/src/print.js
  var require_print = __commonJS({
    "../chromogen/src/print.js"(exports, module) {
      "use strict";
      var { Spectrum, xyz } = require_spectrum();
      var { num, Quantity } = require_units();
      var { lm } = require_linalg();
      var Lights2 = class _Lights {
        constructor([R, G, B]) {
          this.R = R;
          this.G = G;
          this.B = B;
          Object.freeze(this);
        }
        get values() {
          return [this.R, this.G, this.B];
        }
        shift(o) {
          const v = this.values.slice();
          ["R", "G", "B"].forEach((k, i) => {
            if (o[k] != null) {
              const q = o[k] instanceof Quantity ? o[k] : null;
              if (q && q.unit !== "logH") throw new Error(`unit: printer lights are log exposures; cannot shift by ${q.unit}${q.unit === "D" ? " (a density offset is not a log-exposure shift, Hunt 14.17)" : ""}`);
              v[i] += q ? q.value : num(o[k], "logH");
            }
          });
          return new _Lights(v);
        }
        points() {
          return this.values.map((v) => v / 0.025);
        }
        toJSON() {
          return { R: +this.R.toFixed(4), G: +this.G.toFixed(4), B: +this.B.toFixed(4) };
        }
      };
      function makePrinter({ paper, lamp, viewing }) {
        const S = paper.sensitivity.map((s) => s.values), L = lamp.values, n2 = L.length;
        const logE = (Dneg, lights) => S.map((s, k) => {
          let t = 0;
          for (let i = 0; i < n2; i++) t += L[i] * Math.pow(10, -Dneg.values[i]) * s[i];
          return Math.log10(t) + lights[k];
        });
        const clear = S.map((s) => Math.log10(s.reduce((t, v, i) => t + L[i] * v, 0)));
        const logE0 = (Dneg) => logE(Dneg, [0, 0, 0]);
        const fromPD = (pd) => pd.map((d, k) => clear[k] - d);
        const white = xyz(new Spectrum(new Array(n2).fill(1), "reflectance"), viewing);
        const viewLogE = (le) => {
          const c = paper.develop(le), Dp = paper.spectral(c);
          const R = Dp.toTransmittance();
          const refl = new Spectrum(R.values, "reflectance");
          const X = xyz(refl, viewing), s = X[0] + X[1] + X[2];
          return { logE: le, c, D: Dp, reflectance: refl, XYZ: X, Yrel: X[1] / white[1], xy: [X[0] / s, X[1] / s], white };
        };
        const view = (Dneg, lights) => viewLogE(logE(Dneg, lights));
        const greyPatch = (D, reflectance = 0.184) => {
          const r = lm((Lt) => {
            const v = view(D, Lt);
            return [v.XYZ[0] / white[0] - reflectance, v.XYZ[1] / white[1] - reflectance, v.XYZ[2] / white[2] - reflectance];
          }, [0, 0, 0], { tol: 1e-20, maxIt: 100 });
          return new Lights2(r.x);
        };
        return { logE, logE0, clear, fromPD, view, viewLogE, greyPatch, white, paper, lamp, viewing };
      }
      function latd(printingChannels2, Ds) {
        const T = [0, 0, 0];
        for (const D of Ds) printingChannels2.transmittance(D).forEach((t, k) => {
          T[k] += t / Ds.length;
        });
        return T.map((t) => -Math.log10(t));
      }
      module.exports = { Lights: Lights2, makePrinter, latd };
    }
  });

  // ../chromogen/src/colour.js
  var require_colour = __commonJS({
    "../chromogen/src/colour.js"(exports, module) {
      "use strict";
      var D65 = [0.95047, 1, 1.08883];
      var BRADFORD = [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]];
      var BRADFORD_INV = [[0.9869929, -0.1470543, 0.1599627], [0.4323053, 0.5183603, 0.0492912], [-85287e-7, 0.0400428, 0.9684867]];
      var XYZ_TO_SRGB = [[3.2404542, -1.5371385, -0.4985314], [-0.969266, 1.8760108, 0.041556], [0.0556434, -0.2040259, 1.0572252]];
      var SRGB_TO_XYZ = [[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.072175], [0.0193339, 0.119192, 0.9503041]];
      var mv = (M, v) => [M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2], M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2], M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2]];
      function lab(X, white = D65) {
        const f = (t) => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
        const fx = f(X[0] / white[0]), fy = f(X[1] / white[1]), fz = f(X[2] / white[2]);
        return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
      }
      function deltaE2000(a, b) {
        const [L1, a1, b1] = a, [L2, a2, b2] = b, rad = Math.PI / 180;
        const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cm = (C1 + C2) / 2;
        const G = 0.5 * (1 - Math.sqrt(Math.pow(Cm, 7) / (Math.pow(Cm, 7) + Math.pow(25, 7))));
        const ap1 = (1 + G) * a1, ap2 = (1 + G) * a2, Cp1 = Math.hypot(ap1, b1), Cp2 = Math.hypot(ap2, b2);
        const hue = (x, y) => {
          if (x === 0 && y === 0) return 0;
          const h = Math.atan2(y, x) / rad;
          return h < 0 ? h + 360 : h;
        };
        const hp1 = hue(ap1, b1), hp2 = hue(ap2, b2);
        const dL = L2 - L1, dC = Cp2 - Cp1;
        let dh = 0;
        if (Cp1 * Cp2 !== 0) {
          dh = hp2 - hp1;
          if (dh > 180) dh -= 360;
          else if (dh < -180) dh += 360;
        }
        const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin(dh / 2 * rad);
        const Lm = (L1 + L2) / 2, Cpm = (Cp1 + Cp2) / 2;
        let hm = hp1 + hp2;
        if (Cp1 * Cp2 !== 0) {
          hm = Math.abs(hp1 - hp2) <= 180 ? hm / 2 : hm < 360 ? (hm + 360) / 2 : (hm - 360) / 2;
        }
        const T = 1 - 0.17 * Math.cos((hm - 30) * rad) + 0.24 * Math.cos(2 * hm * rad) + 0.32 * Math.cos((3 * hm + 6) * rad) - 0.2 * Math.cos((4 * hm - 63) * rad);
        const dTh = 30 * Math.exp(-Math.pow((hm - 275) / 25, 2));
        const RC = 2 * Math.sqrt(Math.pow(Cpm, 7) / (Math.pow(Cpm, 7) + Math.pow(25, 7)));
        const SL = 1 + 0.015 * Math.pow(Lm - 50, 2) / Math.sqrt(20 + Math.pow(Lm - 50, 2)), SC = 1 + 0.045 * Cpm, SH = 1 + 0.015 * Cpm * T;
        const RT = -Math.sin(2 * dTh * rad) * RC;
        return Math.sqrt(Math.pow(dL / SL, 2) + Math.pow(dC / SC, 2) + Math.pow(dH / SH, 2) + RT * (dC / SC) * (dH / SH));
      }
      function adapt(X, from, to = D65) {
        const s = mv(BRADFORD, from), d = mv(BRADFORD, to), c = mv(BRADFORD, X);
        return mv(BRADFORD_INV, [c[0] * d[0] / s[0], c[1] * d[1] / s[1], c[2] * d[2] / s[2]]);
      }
      var encode = (v) => v <= 31308e-7 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
      var decode = (v) => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      function toSRGB(X, white = D65, { linear = false, clip = true } = {}) {
        const rgb = mv(XYZ_TO_SRGB, white === D65 ? X : adapt(X, white, D65));
        return rgb.map((v) => {
          const c = clip ? Math.min(1, Math.max(0, v)) : v;
          return linear ? c : c < 0 ? -encode(-c) : encode(c);
        });
      }
      function fromSRGB(rgb, { linear = false } = {}) {
        return mv(SRGB_TO_XYZ, linear ? rgb : rgb.map(decode));
      }
      var chroma = (L) => Math.hypot(L[1], L[2]);
      var hex = (rgb) => "#" + rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("");
      module.exports = { D65, lab, deltaE2000, adapt, toSRGB, fromSRGB, encode, decode, chroma, hex, XYZ_TO_SRGB, SRGB_TO_XYZ };
    }
  });

  // src/spec.js
  var spec_exports = {};
  __export(spec_exports, {
    BY_ID: () => BY_ID,
    FILMS: () => FILMS,
    FINISHING: () => FINISHING,
    K: () => K,
    PT: () => PT,
    SCANNERS: () => SCANNERS,
    SECTIONS: () => SECTIONS,
    SLIDERS: () => SLIDERS,
    STOP: () => STOP,
    defaults: () => defaults
  });
  var PT = 0.025;
  var STOP = Math.log10(2);
  var K = {
    WARM_MIRED: 1.3,
    // mired per unit of Warmth: ±100 ≈ ±130 mired, 5500 K → 3200 K
    TINT_PT: 10,
    // points of green light (relative to red and blue) at Tint ±100
    SPLIT: 0.5,
    // shadow and highlight colour pads: fraction of the global Warmth/Tint scale
    SPLIT_SPAN: 0.4,
    // anchors of the pads: g ± 0.4 log H (shadows at more exposure)
    PREFLASH: 0.35,
    // flash exposure at 100, relative to the exposure 0.6 log H below grey
    FLARE_MAX: 4,
    // % viewing flare at Blacks 100
    HAL_R: 0.3,
    HAL_G: 0.08,
    // fraction of blurred film exposure added back in the red and green layers at Halation 100
    HAL_RADII: [4e-3, 0.018],
    // halation kernel: two Gaussians, σ as a fraction of the frame's long side
    GRAIN_SIGMA: 0.035,
    // dye-amount σ at c = 1 for Grain 100 at 1× size, on a 24 µm aperture (scaled by area)
    MASK: 0.6,
    // contrast-mask strength at 100: large-scale contrast × (1 − 0.6)
    MASK_RADIUS: 0.04,
    // edge-aware base radius, fraction of the long side
    MID_RADIUS: 8e-3,
    // clarity base radius
    FINE_RADIUS: 9e-4,
    // texture radius
    ZONE: 0.25,
    // highlights/shadows: largest base shift, density, at ±100
    CLARITY: 0.8,
    TEXTURE: 1.2,
    DYESAT: 0.6,
    // dye saturation factor s = 1 + 0.6·v/100
    VIBRANCE: 0.8,
    COLDENS: 0.35,
    ROLLOFF: 0.85,
    HUE_DEG: 30,
    // hue shift at ±100
    SHARP: 1.2,
    BLOOM: 0.6,
    GRAINRED: 1
  };
  var pct = (v) => `${v > 0 ? "+" : ""}${Math.round(v)}`;
  var sign = (v, d = 0) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}`;
  var SECTIONS = [
    { id: "print", title: "Print", kind: "macro", about: "Printer lights and the paper: everything here is a setting of the physical print." },
    { id: "film", title: "Paper and film", kind: "macro", about: "Choose the materials and their character; still physical." },
    { id: "roll", title: "Roll", kind: "macro", about: "Lights shared across frames." },
    { id: "tone", title: "Tone", kind: "operator", about: "Finishing: edge-aware tone operators in printing density." },
    { id: "colour", title: "Colour", kind: "operator", about: "Finishing: colour operators on the dyes and on the print." },
    { id: "detail", title: "Detail", kind: "operator", about: "Finishing: sharpness, grain reduction, bloom." }
  ];
  var SLIDERS = [
    // ---------------- Print: macros on printer lights and the print model
    {
      id: "exposure",
      label: "Exposure",
      section: "print",
      kind: "macro",
      domain: "paper log H",
      cost: "free",
      unit: "stops",
      min: -3,
      max: 3,
      step: 0.05,
      def: 0,
      fmt: (v) => `${sign(v, 2)} st`,
      aside: (v) => `${sign(-v / STOP * STOP / PT, 0)} pt`,
      what: "Brighter or darker print: less or more printing exposure in all three layers.",
      maths: "x_k \\leftarrow x_k - 0.30103\\,e",
      chapter: 2
    },
    {
      id: "warmth",
      label: "Warmth",
      section: "print",
      kind: "macro",
      domain: "paper log H",
      cost: "free",
      unit: "",
      min: -100,
      max: 100,
      step: 1,
      def: 0,
      fmt: pct,
      aside: (v) => `${sign(v * K.WARM_MIRED, 0)} mired`,
      what: "Warmer or cooler, along the daylight locus: the lights a scene lit by a warmer or cooler source would need.",
      maths: "x \\leftarrow x - \\frac{\\partial PD_{grey}}{\\partial M}\\,(1.3\\,w),\\ \\text{mean removed}",
      chapter: 2
    },
    {
      id: "tint",
      label: "Tint",
      section: "print",
      kind: "macro",
      domain: "paper log H",
      cost: "free",
      unit: "",
      min: -100,
      max: 100,
      step: 1,
      def: 0,
      fmt: pct,
      aside: (v) => `${sign(v / 100 * K.TINT_PT, 1)} pt M`,
      what: "Magenta (+) or green (−): green light against red and blue.",
      maths: "x \\leftarrow x + 0.025\\cdot 10\\,\\tfrac{t}{100}\\,(-\\tfrac13, \\tfrac23, -\\tfrac13)",
      chapter: 2
    },
    {
      id: "autoColour",
      label: "Auto colour",
      section: "print",
      kind: "macro",
      domain: "paper log H",
      cost: "free",
      unit: "%",
      min: 0,
      max: 100,
      step: 1,
      def: 75,
      fmt: (v) => `${Math.round(v)} %`,
      what: "How much of the frame’s own colour cast integrate-to-grey removes (α); density is always balanced.",
      maths: "L_k = a_k + \\bar\\Delta + \\alpha(\\Delta_k - \\bar\\Delta)",
      chapter: 2
    },
    {
      id: "contrast",
      label: "Contrast",
      section: "print",
      kind: "macro",
      domain: "paper log H",
      cost: "free",
      unit: "×",
      min: 0.6,
      max: 1.6,
      step: 0.01,
      def: 1,
      fmt: (v) => `${v.toFixed(2)} ×`,
      what: "Paper contrast: the paper’s curves stretched or squeezed about mid-grey (a softer or harder paper).",
      maths: "x_k \\leftarrow g_k + \\gamma\\,(x_k - g_k)",
      chapter: 3
    },
    {
      id: "preflash",
      label: "Pre-flash",
      section: "print",
      kind: "macro",
      domain: "paper log H",
      cost: "free",
      unit: "",
      min: 0,
      max: 100,
      step: 1,
      def: 0,
      fmt: pct,
      what: "Flash the paper with uniform light: holds detail in near-whites by lifting them off the toe.",
      maths: "x_k \\leftarrow \\log_{10}\\!\\big(10^{x_k} + 0.35\\,\\tfrac{p}{100}\\,10^{g_k - 0.6}\\big)",
      chapter: 3
    },
    {
      id: "whites",
      label: "Whites",
      section: "print",
      kind: "hybrid",
      domain: "output",
      cost: "free",
      unit: "",
      min: -100,
      max: 100,
      step: 1,
      def: 0,
      fmt: pct,
      what: "Where white lands: 0 maps the paper’s white to display white; + brightens with a soft shoulder, − dims.",
      maths: "Y \\leftarrow \\frac{Y}{Y_{paper}}\\,2^{w/100},\\ \\text{soft shoulder above 1}",
      chapter: 3
    },
    {
      id: "blacks",
      label: "Blacks",
      section: "print",
      kind: "macro",
      domain: "print",
      cost: "free",
      unit: "% flare",
      min: 0,
      max: 100,
      step: 1,
      def: 12,
      fmt: (v) => `${(v / 100 * K.FLARE_MAX).toFixed(1)} %`,
      what: "Viewing flare: light reflected off the print’s surface and the room. 0 is a deep gloss black; more is matte.",
      maths: "XYZ \\leftarrow XYZ + \\tfrac{f}{100}\\,Y_w\\,(x_E/y_E,\\,1,\\,z_E/y_E)",
      chapter: 3
    },
    {
      id: "shadowColour",
      label: "Shadow colour",
      section: "print",
      kind: "macro",
      domain: "paper log H",
      cost: "free",
      type: "pad",
      def: [0, 0],
      min: -100,
      max: 100,
      fmt: (v) => `${pct(v[0])} / ${pct(v[1])}`,
      what: "A colour move that grows into the shadows: warmth (x) and tint (y). With Highlight colour it removes crossover.",
      maths: "\\Delta x(x) = U_s + \\frac{x - x_s}{x_h - x_s}(U_h - U_s)",
      chapter: 4
    },
    {
      id: "highlightColour",
      label: "Highlight colour",
      section: "print",
      kind: "macro",
      domain: "paper log H",
      cost: "free",
      type: "pad",
      def: [0, 0],
      min: -100,
      max: 100,
      fmt: (v) => `${pct(v[0])} / ${pct(v[1])}`,
      what: "The same for the highlights. Both together are a per-layer offset and slope: a paper whose layers differ in contrast.",
      maths: "x_s = g + 0.4,\\ x_h = g - 0.4",
      chapter: 4
    },
    // ---------------- Paper and film: materials and their character
    {
      id: "paper",
      label: "Paper",
      section: "film",
      kind: "macro",
      domain: "print",
      cost: "rebuild",
      type: "select",
      def: "kodak_portra_endura",
      options: [["kodak_portra_endura", "Kodak Portra Endura"], ["kodak_supra_endura", "Kodak Supra Endura"], ["fujifilm_crystal_archive_typeii", "Fujifilm Crystal Archive II"]],
      what: "The colour paper: its layers’ sensitivities, curves and dyes.",
      maths: "\\text{rebuilds } c\\to PD \\text{ and } c_p \\to XYZ",
      chapter: 3
    },
    {
      id: "reshoot",
      label: "Re-shoot on",
      section: "film",
      kind: "macro",
      domain: "dyes",
      cost: "rebuild",
      type: "select",
      def: "none",
      options: [["none", "the same film"], ["kodak_portra_160", "Kodak Portra 160"], ["kodak_portra_400", "Kodak Portra 400"], ["kodak_portra_800", "Kodak Portra 800"], ["kodak_ektar_100", "Kodak Ektar 100"], ["kodak_gold_200", "Kodak Gold 200"], ["kodak_ultramax_400", "Kodak UltraMax 400"], ["fujifilm_c200", "Fujifilm C200"], ["fujifilm_pro_400h", "Fujifilm Pro 400H"]],
      what: "Recover each layer’s exposure through this film’s curves, develop it on another film, print that.",
      maths: "c^B_k = f^B_k\\big(f^{A\\,-1}_k(c_k)\\big)",
      chapter: 5
    },
    {
      id: "reshootAmount",
      label: "Re-shoot amount",
      section: "film",
      kind: "hybrid",
      domain: "printing density",
      cost: "free",
      unit: "%",
      min: 0,
      max: 100,
      step: 1,
      def: 100,
      fmt: (v) => `${Math.round(v)} %`,
      what: "Blend of the two prints in printing density; only 0 and 100 are physical.",
      maths: "PD = (1-t)PD_A + t\\,PD_B",
      chapter: 5
    },
    {
      id: "halation",
      label: "Halation",
      section: "film",
      kind: "macro",
      domain: "film exposure",
      cost: "spatial",
      unit: "",
      min: 0,
      max: 100,
      step: 1,
      def: 0,
      fmt: pct,
      what: "Light scattered back from the film base re-exposes the red layer around bright areas: a red-orange glow.",
      maths: "E_R \\leftarrow E_R + 0.30\\,\\tfrac{h}{100}\\,(K * E_R)",
      chapter: 5
    },
    {
      id: "grain",
      label: "Grain",
      section: "film",
      kind: "hybrid",
      domain: "dyes",
      cost: "spatial",
      unit: "",
      min: 0,
      max: 100,
      step: 1,
      def: 0,
      fmt: pct,
      what: "Add dye-cloud grain per layer, growing with density; resolution-independent (it averages away when viewed small).",
      maths: "c_k \\leftarrow c_k + \\sigma_0\\sqrt{c_k + 0.05}\\;n_k(x)",
      chapter: 5
    },
    {
      id: "grainSize",
      label: "Grain size",
      section: "film",
      kind: "hybrid",
      domain: "dyes",
      cost: "spatial",
      unit: "×",
      min: 0.5,
      max: 3,
      step: 0.05,
      def: 1,
      fmt: (v) => `${v.toFixed(2)} ×`,
      what: "Size of the dye clouds; 1× is a 400-speed film.",
      maths: "\\sigma^2 \\propto G/A",
      chapter: 5
    },
    {
      id: "fade",
      label: "Fade",
      section: "film",
      kind: "macro",
      domain: "print dyes",
      cost: "rebuild",
      unit: "",
      min: 0,
      max: 100,
      step: 1,
      def: 0,
      fmt: pct,
      what: "An aged print: the paper’s dyes fade (cyan most) and the base yellows.",
      maths: "c_p \\leftarrow F\\,c_p,\\ b_p \\leftarrow b_p + \\phi\\,s(\\lambda)",
      chapter: 5
    },
    {
      id: "edgeBurn",
      label: "Edge burn",
      section: "film",
      kind: "macro",
      domain: "paper log H",
      cost: "free",
      unit: "pt",
      min: 0,
      max: 20,
      step: 0.5,
      def: 0,
      fmt: (v) => `${v.toFixed(1)} pt`,
      what: "Burn the corners and edges in, as a printer would: extra exposure through a radial falloff.",
      maths: "x \\leftarrow x + 0.025\\,b\\,m(r)",
      chapter: 5
    },
    {
      id: "skyBurn",
      label: "Sky burn",
      section: "film",
      kind: "macro",
      domain: "paper log H",
      cost: "free",
      unit: "pt",
      min: 0,
      max: 20,
      step: 0.5,
      def: 0,
      fmt: (v) => `${v.toFixed(1)} pt`,
      what: "Burn the top of the frame in through a soft gradient, the classic sky burn.",
      maths: "x \\leftarrow x + 0.025\\,b\\,m(y)",
      chapter: 5
    },
    // ---------------- Roll
    {
      id: "rollConsistency",
      label: "Roll consistency",
      section: "roll",
      kind: "macro",
      domain: "paper log H",
      cost: "free",
      unit: "%",
      min: 0,
      max: 100,
      step: 1,
      def: 0,
      fmt: (v) => `${Math.round(v)} %`,
      what: "Pull this frame’s automatic lights towards the roll’s mean lights.",
      maths: "L \\leftarrow (1-r)L_{frame} + r\\,\\bar L_{roll}",
      chapter: 9
    },
    {
      id: "matchAmount",
      label: "Match frame",
      section: "roll",
      kind: "macro",
      domain: "paper log H",
      cost: "free",
      unit: "%",
      min: 0,
      max: 100,
      step: 1,
      def: 0,
      fmt: (v) => `${Math.round(v)} %`,
      what: "Move the lights so this print’s average colour (and density) matches a reference frame’s print.",
      maths: "\\Delta L = -m\\,(\\bar x - \\bar x_{ref})",
      chapter: 9
    },
    // ---------------- Finishing: tone operators in printing density (scaled by Look strength)
    {
      id: "mask",
      label: "Contrast mask",
      section: "tone",
      kind: "operator",
      domain: "printing density",
      cost: "spatial",
      unit: "",
      min: -100,
      max: 100,
      step: 1,
      def: 0,
      fmt: pct,
      what: "The darkroom contrast mask: large areas move towards mid-grey while edges and detail keep their contrast. − does the opposite.",
      maths: "B' = B_{ref} + (1 - 0.6\\,\\tfrac{m}{100})(B - B_{ref}),\\ PD_k \\leftarrow PD_k + B' - B",
      chapter: 6
    },
    {
      id: "highlights",
      label: "Highlights",
      section: "tone",
      kind: "operator",
      domain: "printing density",
      cost: "spatial",
      unit: "",
      min: -100,
      max: 100,
      step: 1,
      def: 0,
      fmt: pct,
      what: "Recover (+) or brighten (−) bright areas, judged on the edge-aware base so edges keep their contrast.",
      maths: "B' = B - 0.25\\,\\tfrac{h}{100}\\,w_h(B)",
      chapter: 6
    },
    {
      id: "shadows",
      label: "Shadows",
      section: "tone",
      kind: "operator",
      domain: "printing density",
      cost: "spatial",
      unit: "",
      min: -100,
      max: 100,
      step: 1,
      def: 0,
      fmt: pct,
      what: "Open (+) or deepen (−) dark areas on the same base.",
      maths: "B' = B + 0.25\\,\\tfrac{s}{100}\\,w_s(B)",
      chapter: 6
    },
    {
      id: "clarity",
      label: "Clarity",
      section: "tone",
      kind: "operator",
      domain: "printing density",
      cost: "spatial",
      unit: "",
      min: -100,
      max: 100,
      step: 1,
      def: 0,
      fmt: pct,
      what: "Mid-scale local contrast against an edge-aware base.",
      maths: "PD_k \\leftarrow PD_k + 0.8\\,\\tfrac{c}{100}\\,(\\bar Y - B_{mid})",
      chapter: 6
    },
    {
      id: "texture",
      label: "Texture",
      section: "tone",
      kind: "operator",
      domain: "printing density",
      cost: "spatial",
      unit: "",
      min: -100,
      max: 100,
      step: 1,
      def: 0,
      fmt: pct,
      what: "Fine detail, cored so that grain-sized wiggles are left alone.",
      maths: "PD_k \\leftarrow PD_k + 1.2\\,\\tfrac{t}{100}\\,\\mathrm{core}(\\bar Y - G * \\bar Y)",
      chapter: 6
    },
    // ---------------- Finishing: colour operators
    {
      id: "dyeSat",
      label: "Saturation",
      section: "colour",
      kind: "operator",
      domain: "dyes",
      cost: "free",
      unit: "",
      min: -100,
      max: 100,
      step: 1,
      def: 0,
      fmt: pct,
      what: "Scale the negative’s dyes away from their neutral: saturated colours also get denser, as on film.",
      maths: "c' = n + (1 + 0.6\\,\\tfrac{v}{100})(c - n)",
      chapter: 7
    },
    {
      id: "vibrance",
      label: "Vibrance",
      section: "colour",
      kind: "operator",
      domain: "output (OKLab)",
      cost: "free",
      unit: "",
      min: -100,
      max: 100,
      step: 1,
      def: 0,
      fmt: pct,
      what: "Perceptual saturation that spares skin and colours that are already saturated.",
      maths: "C' = C\\,\\big(1 + 0.8\\,\\tfrac{v}{100}\\,(1 - C/C_{max})(1 - 0.7\\,w_{skin})\\big)",
      chapter: 7
    },
    {
      id: "colourDensity",
      label: "Colour density",
      section: "colour",
      kind: "operator",
      domain: "output (OKLab)",
      cost: "free",
      unit: "",
      min: -100,
      max: 100,
      step: 1,
      def: 0,
      fmt: pct,
      what: "Saturated colours darker and richer (+), or lighter (−).",
      maths: "L' = L - 0.35\\,\\tfrac{d}{100}\\,C",
      chapter: 7
    },
    {
      id: "satRolloff",
      label: "Saturation rolloff",
      section: "colour",
      kind: "operator",
      domain: "output (OKLab)",
      cost: "free",
      unit: "",
      min: 0,
      max: 100,
      step: 1,
      def: 0,
      fmt: pct,
      what: "Colour fades towards deep shadows and near-whites, as in a print.",
      maths: "C' = C\\,(1 - 0.85\\,\\tfrac{r}{100}\\,w_{ends}(L))",
      chapter: 7
    },
    {
      id: "hues",
      label: "Hue shifts",
      section: "colour",
      kind: "operator",
      domain: "output (OKLab)",
      cost: "free",
      type: "hues",
      def: { reds: [0, 0], skin: [0, 0], yellows: [0, 0], greens: [0, 0], blues: [0, 0], purples: [0, 0] },
      targets: [["reds", "Reds", 25], ["skin", "Skin", 55], ["yellows", "Yellows", 100], ["greens", "Greens", 145], ["blues", "Blues", 250], ["purples", "Purples", 320]],
      what: "Move one family of hues (and its saturation) without touching the others.",
      maths: "h' = h + 30°\\,\\tfrac{u}{100}\\,w_i(h),\\ C' = C(1 + \\tfrac{s}{100}w_i(h))",
      chapter: 7
    },
    // ---------------- Finishing: detail
    {
      id: "sharpness",
      label: "Sharpness",
      section: "detail",
      kind: "operator",
      domain: "output",
      cost: "spatial",
      unit: "",
      min: 0,
      max: 100,
      step: 1,
      def: 0,
      fmt: pct,
      what: "Unsharp mask on the print’s lightness at the output scale.",
      maths: "Y' = Y + 1.2\\,\\tfrac{s}{100}\\,(Y - G_{0.7} * Y)",
      chapter: 8
    },
    {
      id: "grainReduction",
      label: "Grain reduction",
      section: "detail",
      kind: "operator",
      domain: "dyes",
      cost: "spatial",
      unit: "",
      min: 0,
      max: 100,
      step: 1,
      def: 0,
      fmt: pct,
      what: "Edge-preserving smoothing of each dye layer, scaled to the grain expected at that density.",
      maths: "c' = c + r\\,(\\mathrm{bilateral}(c) - c)",
      chapter: 8
    },
    {
      id: "bloom",
      label: "Bloom",
      section: "detail",
      kind: "operator",
      domain: "output",
      cost: "spatial",
      unit: "",
      min: 0,
      max: 100,
      step: 1,
      def: 0,
      fmt: pct,
      what: "A soft glow from bright areas, like a diffusion filter on the lens or enlarger.",
      maths: "XYZ \\leftarrow XYZ + 0.6\\,\\tfrac{b}{100}\\,G_\\sigma * (XYZ\\,w(Y)),\\ w = \\mathrm{smoothstep}(0.55, 0.95, Y)",
      chapter: 8
    },
    {
      id: "look",
      label: "Look strength",
      section: "detail",
      kind: "operator",
      domain: "all operators",
      cost: "free",
      unit: "%",
      min: 0,
      max: 150,
      step: 1,
      def: 100,
      fmt: (v) => `${Math.round(v)} %`,
      what: "Scales every finishing operator at once; the physical print (macros) is untouched.",
      maths: "v_{eff} = \\lambda\\,v",
      chapter: 6
    }
  ];
  var BY_ID = Object.fromEntries(SLIDERS.map((s) => [s.id, s]));
  var FINISHING = new Set(SLIDERS.filter((s) => ["tone", "colour", "detail"].includes(s.section) && s.id !== "look").map((s) => s.id));
  var SCANNERS = [
    ["xt5-fitted", "X-T5 + RGB LEDs 678/532/472 (fitted, App. E)"],
    ["rgb-led-book", "RGB LEDs 660/530/450 (book)"],
    ["custom-led", "RGB LEDs, custom peaks"],
    ["white-led", "White LED + camera (book)"],
    ["status-m", "Densitometer (Status M)"]
  ];
  var FILMS = [["kodak_gold_200", "Kodak Gold 200"], ["kodak_portra_160", "Kodak Portra 160"], ["kodak_portra_400", "Kodak Portra 400"], ["kodak_portra_800", "Kodak Portra 800"], ["kodak_ektar_100", "Kodak Ektar 100"], ["kodak_ultramax_400", "Kodak UltraMax 400"], ["fujifilm_c200", "Fujifilm C200"], ["fujifilm_pro_400h", "Fujifilm Pro 400H"]];
  function defaults() {
    const o = {};
    for (const s of SLIDERS) o[s.id] = Array.isArray(s.def) ? s.def.slice() : s.def && typeof s.def === "object" ? JSON.parse(JSON.stringify(s.def)) : s.def;
    return o;
  }

  // src/engine.js
  var import_fs = __toESM(require_fs());
  function loadData(map) {
    for (const [p, s] of Object.entries(map)) import_fs.default.put("/cg/data/" + p, s);
  }

  // src/model.js
  var import_spectrum = __toESM(require_spectrum());
  var import_stock = __toESM(require_stock());
  var import_channels = __toESM(require_channels());
  var import_solve = __toESM(require_solve());
  var import_print = __toESM(require_print());
  var import_colour = __toESM(require_colour());
  var import_linalg = __toESM(require_linalg());
  var N3 = 33;
  var N1 = 512;
  var A_RANGE = [-0.25, 2.55];
  var C_RANGE = [0, 2.6];
  var X_RANGE = [-2.5, 2.5];
  var CP_RANGE = [0, 2.7];
  var n = 81;
  var lerp = (a, b, t) => a + (b - a) * t;
  var grid1 = (lo, hi, N = N1) => Float64Array.from({ length: N }, (_, i) => lo + (hi - lo) * i / (N - 1));
  var CAMERA = null;
  function camera() {
    if (CAMERA) return CAMERA;
    const j = JSON.parse(require_fs().readFileSync("/cg/data/cameras/generic-bayer.json", "utf8"));
    CAMERA = {};
    for (const k of "RGB") CAMERA[k] = import_spectrum.default.table(j.wl, j[k], "responsivity");
    return CAMERA;
  }
  function makeScanner(id, o = {}) {
    const led = (r, g, b, w = 20) => ({ R: import_spectrum.default.gaussian(r, w), G: import_spectrum.default.gaussian(g, w), B: import_spectrum.default.gaussian(b, w) });
    if (id === "xt5-fitted") return { id, name: "X-T5 + LEDs 678/532/472", channels: import_channels.default.scanner({ name: id, light: led(678, 532, 472), camera: camera() }) };
    if (id === "rgb-led-book") return { id, name: "RGB LEDs 660/530/450", channels: import_channels.default.scanner({ name: id, light: { R: import_spectrum.default.gaussian(660, 20), G: import_spectrum.default.gaussian(530, 25), B: import_spectrum.default.gaussian(450, 20) }, camera: camera() }) };
    if (id === "custom-led") {
      const p = o.peaks || [665, 530, 450];
      return { id, name: `RGB LEDs ${p.join("/")}`, channels: import_channels.default.scanner({ name: id, light: led(p[0], p[1], p[2], o.fwhm || 20), camera: camera() }) };
    }
    if (id === "white-led") {
      const j = JSON.parse(require_fs().readFileSync("/cg/data/lights/white-led.json", "utf8"));
      return { id, name: "White LED + camera", channels: import_channels.default.scanner({ name: id, light: import_spectrum.default.table(j.wl, j.values || j.power || j.R, "power"), camera: camera() }) };
    }
    if (id === "status-m") return { id, name: "Status M", channels: import_channels.default.statusM() };
    throw new Error("unknown scanner " + id);
  }
  function nodeAt(q, N, lo, hi) {
    const st = (hi - lo) / (N - 1);
    return [lo + q % N * st, lo + Math.floor(q / N) % N * st, lo + Math.floor(q / (N * N)) * st];
  }
  var SOLVE_OPTS = { activeSet: true, gtol: 1e-9 };
  function makeSolve(scanner, film, o = SOLVE_OPTS) {
    const S = import_solve.default.makeSolver(scanner.channels, film, o);
    return { S, K: S.K, Kinv: import_linalg.default.inv3(S.K), Dbase: S.Dbase };
  }
  function solveNodes(sv, out, q0, q1, N = N3) {
    const [lo, hi] = A_RANGE;
    for (let q = q0; q < q1; q++) {
      const a = nodeAt(q, N, lo, hi), d = import_linalg.default.mulVec(sv.K, a).map((v, k) => v + sv.Dbase[k]), r = sv.S.solve(d, { sigma: false });
      out[4 * (q - q0)] = r.c[0];
      out[4 * (q - q0) + 1] = r.c[1];
      out[4 * (q - q0) + 2] = r.c[2];
      out[4 * (q - q0) + 3] = r.residual;
    }
    return out;
  }
  var solveResult = (sv, data, N = N3) => ({ N, data, Kinv: sv.Kinv, K: sv.K, Dbase: sv.Dbase, solver: sv.S, range: A_RANGE });
  function solveTable(scanner, film, { N = N3, onProgress, budgetMs = 30 } = {}) {
    const sv = makeSolve(scanner, film), total = N * N * N, out = new Float32Array(total * 4);
    let q = 0;
    return new Promise((resolve) => {
      const work = () => {
        const t0 = performance.now();
        while (q < total && performance.now() - t0 < budgetMs) {
          const q1 = Math.min(total, q + 64);
          solveNodes(sv, out.subarray(4 * q, 4 * q1), q, q1, N);
          q = q1;
        }
        if (onProgress) onProgress(q / total);
        if (q < total) setTimeout(work, 0);
        else resolve(solveResult(sv, out, N));
      };
      work();
    });
  }
  function solveInputs(scanner, film) {
    const sv = makeSolve(scanner, film);
    return {
      sv,
      P: scanner.channels.P.map((p) => Float32Array.from(p.values)),
      E: film.dyes.map((e) => Float32Array.from(e.values)),
      B: Float32Array.from(film.base.values),
      K: sv.K,
      Dbase: sv.Dbase,
      lo: 0,
      hi: 4,
      tolerance: 1e-12,
      maxIterations: 50,
      activeSet: SOLVE_OPTS.activeSet,
      gtol: SOLVE_OPTS.gtol,
      range: A_RANGE
    };
  }
  function printingChannels(paper, lampK = 3200) {
    return import_channels.default.printing({ paper, lamp: import_spectrum.default.blackbody(lampK) });
  }
  function pdOf(film, PCh) {
    const P = PCh.P.map((p) => p.values), E = film.dyes.map((e) => e.values), B = film.base.values;
    return (c) => {
      let s0 = 0, s1 = 0, s2 = 0;
      for (let i = 0; i < n; i++) {
        const t = Math.pow(10, -(B[i] + c[0] * E[0][i] + c[1] * E[1][i] + c[2] * E[2][i]));
        s0 += P[0][i] * t;
        s1 += P[1][i] * t;
        s2 += P[2][i] * t;
      }
      return [-Math.log10(s0), -Math.log10(s1), -Math.log10(s2)];
    };
  }
  function pdNodes(f, out, q0, q1, N = N3) {
    const [lo, hi] = C_RANGE;
    for (let q = q0; q < q1; q++) {
      const p = f(nodeAt(q, N, lo, hi));
      out[4 * (q - q0)] = p[0];
      out[4 * (q - q0) + 1] = p[1];
      out[4 * (q - q0) + 2] = p[2];
      out[4 * (q - q0) + 3] = 1;
    }
    return out;
  }
  function pdTable(film, PCh, N = N3) {
    return { N, data: pdNodes(pdOf(film, PCh), new Float32Array(N * N * N * 4), 0, N * N * N, N), range: C_RANGE };
  }
  function curveTable(fn, lo, hi) {
    const xs = grid1(lo, hi), out = new Float32Array(N1 * 4);
    xs.forEach((x, i) => {
      const v = fn(x);
      out[4 * i] = v[0];
      out[4 * i + 1] = v[1];
      out[4 * i + 2] = v[2];
      out[4 * i + 3] = 1;
    });
    return { N: N1, data: out, range: [lo, hi] };
  }
  var filmForward = (film) => curveTable((x) => film.curves.map((c) => c.at(x)), ...X_RANGE);
  var filmInverse = (film) => curveTable((c) => film.curves.map((cv) => cv.inverse(c)), ...C_RANGE);
  var paperCurves = (paper) => curveTable((x) => paper.curves.map((c) => Math.max(0, c.at(x))), ...X_RANGE);
  var reshootMap = (A, B) => curveTable((c) => A.curves.map((cv, k) => B.curves[k].at(cv.inverse(c))), ...C_RANGE);
  var STAIN = Float64Array.from(import_spectrum.default.GRID.wl, (w) => Math.exp(-0.5 * ((w - 410) / 38) ** 2) + 0.35 * Math.exp(-0.5 * ((w - 470) / 30) ** 2));
  function printSetup(paper, { viewingK = 5e3, fade = 0 } = {}) {
    const view = import_spectrum.default.blackbody(viewingK), cmf = import_spectrum.default.cmf(), V = view.values, E = paper.dyes.map((e) => e.values);
    const B = paper.base.values.map((b, i) => b + fade * 0.14 * STAIN[i]);
    let kY = 0;
    for (let i = 0; i < n; i++) kY += V[i] * cmf.Y.values[i];
    const white = import_spectrum.default.xyz(import_spectrum.default.flat(1), view);
    const wx = [], wy = [], wz = [];
    for (let i = 0; i < n; i++) {
      wx.push(V[i] * cmf.X.values[i] / kY);
      wy.push(V[i] * cmf.Y.values[i] / kY);
      wz.push(V[i] * cmf.Z.values[i] / kY);
    }
    const xyzOf = (c) => {
      let X = 0, Y = 0, Z = 0;
      for (let i = 0; i < n; i++) {
        const r = Math.pow(10, -(B[i] + c[0] * E[0][i] + c[1] * E[1][i] + c[2] * E[2][i]));
        X += r * wx[i];
        Y += r * wy[i];
        Z += r * wz[i];
      }
      return import_colour.default.adapt([X, Y, Z], white, import_colour.default.D65);
    };
    const Mcols = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((e) => import_colour.default.adapt(e, white, import_colour.default.D65)), M = [0, 1, 2].map((r) => [Mcols[0][r], Mcols[1][r], Mcols[2][r]]);
    return { E, B, W: [wx, wy, wz], M, xyzOf };
  }
  function printNodes(xyzOf, out, q0, q1, N = N3) {
    const [lo, hi] = CP_RANGE;
    for (let q = q0; q < q1; q++) {
      const X = xyzOf(nodeAt(q, N, lo, hi));
      out[4 * (q - q0)] = X[0];
      out[4 * (q - q0) + 1] = X[1];
      out[4 * (q - q0) + 2] = X[2];
      out[4 * (q - q0) + 3] = 1;
    }
    return out;
  }
  var printResult = (ps, data, N = N3) => ({ N, data, range: CP_RANGE, xyzOf: ps.xyzOf, paperWhite: ps.xyzOf([0, 0, 0]) });
  function printTable(paper, { viewingK = 5e3, fade = 0, N = N3 } = {}) {
    const ps = printSetup(paper, { viewingK, fade });
    return printResult(ps, printNodes(ps.xyzOf, new Float32Array(N * N * N * 4), 0, N * N * N, N), N);
  }
  function spectralInputs(kind, { film, PCh, paper, fade = 0 }) {
    const f32 = (a) => Float32Array.from(a);
    if (kind === "pd") return { mode: "log", E: film.dyes.map((e) => f32(e.values)), B: f32(film.base.values), W: PCh.P.map((p) => f32(p.values)), M: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], range: C_RANGE };
    const ps = printSetup(paper, { fade });
    return { mode: "lin", E: ps.E.map(f32), B: f32(ps.B), W: ps.W.map(f32), M: ps.M, range: CP_RANGE, ps };
  }
  function aim(film, paper, PCh, { viewingK = 5e3 } = {}) {
    const printer = import_print.default.makePrinter({ paper, lamp: import_spectrum.default.blackbody(3200), viewing: import_spectrum.default.blackbody(viewingK) });
    const cGrey = film.develop([0, 0, 0]);
    const Dgrey = film.spectral(cGrey);
    const A = PCh.read(Dgrey);
    const lights = printer.greyPatch(Dgrey, 0.184).values;
    const clear = printer.clear;
    const g = [0, 1, 2].map((k) => clear[k] - A[k] + lights[k]);
    const pdAt = (T) => {
      const S = import_spectrum.default.blackbody(T), S0 = import_spectrum.default.blackbody(5500);
      const x = film.sensitivity.map((s) => {
        let a = 0, b = 0;
        for (let i = 0; i < n; i++) {
          a += S.values[i] * s.values[i];
          b += S0.values[i] * s.values[i];
        }
        return Math.log10(a / b);
      });
      return PCh.read(film.spectral(film.develop(x)));
    };
    const m1 = 1e6 / 5500 + 20, m0 = 1e6 / 5500 - 20, p1 = pdAt(1e6 / m1), p0 = pdAt(1e6 / m0);
    let dw = p1.map((v, k) => -(v - p0[k]) / 40);
    const mw = (dw[0] + dw[1] + dw[2]) / 3;
    dw = dw.map((v) => v - mw);
    const win = paper.curves.map((cv) => {
      const xs = grid1(-2.5, 2.5, 501), ys = xs.map((x) => cv.at(x));
      const mn = Math.min(...ys), mx = Math.max(...ys);
      return [xs.find((x, i) => ys[i] > mn + 0.04), xs.find((x, i) => ys[i] > 0.9 * mx)];
    });
    return { A, lights, clear, g, warmPerMired: dw, window: win, printer };
  }
  var cache = /* @__PURE__ */ new Map();
  var memo = (key, fn) => {
    if (!cache.has(key)) cache.set(key, fn());
    return cache.get(key);
  };
  var MAIN_ENGINE = {
    name: "main",
    solve: (scanner, film, { onProgress } = {}) => solveTable(scanner, film, { onProgress }),
    pd: async (film, PCh) => pdTable(film, PCh),
    print: async (paper, { fade }) => printTable(paper, { fade })
  };
  var memoAsync = (key, fn) => {
    if (!cache.has(key)) {
      const p = Promise.resolve().then(fn);
      p.catch(() => cache.delete(key));
      cache.set(key, p);
    }
    return cache.get(key);
  };
  async function buildModel(src, look, { onProgress, engine = MAIN_ENGINE } = {}) {
    const film = import_stock.default.load(src.film), paper = import_stock.default.load(look.paper || "kodak_portra_endura");
    const scanner = memo(`sc:${src.scanner}:${(src.peaks || []).join(",")}`, () => makeScanner(src.scanner, { peaks: src.peaks }));
    const ids = { scanner: src.scanner, peaks: src.peaks, film: src.film, paper: paper.name };
    const PCh = memo(`pch:${paper.name}`, () => printingChannels(paper));
    const fade = Math.round(look.fade || 0) / 100;
    const solveP = memoAsync(`solve:${scanner.id}:${(src.peaks || []).join(",")}:${src.film}`, () => engine.solve(scanner, film, { onProgress, ids }));
    const pdP = memoAsync(`pd:${film.name}:${paper.name}`, () => engine.pd(film, PCh, { ids: { film: src.film, paper: paper.name } }));
    const printP = memoAsync(`pr:${paper.name}:${fade}`, () => engine.print(paper, { fade }, { ids: { paper: paper.name } }));
    let rsP = null, B = null;
    if (look.reshoot && look.reshoot !== "none" && look.reshoot !== film.name) {
      B = import_stock.default.load(look.reshoot);
      rsP = memoAsync(`pd:${B.name}:${paper.name}`, () => engine.pd(B, PCh, { ids: { film: look.reshoot, paper: paper.name } }));
    }
    const [solve, pd, print, rspd] = await Promise.all([solveP, pdP, printP, rsP]);
    const fwd = memo(`ff:${film.name}`, () => filmForward(film)), inv = memo(`fi:${film.name}`, () => filmInverse(film));
    const pcurves = memo(`pc:${paper.name}`, () => paperCurves(paper));
    const am = memo(`aim:${film.name}:${paper.name}`, () => aim(film, paper, PCh));
    const reshoot = B ? { stock: B, map: memo(`rs:${film.name}:${B.name}`, () => reshootMap(film, B)), pd: rspd } : null;
    return { film, paper, scanner, solve, PCh, pd, fwd, inv, pcurves, print, aim: am, reshoot, keys: { solve: `${scanner.id}:${src.film}:${(src.peaks || []).join(",")}`, paper: paper.name, fade, reshoot: reshoot ? reshoot.stock.name : "none" } };
  }
  function clearModelCache(prefix) {
    for (const k of [...cache.keys()]) if (!prefix || k.startsWith(prefix)) cache.delete(k);
  }
  function look3(T, a) {
    const { N, data, range: [lo, hi] } = T, f = (v) => {
      const u = Math.min(N - 1, Math.max(0, (v - lo) / (hi - lo) * (N - 1)));
      const i2 = Math.min(N - 2, Math.floor(u));
      return [i2, u - i2];
    };
    const [i, fx] = f(a[0]), [j, fy] = f(a[1]), [k, fz] = f(a[2]);
    const out = [0, 0, 0, 0];
    for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz), q = 4 * (i + dx + N * (j + dy + N * (k + dz)));
      for (let c = 0; c < 4; c++) out[c] += w * data[q + c];
    }
    return out;
  }
  function look1(T, v, ch) {
    const { N, data, range: [lo, hi] } = T, u = Math.min(N - 1, Math.max(0, (v - lo) / (hi - lo) * (N - 1))), i = Math.min(N - 2, Math.floor(u)), f = u - i;
    return lerp(data[4 * i + ch], data[4 * (i + 1) + ch], f);
  }

  // src/shaders.js
  var VS = `#version 300 es
in vec2 p; out vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
  var HEAD = `#version 300 es
precision highp float; precision highp sampler3D;
in vec2 uv; out vec4 o;
uniform vec4 g2;                                  // tile → whole-frame coordinates
vec2 G() { return g2.xy + uv * g2.zw; }
float lut1(sampler2D t, float row, float v, vec2 r) { float u = clamp((v - r.x) / (r.y - r.x), 0.0, 1.0); return texture(t, vec2((u * 511.0 + 0.5) / 512.0, (row + 0.5) / 4.0)).x; }
vec4 lut1v(sampler2D t, float row, float v, vec2 r) { float u = clamp((v - r.x) / (r.y - r.x), 0.0, 1.0); return texture(t, vec2((u * 511.0 + 0.5) / 512.0, (row + 0.5) / 4.0)); }
// per-layer 1-D lookups: channel k of the curve at v_k
vec3 lut1c(sampler2D t, float row, vec3 v, vec2 r) { return vec3(lut1v(t, row, v.x, r).x, lut1v(t, row, v.y, r).y, lut1v(t, row, v.z, r).z); }
vec4 lut3(sampler3D t, vec3 v, vec2 r) { vec3 u = clamp((v - r.x) / (r.y - r.x), 0.0, 1.0); return texture(t, (u * 32.0 + 0.5) / 33.0); }
`;
  var FS_DYES = HEAD + `
uniform sampler2D src; uniform vec3 Treb; uniform mat3 Kinv; uniform sampler3D solve; uniform vec2 aR;
uniform sampler2D curves; uniform vec2 xR, cR;           // rows: 0 film forward (x→c), 1 film inverse (c→x)
uniform sampler2D hal; uniform vec2 halAmt;               // blurred film exposure: (E_R σ1, E_R σ2, E_G σ1, E_G σ2)
uniform float dyeSat, emitE;
void main() {
  vec3 T = max(texture(src, uv).rgb, vec3(1e-6));
  vec3 D = -log(T / Treb) / log(10.0);
  vec3 a = Kinv * D;
  vec4 s = lut3(solve, a, aR);
  vec3 c = s.xyz;
  if (emitE > 0.5) { vec3 x = lut1c(curves, 1.0, c, cR); o = vec4(pow(vec3(10.0), x).xy, pow(vec3(10.0), x).xy); return; }
  if (halAmt.x > 0.0 || halAmt.y > 0.0) {
    vec3 x = lut1c(curves, 1.0, c, cR);
    vec4 h = texture(hal, G());
    float ER = pow(10.0, x.r) + halAmt.x * 0.5 * (h.x + h.y);
    float EG = pow(10.0, x.g) + halAmt.y * 0.5 * (h.z + h.w);
    x.r = log(ER) / log(10.0); x.g = log(EG) / log(10.0);
    c.r = lut1v(curves, 0.0, x.r, xR).x; c.g = lut1v(curves, 0.0, x.g, xR).y;
  }
  if (dyeSat != 1.0) {
    vec3 x = lut1c(curves, 1.0, c, cR);
    float xm = (x.r + x.g + x.b) / 3.0;
    vec3 nn = vec3(lut1v(curves, 0.0, xm, xR).x, lut1v(curves, 0.0, xm, xR).y, lut1v(curves, 0.0, xm, xR).z);
    c = max(nn + dyeSat * (c - nn), vec3(0.0));
  }
  o = vec4(c, s.w);
}`;
  var FS_PD = HEAD + `
uniform sampler2D dyes; uniform vec2 texel; uniform sampler3D pdA; uniform sampler3D pdB; uniform vec2 cR;
uniform sampler2D curves; uniform float reshoot;                 // row 3: c → f_B(f_A⁻¹(c))
uniform sampler2D noise; uniform vec2 filmUm; uniform float grainTexUm, grainAmt, grainNorm;
uniform float reduce;
void main() {
  vec4 s = texture(dyes, uv); vec3 c = s.xyz;
  if (reduce > 0.0) {
    vec3 acc = vec3(0.0); vec3 wsum = vec3(0.0);
    vec3 sr = 0.015 + 0.03 * sqrt(max(c, 0.0) + 0.05);
    for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
      vec3 q = texture(dyes, uv + vec2(float(i), float(j)) * texel).xyz;
      float ds = float(i * i + j * j) / (2.0 * 1.6 * 1.6);
      vec3 d = (q - c) / sr; vec3 w = exp(-ds - 0.5 * d * d);
      acc += w * q; wsum += w;
    }
    c = mix(c, acc / wsum, reduce);
  }
  if (grainAmt > 0.0) {
    vec2 f = G() * filmUm / grainTexUm / 1024.0;
    vec3 nz = texture(noise, f).rgb * grainNorm;
    c = max(c + grainAmt * sqrt(max(c, 0.0) + 0.05) * nz, vec3(0.0));
  }
  vec3 pd = lut3(pdA, c, cR).xyz;
  if (reshoot > 0.0) { vec3 cb = lut1c(curves, 3.0, c, cR); pd = mix(pd, lut3(pdB, cb, cR).xyz, reshoot); }
  o = vec4(pd, (pd.x + pd.y + pd.z) / 3.0);
}`;
  var FS_BLUR = HEAD + `
uniform sampler2D t; uniform vec2 dir; uniform int R; uniform vec2 kw[97];
void main() {
  vec4 acc = texture(t, uv) * kw[0].xxyy;
  for (int i = 1; i <= R; i++) {
    vec2 d = dir * float(i);
    acc += (texture(t, uv + d) + texture(t, uv - d)) * kw[i].xxyy;
  }
  o = acc;
}`;
  var FS_GF_PREP = HEAD + `uniform sampler2D pd; void main() { float I = texture(pd, uv).w; o = vec4(I, I * I, I, I * I); }`;
  var FS_GF_AB = HEAD + `uniform sampler2D m; uniform vec2 eps;
void main() { vec4 v = texture(m, uv); float vL = max(v.y - v.x * v.x, 0.0), vM = max(v.w - v.z * v.z, 0.0);
  float aL = vL / (vL + eps.x), aM = vM / (vM + eps.y); o = vec4(aL, v.x - aL * v.x, aM, v.z - aM * v.z); }`;
  var FS_COPY = HEAD + `uniform sampler2D t; void main() { o = texture(t, uv); }`;
  var FS_PRINT = HEAD + `
uniform sampler2D pd; uniform vec2 texel; uniform sampler2D base;
uniform vec3 clearL, g; uniform float Bref;
uniform float mask, hl, sh, clarity, texture_;
uniform vec4 burn; uniform float aspect;                   // edge pt, sky pt (log H), unused
uniform vec3 Us, Uh; uniform float span;
uniform float gamma; uniform vec3 flash;
uniform sampler2D curves; uniform vec2 xR;                 // row 2: paper x → c_p
uniform vec3 fadeK; uniform sampler3D printT; uniform vec2 cpR;
uniform vec3 flareXYZ; uniform float gain;
void main() {
  vec4 P = texture(pd, uv); vec3 PD = P.xyz; float Y = P.w;
  vec4 b = texture(base, G());
  float BL = b.x * Y + b.y, BM = b.z * Y + b.w;
  float B2 = Bref + (1.0 - mask) * (BL - Bref);
  B2 -= hl * smoothstep(Bref, Bref + 0.6, BL);
  B2 += sh * smoothstep(Bref, Bref - 0.6, BL);
  float dP = (B2 - BL) + clarity * (Y - BM);
  if (texture_ != 0.0) {
    float bl = 0.0, ws = 0.0;
    for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) { float w = exp(-float(i * i + j * j) / 2.0); bl += w * texture(pd, uv + vec2(float(i), float(j)) * texel).w; ws += w; }
    float d = Y - bl / ws; float core = d * d / (d * d + 0.012 * 0.012);
    dP += texture_ * d * core;
  }
  PD += dP;
  vec3 x = clearL - PD;
  vec2 gu = G(); vec2 q = (gu - 0.5) * vec2(aspect, 1.0); float r = length(q) / length(vec2(aspect, 1.0) * 0.5);
  x += burn.x * pow(smoothstep(0.42, 1.0, r), 1.4);
  x += burn.y * (1.0 - smoothstep(0.0, 0.55, gu.y));
  vec3 xs = g + span, xh = g - span;
  x += Us + (x - xs) / (xh - xs) * (Uh - Us);
  x = g + gamma * (x - g);
  x = log(pow(vec3(10.0), x) + flash) / log(10.0);
  vec3 cp = lut1c(curves, 2.0, x, xR) * fadeK;
  vec3 XYZ = lut3(printT, cp, cpR).xyz;
  XYZ = (XYZ + flareXYZ) * gain;
  o = vec4(XYZ, 1.0);
}`;
  var FS_BLOOMSRC = HEAD + `uniform sampler2D t; void main() { vec3 X = texture(t, uv).xyz; float w = smoothstep(0.55, 0.95, X.y); o = vec4(X.y * w, X.x * w, X.y * w, X.z * w); }`;
  var FS_OUT = HEAD + `
uniform sampler2D pr; uniform vec2 texel; uniform sampler2D bloomT; uniform float bloom, sharp;
uniform float vib, cden, roll; uniform vec4 hueA, hueB, hueC;  // per family: (shift rad, sat) packed as pairs
uniform vec3 hueH0; uniform vec3 hueH1;                         // centres of the six families (radians)
uniform mat3 toRGB; uniform float shoulder; uniform int view; uniform sampler2D dbg; uniform vec3 Treb;
uniform sampler2D srcT; uniform vec3 sigD; uniform float zN;     // the base map: transmittance, noise σ of density, the ±σ band
const mat3 M1 = mat3(0.8189330101, 0.0329845436, 0.0482003018, 0.3618667424, 0.9293118715, 0.2643662691, -0.1288597137, 0.0361456387, 0.6338517070);
const mat3 M2 = mat3(0.2104542553, 1.9779984951, 0.0259040371, 0.7936177850, -2.4285922050, 0.7827717662, -0.0040720468, 0.4505937099, -0.8086757660);
vec3 toLab(vec3 X) { vec3 l = M1 * X; return M2 * (sign(l) * pow(abs(l), vec3(1.0 / 3.0))); }
const mat3 M1i = mat3(1.2270138511, -0.0405801784, -0.0763812845, -0.5577999807, 1.1122568696, -0.4214819784, 0.2812561490, -0.0716766787, 1.5861632204);
const mat3 M2i = mat3(0.9999999985, 1.0000000089, 1.0000000547, 0.3963377922, -0.1055613423, -0.0894841821, 0.2158037581, -0.0638541748, -1.2914855379);
vec3 fromLab(vec3 L) { vec3 l = M2i * L; return M1i * (l * l * l); }
float enc(float v) { float a = abs(v); float e = a <= 0.0031308 ? 12.92 * a : 1.055 * pow(a, 1.0 / 2.4) - 0.055; return sign(v) * e; }
float hw(float h, float c) { float d = abs(mod(h - c + 3.14159265, 6.2831853) - 3.14159265); return exp(-0.5 * d * d / (0.38 * 0.38)); }
void main() {
  if (view == 1) { vec3 T = texture(dbg, uv).rgb / Treb; o = vec4(enc(clamp(T.r * 0.9, 0.0, 1.0)), enc(clamp(T.g * 0.9, 0.0, 1.0)), enc(clamp(T.b * 0.9, 0.0, 1.0)), 1.0); return; }
  if (view == 2) { vec3 c = texture(dbg, uv).xyz; vec3 t = pow(vec3(10.0), -c * 0.85); o = vec4(enc(t.r), enc(t.g), enc(t.b), 1.0); return; }
  if (view == 3) {   // the base map over a pale print: blank film (blue), below base (amber), out of gamut (red); colours are sRGB-encoded
    float r = texture(dbg, uv).w;
    vec3 D = -log(max(texture(srcT, uv).rgb, vec3(1e-6)) / Treb) / log(10.0), z = D / max(sigD, vec3(1e-4));
    float zm = min(z.r, min(z.g, z.b)), g = 0.6 + 0.38 * enc(clamp(texture(pr, uv).y, 0.0, 1.0));
    vec3 c = vec3(g);
    if (zm < -zN) c = mix(c, vec3(0.902, 0.580, 0.098), 0.9);
    else if (zm <= zN) c = mix(c, vec3(0.239, 0.498, 0.851), 0.8);
    else if (r > 0.01) c = mix(c, vec3(0.886, 0.0, 0.102), 0.9);
    o = vec4(c, 1.0); return;
  }
  vec3 X = texture(pr, uv).xyz;
  if (sharp > 0.0) {
    float yb = 0.0, ws = 0.0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { float w = (i == 0 ? 2.0 : 1.0) * (j == 0 ? 2.0 : 1.0); yb += w * texture(pr, uv + vec2(float(i), float(j)) * texel).y; ws += w; }
    yb /= ws; float k = 1.0 + sharp * (X.y - yb) / max(X.y, 0.004); X *= clamp(k, 0.5, 2.0);
  }
  if (bloom > 0.0) { vec4 b = texture(bloomT, G()); X += bloom * b.yzw; }
  vec3 L = toLab(max(X, vec3(0.0)));
  float C = length(L.yz), h = atan(L.z, L.y);
  if (vib != 0.0) { float skin = hw(h, 0.96); C *= 1.0 + vib * clamp(1.0 - C / 0.32, 0.0, 1.0) * (1.0 - 0.7 * skin); }
  float wsum = 0.0; float dh = 0.0, ds = 0.0;
  float hc[6] = float[6](hueH0.x, hueH0.y, hueH0.z, hueH1.x, hueH1.y, hueH1.z);
  vec2 hp[6] = vec2[6](hueA.xy, hueA.zw, hueB.xy, hueB.zw, hueC.xy, hueC.zw);
  for (int i = 0; i < 6; i++) { float w = hw(h, hc[i]) * clamp(C / 0.04, 0.0, 1.0); dh += w * hp[i].x; ds += w * hp[i].y; }
  h += dh; C *= max(0.0, 1.0 + ds);
  if (roll > 0.0) { float e = smoothstep(0.82, 1.0, L.x) + smoothstep(0.32, 0.05, L.x); C *= 1.0 - roll * clamp(e, 0.0, 1.0); }
  if (cden != 0.0) L.x -= cden * C;
  L.y = C * cos(h); L.z = C * sin(h);
  vec3 rgb = toRGB * fromLab(L);
  vec3 s = vec3(shoulder);
  rgb = mix(rgb, s + (1.0 - s) * tanh((rgb - s) / (1.0 - s)), step(s, rgb));
  o = vec4(enc(rgb.r), enc(rgb.g), enc(rgb.b), 1.0);
}`;
  var FS_VIEW = HEAD + `
uniform sampler2D a; uniform sampler2D b; uniform float split; uniform vec4 xf; uniform vec3 bg;
void main() {
  vec2 t = (uv - xf.xy) / xf.zw;
  if (t.x < 0.0 || t.y < 0.0 || t.x > 1.0 || t.y > 1.0) { o = vec4(bg, 1.0); return; }
  vec2 tt = vec2(t.x, 1.0 - t.y);
  o = (split > 0.0 && t.x < split) ? texture(b, tt) : texture(a, tt);
  if (split > 0.0 && abs(t.x - split) < 0.0015) o = vec4(1.0);
}`;

  // src/params.js
  var add = (a, b) => a.map((v, k) => v + b[k]);
  var scale = (a, s) => a.map((v) => v * s);
  function colourOffset(model, warm, tint) {
    const w = scale(model.aim.warmPerMired, K.WARM_MIRED * warm);
    const t = scale([-1 / 3, 2 / 3, -1 / 3], PT * K.TINT_PT * tint / 100);
    return add(w, t);
  }
  function autoLights(model, stats, alpha) {
    const { A, lights: a } = model.aim;
    const d = stats.latd.map((v, k) => v - A[k]), m = (d[0] + d[1] + d[2]) / 3;
    return a.map((ak, k) => ak + m + alpha * (d[k] - m));
  }
  function frameParams(model, s, stats, roll = {}) {
    const look = (s.look ?? 100) / 100;
    const op = (id) => FINISHING.has(id) ? (s[id] ?? 0) * look : s[id] ?? 0;
    const auto = stats ? autoLights(model, stats, (s.autoColour ?? 75) / 100) : model.aim.lights.slice();
    let base = auto;
    if (roll.mean && s.rollConsistency) {
      const r = s.rollConsistency / 100;
      base = auto.map((v, k) => (1 - r) * v + r * roll.mean[k]);
    }
    let match = [0, 0, 0];
    if (roll.ref && stats && s.matchAmount) {
      const mine = stats.meanPD.map((p, k) => model.aim.clear[k] - p + base[k]);
      match = roll.ref.meanX.map((v, k) => (v - mine[k]) * s.matchAmount / 100);
    }
    const exposure = [-1, -1, -1].map((v) => v * STOP * (s.exposure ?? 0));
    const colour = colourOffset(model, s.warmth ?? 0, s.tint ?? 0);
    const L = [0, 1, 2].map((k) => base[k] + match[k] + exposure[k] + colour[k]);
    const pad = (v) => colourOffset(model, (v ? v[0] : 0) * K.SPLIT, (v ? v[1] : 0) * K.SPLIT);
    const g = model.aim.g;
    const flash = g.map((gk) => K.PREFLASH * (s.preflash ?? 0) / 100 * Math.pow(10, gk - 0.6));
    const fadeK = [0.4, 0.12, 0.25].map((w) => 1 - w * (s.fade ?? 0) / 100);
    const Yp = model.print.paperWhite[1];
    const flare = (s.blacks ?? 12) / 100 * K.FLARE_MAX / 100;
    const D65 = [0.95047, 1, 1.08883];
    const hues = BY_ID.hues.targets.map(([id, , deg]) => ({ c: deg * Math.PI / 180, v: s.hues && s.hues[id] || [0, 0] }));
    return {
      lights: { auto, base, match, exposure, colour, total: L },
      clearL: model.aim.clear.map((c, k) => c + L[k]),
      g,
      flash,
      fadeK,
      gamma: s.contrast ?? 1,
      Us: pad(s.shadowColour),
      Uh: pad(s.highlightColour),
      span: K.SPLIT_SPAN,
      burn: [PT * (s.edgeBurn ?? 0), PT * (s.skyBurn ?? 0), 0, 0],
      flareXYZ: D65.map((w) => w * flare * Yp),
      gain: 1 / Yp * Math.pow(2, (s.whites ?? 0) / 100),
      halAmt: [K.HAL_R * (s.halation ?? 0) / 100, K.HAL_G * (s.halation ?? 0) / 100],
      dyeSat: 1 + K.DYESAT * op("dyeSat") / 100,
      grain: K.GRAIN_SIGMA * (s.grain ?? 0) / 100,
      grainSize: s.grainSize ?? 1,
      reduce: K.GRAINRED * op("grainReduction") / 100,
      reshoot: model.reshoot ? (s.reshootAmount ?? 100) / 100 : 0,
      mask: K.MASK * op("mask") / 100,
      hl: K.ZONE * op("highlights") / 100,
      sh: K.ZONE * op("shadows") / 100,
      clarity: K.CLARITY * op("clarity") / 100,
      texture: K.TEXTURE * op("texture") / 100,
      vib: K.VIBRANCE * op("vibrance") / 100,
      cden: K.COLDENS * op("colourDensity") / 100,
      roll: K.ROLLOFF * op("satRolloff") / 100,
      hues: hues.map((h) => ({ c: h.c, dh: K.HUE_DEG * Math.PI / 180 * h.v[0] / 100 * look, ds: h.v[1] / 100 * look })),
      sharp: K.SHARP * op("sharpness") / 100,
      bloom: K.BLOOM * op("bloom") / 100,
      Bref: stats ? stats.Bref : 1.3
    };
  }
  function paperX(P, pd) {
    let x = P.clearL.map((c, k) => c - pd[k]);
    x = x.map((v, k) => {
      const xs = P.g[k] + P.span, xh = P.g[k] - P.span;
      return v + P.Us[k] + (v - xs) / (xh - xs) * (P.Uh[k] - P.Us[k]);
    });
    x = x.map((v, k) => P.g[k] + P.gamma * (v - P.g[k]));
    return x.map((v, k) => Math.log10(Math.pow(10, v) + P.flash[k]));
  }
  function frameStats(pd, w, h) {
    const N = w * h, T = [0, 0, 0], M = [0, 0, 0];
    let ys = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      for (let k = 0; k < 3; k++) {
        const p = pd[4 * i + k];
        T[k] += Math.pow(10, -p);
        M[k] += p;
      }
      ys[i] = pd[4 * i + 3];
    }
    ys.sort();
    return { latd: T.map((t) => -Math.log10(t / N)), meanPD: M.map((m) => m / N), Bref: ys[N >> 1], n: N };
  }
  function windowHistogram(P, pd, w, h, { lo = -1.6, hi = 1.6, bins = 96, step = 2 } = {}) {
    const H = [new Float32Array(bins), new Float32Array(bins), new Float32Array(bins)];
    let n2 = 0;
    for (let y = 0; y < h; y += step) for (let x0 = 0; x0 < w; x0 += step) {
      const i = y * w + x0, x = paperX(P, [pd[4 * i], pd[4 * i + 1], pd[4 * i + 2]]);
      n2++;
      for (let k = 0; k < 3; k++) {
        const b = Math.floor((x[k] - lo) / (hi - lo) * bins);
        if (b >= 0 && b < bins) H[k][b]++;
      }
    }
    return { lo, hi, bins, H: H.map((a) => Array.from(a, (v) => v / n2)), n: n2 };
  }

  // src/decode.js
  async function inflate(u8, raw = false) {
    const ds = new DecompressionStream(raw ? "deflate-raw" : "deflate");
    const buf = await new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer();
    return new Uint8Array(buf);
  }
  function lzw(input, expected) {
    const out = new Uint8Array(expected);
    let op = 0, bitPos = 0, codeLen = 9;
    let dict = [], prev = null;
    const reset = () => {
      dict = [];
      for (let i = 0; i < 256; i++) dict[i] = [i];
      dict[256] = null;
      dict[257] = null;
      codeLen = 9;
      prev = null;
    };
    const read = () => {
      let v = 0;
      for (let i = 0; i < codeLen; i++) {
        const byte = input[bitPos + i >> 3];
        v = v << 1 | byte >> 7 - (bitPos + i & 7) & 1;
      }
      bitPos += codeLen;
      return v;
    };
    reset();
    while (bitPos + codeLen <= input.length * 8 && op < expected) {
      const code = read();
      if (code === 256) {
        reset();
        continue;
      }
      if (code === 257) break;
      let entry;
      if (code < dict.length && dict[code]) entry = dict[code];
      else if (prev) entry = prev.concat([prev[0]]);
      else break;
      for (let i = 0; i < entry.length && op < expected; i++) out[op++] = entry[i];
      if (prev) dict.push(prev.concat([entry[0]]));
      prev = entry;
      const n2 = dict.length + 1;
      if (n2 >= 512 && codeLen === 9) codeLen = 10;
      else if (n2 >= 1024 && codeLen === 10) codeLen = 11;
      else if (n2 >= 2048 && codeLen === 11) codeLen = 12;
    }
    return out;
  }
  function packbits(input, expected) {
    const out = new Uint8Array(expected);
    let ip = 0, op = 0;
    while (ip < input.length && op < expected) {
      const n2 = input[ip] << 24 >> 24;
      ip++;
      if (n2 >= 0) {
        for (let i = 0; i <= n2; i++) out[op++] = input[ip++];
      } else if (n2 !== -128) {
        const b = input[ip++];
        for (let i = 0; i < 1 - n2; i++) out[op++] = b;
      }
    }
    return out;
  }
  async function decodeTIFF(buf) {
    const dv = new DataView(buf), le = dv.getUint16(0) === 18761;
    const u16 = (o) => dv.getUint16(o, le), u32 = (o) => dv.getUint32(o, le);
    if (u16(2) !== 42) throw new Error("not a TIFF (BigTIFF is not supported)");
    const SZ = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8 };
    const readIFD = (off2) => {
      const n2 = u16(off2), tags = {};
      for (let i = 0; i < n2; i++) {
        const e = off2 + 2 + 12 * i, tag = u16(e), type = u16(e + 2), count = u32(e + 4), size = (SZ[type] || 1) * count;
        const at = size <= 4 ? e + 8 : u32(e + 8), vals = [];
        for (let k = 0; k < Math.min(count, 1 << 20); k++) {
          const p = at + k * (SZ[type] || 1);
          vals.push(type === 3 || type === 8 ? u16(p) : type === 4 || type === 9 || type === 13 ? u32(p) : type === 11 ? dv.getFloat32(p, le) : type === 12 ? dv.getFloat64(p, le) : type === 5 ? u32(p) / u32(p + 4) : dv.getUint8(p));
        }
        tags[tag] = vals;
      }
      return { tags, next: u32(off2 + 2 + 12 * n2) };
    };
    const ifds = [];
    let off = u32(4), guard = 0;
    while (off && guard++ < 50) {
      const d = readIFD(off);
      ifds.push(d.tags);
      if (d.tags[330]) for (const s of d.tags[330]) ifds.push(readIFD(s).tags);
      off = d.next;
    }
    const cand = ifds.filter((t) => t[256] && t[257] && !(t[254] && t[254][0] & 1)).sort((a, b) => b[256][0] * b[257][0] - a[256][0] * a[257][0]);
    const T = cand[0] || ifds[0];
    const w = T[256][0], h = T[257][0], spp = (T[277] || [1])[0], bits = (T[258] || [8])[0], comp = (T[259] || [1])[0], pred = (T[317] || [1])[0];
    const fmt = (T[339] || [1])[0], planar = (T[284] || [1])[0], photometric = (T[262] || [2])[0];
    if (photometric === 32803) throw new Error("this TIFF/DNG holds an undemosaiced mosaic; export a linear (demosaiced) TIFF or DNG instead");
    if (![8, 16, 32].includes(bits)) throw new Error(`TIFF with ${bits}-bit samples is not supported`);
    const bps = bits / 8, tiled = !!T[322];
    const tw = tiled ? T[322][0] : w, th = tiled ? T[323][0] : T[278] ? T[278][0] : h;
    const offs = tiled ? T[324] : T[273], cnts = tiled ? T[325] : T[279];
    const out = new Float32Array(w * h * 3), across = Math.ceil(w / tw), planes = planar === 2 ? spp : 1, spPlane = planar === 2 ? 1 : spp;
    const blocksPerPlane = tiled ? across * Math.ceil(h / th) : Math.ceil(h / th);
    const maxv = fmt === 3 ? 1 : (1 << bits) - 1;
    for (let b = 0; b < offs.length; b++) {
      const plane = Math.floor(b / blocksPerPlane), bi = b % blocksPerPlane;
      const bx = tiled ? bi % across * tw : 0, by = tiled ? Math.floor(bi / across) * th : bi * th;
      const rows = tiled ? th : Math.min(th, h - by), cols = tiled ? tw : w, expected = rows * cols * spPlane * bps;
      let data = new Uint8Array(buf, offs[b], cnts[b]);
      if (comp === 5) data = lzw(data, expected);
      else if (comp === 8 || comp === 32946) data = await inflate(data);
      else if (comp === 32773) data = packbits(data, expected);
      else if (comp !== 1) throw new Error(`TIFF compression ${comp} is not supported (use none, LZW or deflate)`);
      const bdv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const rowBytes = cols * spPlane * bps;
      if (pred === 2) for (let r = 0; r < rows; r++) for (let c = 1; c < cols; c++) for (let s = 0; s < spPlane; s++) {
        const p = r * rowBytes + (c * spPlane + s) * bps, q = p - spPlane * bps;
        if (bps === 1) data[p] = data[p] + data[q] & 255;
        else if (bps === 2) bdv.setUint16(p, bdv.getUint16(p, le) + bdv.getUint16(q, le) & 65535, le);
      }
      for (let r = 0; r < rows; r++) {
        const y = by + r;
        if (y >= h) break;
        for (let c = 0; c < cols; c++) {
          const x = bx + c;
          if (x >= w) break;
          for (let s = 0; s < spPlane; s++) {
            const ch = planar === 2 ? plane : s;
            if (ch > 2 && spp > 1) continue;
            const p = (r * cols + c) * spPlane * bps + s * bps;
            if (p + bps > data.length) continue;
            const v = bps === 1 ? data[p] : bps === 2 ? bdv.getUint16(p, le) : fmt === 3 ? bdv.getFloat32(p, le) : bdv.getUint32(p, le);
            const val = v / maxv, o = 3 * (y * w + x);
            if (spp === 1) {
              out[o] = out[o + 1] = out[o + 2] = val;
            } else out[o + ch] = val;
          }
        }
      }
    }
    const isDNG = ifds.some((t) => t[50706]);
    return { w, h, data: out, bits, encodedHint: bits === 8 ? "srgb" : "linear", kind: isDNG ? "DNG" : "TIFF" };
  }
  async function decodePNG(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf);
    let p = 8, w = 0, h = 0, depth = 8, ctype = 2;
    const idat = [];
    while (p < u8.length) {
      const len = dv.getUint32(p), type = String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]);
      if (type === "IHDR") {
        w = dv.getUint32(p + 8);
        h = dv.getUint32(p + 12);
        depth = u8[p + 16];
        ctype = u8[p + 17];
        if (u8[p + 20]) throw new Error("interlaced PNG is not supported");
      } else if (type === "IDAT") idat.push(u8.subarray(p + 8, p + 8 + len));
      else if (type === "IEND") break;
      p += 12 + len;
    }
    if (depth !== 16 && depth !== 8) throw new Error(`PNG bit depth ${depth} is not supported`);
    const nch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ctype];
    if (!nch) throw new Error("palette PNGs are not supported");
    const all = new Uint8Array(idat.reduce((s, a) => s + a.length, 0));
    let o = 0;
    for (const a of idat) {
      all.set(a, o);
      o += a.length;
    }
    const raw = await inflate(all), bpp = nch * depth / 8, stride = w * bpp, cur = new Uint8Array(stride), prev = new Uint8Array(stride);
    const out = new Float32Array(w * h * 3), maxv = depth === 16 ? 65535 : 255;
    let ip = 0;
    for (let y = 0; y < h; y++) {
      const f = raw[ip++];
      cur.set(raw.subarray(ip, ip + stride));
      ip += stride;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
        let v = cur[i];
        if (f === 1) v += a;
        else if (f === 2) v += b;
        else if (f === 3) v += a + b >> 1;
        else if (f === 4) {
          const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        cur[i] = v & 255;
      }
      for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) {
        const ch = nch < 3 ? 0 : k, q = x * bpp + ch * depth / 8;
        const v = depth === 16 ? cur[q] << 8 | cur[q + 1] : cur[q];
        out[3 * (y * w + x) + k] = v / maxv;
      }
      prev.set(cur);
    }
    return { w, h, data: out, bits: depth, encodedHint: "srgb", kind: "PNG" };
  }
  async function decodeBrowser(blob) {
    const bmp = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
    const c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(bmp.width, bmp.height) : Object.assign(document.createElement("canvas"), { width: bmp.width, height: bmp.height });
    const ctx = c.getContext("2d");
    ctx.drawImage(bmp, 0, 0);
    const id = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    const out = new Float32Array(bmp.width * bmp.height * 3);
    for (let i = 0; i < bmp.width * bmp.height; i++) {
      out[3 * i] = id[4 * i] / 255;
      out[3 * i + 1] = id[4 * i + 1] / 255;
      out[3 * i + 2] = id[4 * i + 2] / 255;
    }
    return { w: bmp.width, h: bmp.height, data: out, bits: 8, encodedHint: "srgb", kind: "image" };
  }
  async function decodeFile(file) {
    const buf = await file.arrayBuffer(), u8 = new Uint8Array(buf, 0, 8), name = (file.name || "").toLowerCase();
    if (u8[0] === 73 && u8[1] === 73 || u8[0] === 77 && u8[1] === 77) return decodeTIFF(buf);
    if (u8[0] === 137 && u8[1] === 80) {
      const v = new DataView(buf);
      if (buf.byteLength > 25 && new Uint8Array(buf)[24] === 16) return decodePNG(buf);
    }
    if (/\.(raf|nef|cr2|cr3|arw|orf|rw2|pef)$/.test(name)) throw new Error(`${file.name}: camera raw files are not decoded yet. Export a linear 16-bit TIFF (for example with dcraw -4 -T, LibRaw's dcraw_emu, or RawTherapee with a neutral, linear profile).`);
    return decodeBrowser(new Blob([buf]));
  }
  var srgbDecode = (v) => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);

  // src/source.js
  var FORMATS = [["135", "35 mm (36 × 24)", 36, 24], ["645", "6 × 4.5 (56 × 41.5)", 56, 41.5], ["66", "6 × 6 (56 × 56)", 56, 56], ["67", "6 × 7 (69.5 × 56)", 69.5, 56], ["45", "4 × 5 in (120 × 95)", 120, 95]];
  var WORK = 2048;
  var GLOBAL = 640;
  function mergeTriplet(files, { mode = "own" } = {}) {
    const [a] = files;
    for (const f of files) if (f.w !== a.w || f.h !== a.h) throw new Error("the three exposures differ in size");
    const N = a.w * a.h, out = new Float32Array(N * 3);
    files.forEach((f, k) => {
      for (let i = 0; i < N; i++) out[3 * i + k] = mode === "own" ? f.data[3 * i + k] : (f.data[3 * i] + f.data[3 * i + 1] + f.data[3 * i + 2]) / 3;
    });
    return { w: a.w, h: a.h, data: out, bits: a.bits, encodedHint: a.encodedHint, kind: "triplet" };
  }
  function orient(img, { flipH = false, flipV = false, rotate = 0 }) {
    const r = (rotate % 360 + 360) % 360, sw = img.w, sh = img.h, w = r % 180 ? sh : sw, h = r % 180 ? sw : sh;
    const map = (x, y) => {
      let u, v;
      if (r === 0) {
        u = x;
        v = y;
      } else if (r === 90) {
        u = y;
        v = sh - 1 - x;
      } else if (r === 180) {
        u = sw - 1 - x;
        v = sh - 1 - y;
      } else {
        u = sw - 1 - y;
        v = x;
      }
      if (flipH) u = sw - 1 - u;
      if (flipV) v = sh - 1 - v;
      return v * sw + u;
    };
    return { w, h, map };
  }
  var FLATS = /* @__PURE__ */ new Map();
  var FLAT_DETAIL = { smooth: 96, fine: 512 };
  function flatGrid(flat, transfer, long = 96) {
    const gw = flat.w >= flat.h ? long : Math.max(2, Math.round(long * flat.w / flat.h)), gh = flat.w >= flat.h ? Math.max(2, Math.round(long * flat.h / flat.w)) : long;
    let g = new Float32Array(gw * gh * 3);
    const n2 = new Float32Array(gw * gh);
    for (let y = 0; y < flat.h; y++) {
      const gy = Math.min(gh - 1, Math.floor(y / flat.h * gh));
      for (let x = 0; x < flat.w; x++) {
        const gx = Math.min(gw - 1, Math.floor(x / flat.w * gw)), q = gy * gw + gx, i = 3 * (y * flat.w + x);
        g[3 * q] += flat.data[i];
        g[3 * q + 1] += flat.data[i + 1];
        g[3 * q + 2] += flat.data[i + 2];
        n2[q]++;
      }
    }
    for (let q = 0; q < gw * gh; q++) for (let k = 0; k < 3; k++) g[3 * q + k] = transfer(g[3 * q + k] / Math.max(1, n2[q]));
    const passes = long > 200 ? 1 : 2;
    for (let p = 0; p < passes; p++) for (const horiz of [true, false]) {
      const o = new Float32Array(g.length);
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) for (let k = 0; k < 3; k++) {
        let s = 0, w = 0;
        for (let d = -1; d <= 1; d++) {
          const xx = horiz ? x + d : x, yy = horiz ? y : y + d;
          if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
          const wt = d ? 1 : 2;
          s += wt * g[3 * (yy * gw + xx) + k];
          w += wt;
        }
        o[3 * (y * gw + x) + k] = s / w;
      }
      g = o;
    }
    const mean = [0, 1, 2].map((k) => {
      let s = 0;
      for (let q = 0; q < gw * gh; q++) s += g[3 * q + k];
      return s / (gw * gh) || 1;
    });
    let lo = [Infinity, Infinity, Infinity], hi = [0, 0, 0];
    for (let q = 0; q < gw * gh; q++) for (let k = 0; k < 3; k++) {
      const v = Math.max(0.05, g[3 * q + k] / mean[k]);
      g[3 * q + k] = v;
      if (v > 0.2) {
        lo[k] = Math.min(lo[k], v);
        hi[k] = Math.max(hi[k], v);
      }
    }
    return { gw, gh, data: g, falloff: [0, 1, 2].map((k) => Math.log10(hi[k] / lo[k])) };
  }
  function flatAt(G, u, v, out) {
    const fx = Math.min(G.gw - 1, Math.max(0, u * G.gw - 0.5)), fy = Math.min(G.gh - 1, Math.max(0, v * G.gh - 0.5)), x0 = Math.min(G.gw - 2, Math.floor(fx)), y0 = Math.min(G.gh - 2, Math.floor(fy)), ax = fx - x0, ay = fy - y0;
    for (let k = 0; k < 3; k++) {
      const a = G.data[3 * (y0 * G.gw + x0) + k], b = G.data[3 * (y0 * G.gw + x0 + 1) + k], c = G.data[3 * ((y0 + 1) * G.gw + x0) + k], d = G.data[3 * ((y0 + 1) * G.gw + x0 + 1) + k];
      out[k] = (a * (1 - ax) + b * ax) * (1 - ay) + (c * (1 - ax) + d * ax) * ay;
    }
    return out;
  }
  function sigmaD(data, w, h, Treb, keep = null, R = 4) {
    const out = [];
    for (let k = 0; k < 3; k++) {
      const D = new Float32Array(w * h), m = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) {
        D[i] = -Math.log10(Math.max(data[3 * i + k], 1e-6) / Treb[k]);
        m[i] = !keep || keep(i) ? 1 : 0;
      }
      const S = new Float64Array((w + 1) * (h + 1)), C = new Float64Array((w + 1) * (h + 1));
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x, q = (y + 1) * (w + 1) + x + 1;
        S[q] = (m[i] ? D[i] : 0) + S[q - 1] + S[q - w - 1] - S[q - w - 2];
        C[q] = m[i] + C[q - 1] + C[q - w - 1] - C[q - w - 2];
      }
      const box = (T, x0, y0, x1, y1) => T[y1 * (w + 1) + x1] - T[y0 * (w + 1) + x1] - T[y1 * (w + 1) + x0] + T[y0 * (w + 1) + x0];
      const dev = [];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!m[i]) continue;
        const x0 = Math.max(0, x - R), y0 = Math.max(0, y - R), x1 = Math.min(w, x + R + 1), y1 = Math.min(h, y + R + 1), n2 = box(C, x0, y0, x1, y1);
        if (n2 < 9) continue;
        const mu = (box(S, x0, y0, x1, y1) - D[i]) / (n2 - 1);
        dev.push(Math.abs(D[i] - mu));
      }
      if (dev.length < 60) return null;
      dev.sort((a, b) => a - b);
      out.push(Math.max(1e-4, 1.4826 * dev[dev.length >> 1]));
    }
    return out;
  }
  var Z_NOISE = 3;
  function classify(T, Treb, sig, residual) {
    const D = [0, 1, 2].map((k) => -Math.log10(Math.max(T[k], 1e-6) / Treb[k])), z = D.map((v, k) => v / sig[k]), zmin = Math.min(...z);
    const cls = zmin < -Z_NOISE ? "below" : zmin <= Z_NOISE ? "blank" : residual > 0.01 ? "gamut" : "ok";
    return { cls, D, z, layers: [0, 1, 2].filter((k) => cls === "below" ? z[k] < -Z_NOISE : Math.abs(z[k]) <= Z_NOISE) };
  }
  var _Source = class _Source {
    // img: decoded { w, h, data }, settings: { encoding, flipH, flipV, rotate, crop, rebate, format }
    constructor(img, meta = {}) {
      this.img = img;
      this.meta = meta;
      this.cache = /* @__PURE__ */ new Map();
      this.uid = ++_Source.n;
    }
    transfer(enc) {
      return enc === "srgb" ? srgbDecode : enc === "gamma22" ? (v) => Math.pow(Math.max(v, 0), 2.2) : (v) => v;
    }
    geometry(s) {
      return orient(this.img, s);
    }
    // linear pixel values of an oriented rectangle, area-averaged down by an integer-free factor to (tw, th)
    region(s, [x0, y0, w, h], tw, th) {
      const O = this.geometry(s), d = this.img.data, f = this.transfer(s.encoding), out = new Float32Array(tw * th * 3);
      const sx = w / tw, sy = h / th, G = this.flat(s), sw = this.img.w, sh = this.img.h, F = [1, 1, 1];
      for (let ty = 0; ty < th; ty++) {
        const ya = y0 + ty * sy, yb = ya + sy;
        for (let tx = 0; tx < tw; tx++) {
          const xa = x0 + tx * sx, xb = xa + sx;
          let r = 0, g = 0, b = 0, n2 = 0;
          for (let y = Math.floor(ya); y < Math.ceil(yb); y++) {
            if (y < 0 || y >= O.h) continue;
            for (let x = Math.floor(xa); x < Math.ceil(xb); x++) {
              if (x < 0 || x >= O.w) continue;
              const q = 3 * O.map(x, y);
              r += d[q];
              g += d[q + 1];
              b += d[q + 2];
              n2++;
            }
          }
          const o = 3 * (ty * tw + tx);
          n2 = n2 || 1;
          out[o] = f(r / n2);
          out[o + 1] = f(g / n2);
          out[o + 2] = f(b / n2);
          if (G) {
            const cxp = Math.min(O.w - 1, Math.max(0, Math.floor(xa + sx / 2))), cyp = Math.min(O.h - 1, Math.max(0, Math.floor(ya + sy / 2))), q = O.map(cxp, cyp);
            flatAt(G, (q % sw + 0.5) / sw, (Math.floor(q / sw) + 0.5) / sh, F);
            out[o] /= F[0];
            out[o + 1] /= F[1];
            out[o + 2] /= F[2];
          }
        }
      }
      return out;
    }
    // the flat-field grid for these settings, or null (no flat, not loaded in this session, or a different shape)
    flat(s) {
      const fl = s.flat, F = fl && FLATS.get(fl.id);
      if (!F) return null;
      if (Math.abs(F.w / F.h - this.img.w / this.img.h) > 0.01 * this.img.w / this.img.h) return null;
      const key = [fl.id, fl.detail || "smooth", s.encoding].join(":");
      if (this.flatKey !== key) {
        this.flatKey = key;
        this.flatG = flatGrid(F, this.transfer(s.encoding), FLAT_DETAIL[fl.detail] || FLAT_DETAIL.smooth);
      }
      return this.flatG;
    }
    // noise σ of density at a resolution (scale = output px per source px): from the rebate box when there is one, else
    // from the thin, flat parts of the frame itself
    noise(s, Treb, scale2, img) {
      if (s.rebate && s.rebate.box) {
        const [x, y, w, h] = s.rebate.box, bw = Math.max(2, Math.round(w * scale2)), bh = Math.max(2, Math.round(h * scale2));
        const r2 = sigmaD(this.region(s, [x, y, w, h], bw, bh), bw, bh, Treb);
        if (r2) return { sig: r2, from: "rebate" };
      }
      const thin = (i) => {
        for (let k = 0; k < 3; k++) if (-Math.log10(Math.max(img.data[3 * i + k], 1e-6) / Treb[k]) > 0.08) return false;
        return true;
      };
      const r = sigmaD(img.data, img.w, img.h, Treb, thin);
      if (r) return { sig: r, from: "frame" };
      return { sig: [0.01, 0.01, 0.01].map((v) => v * Math.min(1, scale2)), from: "assumed" };
    }
    crop(s) {
      const O = this.geometry(s);
      const c = s.crop;
      return c ? [Math.max(0, c[0]), Math.max(0, c[1]), Math.min(O.w - Math.max(0, c[0]), c[2]), Math.min(O.h - Math.max(0, c[1]), c[3])] : [0, 0, O.w, O.h];
    }
    // the rebate's transmittance: the mean of a picked box, or a bright percentile of the whole scan
    rebate(s) {
      const O = this.geometry(s);
      if (s.rebate && s.rebate.box) {
        const [x, y, w, h] = s.rebate.box, bw = Math.max(1, Math.min(64, Math.round(w))), bh = Math.max(1, Math.min(64, Math.round(h))), v = this.region(s, [x, y, w, h], bw, bh);
        return [0, 1, 2].map((k) => {
          let t = 0;
          for (let i = k; i < v.length; i += 3) t += v[i];
          return t / (bw * bh);
        });
      }
      const sm = this.region(s, this.crop(s), 256, Math.max(1, Math.round(256 * this.crop(s)[3] / this.crop(s)[2])));
      return [0, 1, 2].map((k) => {
        const a = [];
        for (let i = k; i < sm.length; i += 3) a.push(sm[i]);
        a.sort((p, q) => p - q);
        return a[Math.floor(a.length * 0.997)] * 1.02;
      });
    }
    // physical size of the cropped frame in µm: its long side is the format's long side
    filmUm(s) {
      const F = FORMATS.find((f) => f[0] === (s.format || "135")) || FORMATS[0], c = this.crop(s), long = Math.max(F[2], F[3]) * 1e3;
      return c[2] >= c[3] ? [long, long * c[3] / c[2]] : [long * c[2] / c[3], long];
    }
    // the reduced images for the renderer, cached on the geometry and transfer
    working(s) {
      const fl = this.flat(s) ? [s.flat.id, s.flat.detail || "smooth"] : null;
      const key = JSON.stringify([this.uid, s.encoding, s.flipH, s.flipV, s.rotate, s.crop, s.rebate, s.format, fl]);
      if (this.cache.has(key)) return this.cache.get(key);
      const c = this.crop(s), sc = Math.min(1, WORK / Math.max(c[2], c[3])), w = Math.max(1, Math.round(c[2] * sc)), h = Math.max(1, Math.round(c[3] * sc));
      const sg = Math.min(1, GLOBAL / Math.max(c[2], c[3])), gw = Math.max(1, Math.round(c[2] * sg)), gh = Math.max(1, Math.round(c[3] * sg));
      const out = { w, h, data: this.region(s, c, w, h), gw, gh, gdata: this.region(s, c, gw, gh), Treb: this.rebate(s), filmUm: this.filmUm(s), crop: c, fullW: c[2], fullH: c[3], key };
      const nw = this.noise(s, out.Treb, sc, { data: out.data, w, h }), ng = this.noise(s, out.Treb, sg, { data: out.gdata, w: gw, h: gh });
      out.sig = { work: nw.sig, global: ng.sig, from: nw.from };
      out.flat = fl ? this.flatG : null;
      this.cache.clear();
      this.cache.set(key, out);
      return out;
    }
    // full-resolution tiles of the cropped frame, for export
    tile(s, x0, y0, w, h) {
      const c = this.crop(s);
      return this.region(s, [c[0] + x0, c[1] + y0, w, h], w, h);
    }
    // the whole oriented scan at preview size (for picking the crop and the rebate)
    overview(s, long = 1200) {
      const O = this.geometry(s), sc = Math.min(1, long / Math.max(O.w, O.h)), w = Math.round(O.w * sc), h = Math.round(O.h * sc);
      return { w, h, scale: sc, data: this.region(s, [0, 0, O.w, O.h], w, h), W: O.w, H: O.h };
    }
  };
  __publicField(_Source, "n", 0);
  var Source = _Source;
  async function loadSample(url, meta) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("could not load the sample scan");
    const buf = await res.arrayBuffer(), sig = new Uint8Array(buf, 0, 4);
    let u;
    if (sig[0] === 137 && sig[1] === 80) {
      const img = await decodePNG(buf);
      u = new Uint16Array(img.data.length);
      for (let i = 0; i < u.length; i++) u[i] = Math.round(img.data[i] * 65535);
    } else u = new Uint16Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
    const data = new Float32Array(u.length);
    for (let i = 0; i < u.length; i++) data[i] = Math.max(0.05, u[i] / 16 - 2) / 4e3;
    return { w: meta.w, h: meta.h, data, bits: 16, encodedHint: "linear", kind: "sample" };
  }

  // src/render.js
  var F32 = (a) => a instanceof Float32Array ? a : Float32Array.from(a);
  function toHalf(f32) {
    const out = new Uint16Array(f32.length), fv = new Float32Array(1), iv = new Uint32Array(fv.buffer);
    for (let i = 0; i < f32.length; i++) {
      fv[0] = f32[i];
      const x = iv[0], s = x >>> 16 & 32768;
      let e = (x >>> 23 & 255) - 112, m = x & 8388607;
      if (e <= 0) {
        out[i] = s | (e < -10 ? 0 : (m | 8388608) >> 1 - e + 13);
        continue;
      }
      if (e >= 31) {
        out[i] = s | 31744;
        continue;
      }
      out[i] = s | e << 10 | m + 4096 >> 13;
    }
    return out;
  }
  var Renderer = class {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true, alpha: false });
      if (!gl) throw new Error("This browser has no WebGL2.");
      this.gl = gl;
      if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("This GPU cannot render to float textures (EXT_color_buffer_float).");
      this.floatLinear = !!gl.getExtension("OES_texture_float_linear");
      gl.getExtension("EXT_float_blend");
      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      this.progs = {};
      for (const [k, fs] of Object.entries({ dyes: FS_DYES, pd: FS_PD, blur: FS_BLUR, gfprep: FS_GF_PREP, gfab: FS_GF_AB, print: FS_PRINT, bloomsrc: FS_BLOOMSRC, out: FS_OUT, view: FS_VIEW, copy: FS_COPY })) this.progs[k] = this.program(fs, k);
      this.targets = /* @__PURE__ */ new Map();
      this.luts = {};
      this.keys = {};
      this.noise = this.makeNoise();
      this.lastStats = null;
      this.statKey = null;
    }
    program(fs, name) {
      const gl = this.gl, sh = (t, s) => {
        const o = gl.createShader(t);
        gl.shaderSource(o, s);
        gl.compileShader(o);
        if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(`${name}: ${gl.getShaderInfoLog(o)}`);
        return o;
      };
      const p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
      gl.bindAttribLocation(p, 0, "p");
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`${name}: ${gl.getProgramInfoLog(p)}`);
      const u = {};
      const n2 = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n2; i++) {
        const a = gl.getActiveUniform(p, i);
        u[a.name.replace(/\[0\]$/, "")] = { loc: gl.getUniformLocation(p, a.name), type: a.type, size: a.size };
      }
      return { p, u };
    }
    placeholder(is3) {
      const gl = this.gl, k = is3 ? "ph3" : "ph2";
      if (this[k]) return this[k];
      const t = gl.createTexture(), z = new Uint8Array(4);
      if (is3) {
        gl.bindTexture(gl.TEXTURE_3D, t);
        gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, z);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      } else {
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, z);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      }
      return this[k] = t;
    }
    // ---------- textures
    tex2D(w, h, data, { float32 = true, filter = "linear", wrap = "clamp", mip = false } = {}) {
      const gl = this.gl, t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      const use32 = float32 && (filter === "nearest" || this.floatLinear);
      if (use32) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, data ? F32(data) : null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, data ? toHalf(F32(data)) : null);
      const f = filter === "linear" ? gl.LINEAR : gl.NEAREST;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : f);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
      const wr = wrap === "repeat" ? gl.REPEAT : gl.CLAMP_TO_EDGE;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wr);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wr);
      if (mip) gl.generateMipmap(gl.TEXTURE_2D);
      return { t, w, h, f32: use32 };
    }
    tex3D(T) {
      const gl = this.gl, t = gl.createTexture(), N = T.N;
      gl.bindTexture(gl.TEXTURE_3D, t);
      if (this.floatLinear) gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA32F, N, N, N, 0, gl.RGBA, gl.FLOAT, F32(T.data));
      else gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, N, N, N, 0, gl.RGBA, gl.HALF_FLOAT, toHalf(F32(T.data)));
      for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_3D, p, gl.LINEAR);
      for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE);
      return { t, N };
    }
    // a render target, reused by name and size
    target(name, w, h, { float32 = true, filter = "linear", byte = false } = {}) {
      const key = name;
      let T = this.targets.get(key);
      if (T && T.w === w && T.h === h) return T;
      const gl = this.gl;
      if (T) {
        gl.deleteTexture(T.t);
        gl.deleteFramebuffer(T.fb);
      }
      let tex2;
      if (byte) {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        tex2 = { t, w, h };
      } else tex2 = this.tex2D(w, h, null, { float32, filter });
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex2.t, 0);
      const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error("framebuffer incomplete: " + name + " " + st);
      T = Object.assign(tex2, { fb, byte });
      this.targets.set(key, T);
      return T;
    }
    makeNoise() {
      const N = 1024, a = new Float32Array(N * N * 4);
      let seed = 12345;
      const rnd = () => {
        seed = seed * 1664525 + 1013904223 >>> 0;
        return seed / 4294967296;
      };
      const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
      for (let i = 0; i < N * N; i++) for (let c = 0; c < 3; c++) a[4 * i + c] = gauss();
      const blur = (src, horiz) => {
        const out = new Float32Array(src.length), w = [0.0855, 0.2427, 0.3436, 0.2427, 0.0855];
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) for (let c = 0; c < 3; c++) {
          let s = 0;
          for (let k = -2; k <= 2; k++) {
            const xx = horiz ? (x + k + N) % N : x, yy = horiz ? y : (y + k + N) % N;
            s += w[k + 2] * src[4 * (yy * N + xx) + c];
          }
          out[4 * (y * N + x) + c] = s;
        }
        return out;
      };
      let b = blur(blur(a, true), false);
      let sd = 0;
      for (let i = 0; i < N * N; i++) sd += b[4 * i] * b[4 * i];
      sd = Math.sqrt(sd / (N * N));
      for (let i = 0; i < b.length; i++) b[i] /= sd;
      const sig = [1];
      let cur = b, n2 = N;
      while (n2 > 8) {
        const m = n2 / 2, nx = new Float32Array(m * m * 4);
        let s2 = 0;
        for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) {
          const v = (cur[4 * (2 * y * n2 + 2 * x)] + cur[4 * (2 * y * n2 + 2 * x + 1)] + cur[4 * ((2 * y + 1) * n2 + 2 * x)] + cur[4 * ((2 * y + 1) * n2 + 2 * x + 1)]) / 4;
          nx[4 * (y * m + x)] = v;
          s2 += v * v;
        }
        sig.push(Math.sqrt(s2 / (m * m)));
        cur = nx;
        n2 = m;
      }
      this.noiseSigma = sig;
      return this.tex2D(N, N, b, { float32: false, filter: "linear", wrap: "repeat", mip: true });
    }
    // ---------- model and source
    setModel(m) {
      const k = m.keys, up = (name, key, T) => {
        if (this.keys[name] !== key) {
          if (this.luts[name]) this.gl.deleteTexture(this.luts[name].t);
          this.luts[name] = this.tex3D(T);
          this.keys[name] = key;
        }
      };
      up("solve", k.solve, m.solve);
      up("pdA", `${m.film.name}:${k.paper}`, m.pd);
      up("print", `${k.paper}:${k.fade}`, m.print);
      up("pdB", m.reshoot ? `${m.reshoot.stock.name}:${k.paper}` : "none", m.reshoot ? m.reshoot.pd : m.pd);
      const ck = `${m.film.name}:${k.paper}:${k.reshoot}`;
      if (this.keys.curves !== ck) {
        const rows = [m.fwd, m.inv, m.pcurves, m.reshoot ? m.reshoot.map : m.inv], N = 512, a = new Float32Array(N * 4 * 4);
        rows.forEach((r, j) => a.set(r.data, j * N * 4));
        if (this.luts.curves) this.gl.deleteTexture(this.luts.curves.t);
        this.luts.curves = this.tex2D(N, 4, a, { filter: "linear" });
        this.keys.curves = ck;
      }
      this.model = m;
    }
    // src: { w, h, data: Float32Array RGB (transmittance, any scale), Treb, filmUm: [w µm, h µm] }, plus the global copy
    setSource(src, key) {
      if (this.keys.src === key) return;
      const gl = this.gl, rgba = (d, n2) => {
        const a = new Float32Array(n2 * 4);
        for (let i = 0; i < n2; i++) {
          a[4 * i] = d[3 * i];
          a[4 * i + 1] = d[3 * i + 1];
          a[4 * i + 2] = d[3 * i + 2];
          a[4 * i + 3] = 1;
        }
        return a;
      };
      for (const n2 of ["src", "srcG"]) if (this.luts[n2]) gl.deleteTexture(this.luts[n2].t);
      this.luts.src = this.tex2D(src.w, src.h, rgba(src.data, src.w * src.h), { float32: false, filter: "linear" });
      this.luts.srcG = this.tex2D(src.gw, src.gh, rgba(src.gdata, src.gw * src.gh), { float32: false, filter: "linear" });
      this.src = src;
      this.keys.src = key;
      this.statKey = null;
    }
    // ---------- one pass
    pass(name, target, uni, texs = {}) {
      const gl = this.gl, P = this.progs[name];
      gl.useProgram(P.p);
      if (target) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
        gl.viewport(0, 0, target.w, target.h);
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      }
      let unit = 0;
      for (const [k, v] of Object.entries(texs)) {
        const u = P.u[k];
        if (!u || !v) continue;
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(v.N ? gl.TEXTURE_3D : gl.TEXTURE_2D, v.t);
        gl.uniform1i(u.loc, unit);
        unit++;
      }
      for (const [k, u] of Object.entries(P.u)) {
        if (u.type !== gl.SAMPLER_2D && u.type !== gl.SAMPLER_3D || texs[k] && P.u[k]) continue;
        const is3 = u.type === gl.SAMPLER_3D;
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(is3 ? gl.TEXTURE_3D : gl.TEXTURE_2D, this.placeholder(is3));
        gl.uniform1i(u.loc, unit);
        unit++;
      }
      for (const [k, v] of Object.entries(uni)) {
        const u = P.u[k];
        if (!u) continue;
        const t = u.type;
        if (t === gl.FLOAT) gl.uniform1f(u.loc, v);
        else if (t === gl.FLOAT_VEC2) gl.uniform2fv(u.loc, v);
        else if (t === gl.FLOAT_VEC3) gl.uniform3fv(u.loc, v);
        else if (t === gl.FLOAT_VEC4) gl.uniform4fv(u.loc, v);
        else if (t === gl.FLOAT_MAT3) gl.uniformMatrix3fv(u.loc, false, v);
        else if (t === gl.INT) gl.uniform1i(u.loc, v);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    // wait for the GPU: gl.finish() does not block in browsers (Chrome treats it as a flush), so the only reliable wait is
    // to read something back. One texel of the last target is enough: reads are ordered after all queued drawing.
    sync(name = "out") {
      const t = this.targets.get(name);
      if (!t) return;
      const gl = this.gl, px = t.byte ? new Uint8Array(4) : new Float32Array(4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, t.byte ? gl.UNSIGNED_BYTE : gl.FLOAT, px);
    }
    // the weights of two 1-D kernels (Gaussian of σ = r, or box of half-width r), normalised, for FS_BLUR
    blurKernel(r, gauss) {
      const Rk = r.map((v) => Math.min(96, Math.ceil(gauss ? 3 * v : v))), R = Math.max(1, ...Rk), kw = new Float32Array(194);
      for (let c = 0; c < 2; c++) {
        let sum = 0;
        for (let i = 0; i <= Rk[c]; i++) {
          const w = gauss ? Math.exp(-0.5 * i * i / Math.max(r[c] * r[c], 1e-4)) : i <= r[c] ? 1 : 0;
          kw[2 * i + c] = w;
          sum += i ? 2 * w : w;
        }
        for (let i = 0; i <= 96; i++) kw[2 * i + c] /= sum;
      }
      return { R, kw };
    }
    read(target) {
      const gl = this.gl, out = new Float32Array(target.w * target.h * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
      gl.readPixels(0, 0, target.w, target.h, gl.RGBA, gl.FLOAT, out);
      return out;
    }
    readBytes(target) {
      const gl = this.gl, out = new Uint8Array(target.w * target.h * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
      gl.readPixels(0, 0, target.w, target.h, gl.RGBA, gl.UNSIGNED_BYTE, out);
      return out;
    }
    // ---------- the uniforms shared by the dye and density passes
    negUniforms(P, src, w, h) {
      const m = this.model, Ki = m.solve.Kinv;
      return {
        Treb: src.Treb,
        Kinv: [Ki[0][0], Ki[1][0], Ki[2][0], Ki[0][1], Ki[1][1], Ki[2][1], Ki[0][2], Ki[1][2], Ki[2][2]],
        aR: m.solve.range,
        xR: m.fwd.range,
        cR: m.inv.range,
        dyeSat: P.dyeSat,
        halAmt: P.halAmt,
        emitE: 0,
        texel: [1 / w, 1 / h],
        reshoot: P.reshoot,
        filmUm: src.filmUm,
        grainTexUm: 3 * P.grainSize,
        grainAmt: P.grain,
        grainNorm: this.grainNorm(P.grainSize),
        reduce: P.reduce
      };
    }
    grainNorm(size) {
      const lev = Math.log2(24 / (3 * size)), i = Math.max(0, Math.min(this.noiseSigma.length - 2, Math.floor(lev))), f = Math.max(0, Math.min(1, lev - i));
      const s = Math.exp((1 - f) * Math.log(this.noiseSigma[i]) + f * Math.log(this.noiseSigma[i + 1]));
      return 1 / s;
    }
    // ---------- the global pass: statistics, bases, halation and bloom blurs at low resolution
    global(s, roll, negKey) {
      const m = this.model, src = this.src, w = src.gw, h = src.gh, long = Math.max(w, h), gl = this.gl;
      const P0 = frameParams(m, s, this.lastStats, roll);
      const NU = this.negUniforms(P0, src, w, h), g2 = [0, 0, 1, 1];
      const tex2 = { src: this.luts.srcG, solve: this.luts.solve, curves: this.luts.curves, pdA: this.luts.pdA, pdB: this.luts.pdB, noise: this.noise };
      let halT = this.target("halE", w, h);
      if (P0.halAmt[0] > 0) {
        this.pass("dyes", this.target("cG0", w, h), { ...NU, emitE: 1, halAmt: [0, 0], g2 }, tex2);
        const r = K.HAL_RADII.map((f) => f * long);
        this.pass("blur", this.target("halH", w, h), { dir: [1 / w, 0], ...this.blurKernel(r, 1), g2 }, { t: this.targets.get("cG0") });
        this.pass("blur", halT, { dir: [0, 1 / h], ...this.blurKernel(r, 1), g2 }, { t: this.targets.get("halH") });
      }
      this.pass("dyes", this.target("cG", w, h, { filter: "nearest" }), { ...NU, g2 }, { ...tex2, hal: halT });
      this.pass("pd", this.target("pdG", w, h), { ...NU, g2, grainAmt: 0 }, { ...tex2, dyes: this.targets.get("cG") });
      if (this.statKey !== negKey) {
        const pd = this.read(this.targets.get("pdG"));
        this.lastStats = frameStats(pd, w, h);
        this.lastPD = { data: pd, w, h };
        this.statKey = negKey;
        const c = this.read(this.targets.get("cG")), T = src.gdata, Tr = src.Treb, sg = src.sig.global, N = w * h, Z = Z_NOISE, n2 = { bad: 0, blank: 0, below: 0, gamut: 0 };
        for (let i = 0; i < N; i++) {
          let zm = Infinity;
          for (let k = 0; k < 3; k++) zm = Math.min(zm, -Math.log10(Math.max(T[3 * i + k], 1e-6) / Tr[k]) / sg[k]);
          const bad = c[4 * i + 3] > 0.01;
          if (bad) n2.bad++;
          if (zm < -Z) n2.below++;
          else if (zm <= Z) n2.blank++;
          else if (bad) n2.gamut++;
        }
        Object.assign(this.lastStats, { unreachable: n2.bad / N, blank: n2.blank / N, below: n2.below / N, gamut: n2.gamut / N });
      }
      const P = frameParams(m, s, this.lastStats, roll);
      const rL = Math.max(1, K.MASK_RADIUS * long), rM = Math.max(1, K.MID_RADIUS * long);
      this.pass("gfprep", this.target("gf0", w, h), { g2 }, { pd: this.targets.get("pdG") });
      this.pass("blur", this.target("gf1", w, h), { dir: [1 / w, 0], ...this.blurKernel([rL, rM], 0), g2 }, { t: this.targets.get("gf0") });
      this.pass("blur", this.target("gf2", w, h), { dir: [0, 1 / h], ...this.blurKernel([rL, rM], 0), g2 }, { t: this.targets.get("gf1") });
      this.pass("gfab", this.target("gf3", w, h), { eps: [0.05 * 0.05, 0.03 * 0.03], g2 }, { m: this.targets.get("gf2") });
      this.pass("blur", this.target("gf4", w, h), { dir: [1 / w, 0], ...this.blurKernel([rL, rM], 0), g2 }, { t: this.targets.get("gf3") });
      this.pass("blur", this.target("base", w, h), { dir: [0, 1 / h], ...this.blurKernel([rL, rM], 0), g2 }, { t: this.targets.get("gf4") });
      if (P.bloom > 0) {
        this.pass("print", this.target("prG", w, h), this.printUniforms(P, w, h, g2), this.printTex("pdG"));
        const hw = Math.max(1, Math.round(w / 2)), hh = Math.max(1, Math.round(h / 2)), sb = 0.035 * long / 2;
        this.pass("bloomsrc", this.target("blo0", w, h), { g2 }, { t: this.targets.get("prG") });
        this.pass("blur", this.target("blo1", hw, hh), { dir: [1 / hw, 0], ...this.blurKernel([sb, sb], 1), g2 }, { t: this.targets.get("blo0") });
        this.pass("blur", this.target("bloom", hw, hh), { dir: [0, 1 / hh], ...this.blurKernel([sb, sb], 1), g2 }, { t: this.targets.get("blo1") });
      } else this.target("bloom", 1, 1);
      return P;
    }
    printUniforms(P, w, h, g2) {
      const m = this.model, src = this.src;
      return {
        g2,
        texel: [1 / w, 1 / h],
        clearL: P.clearL,
        g: P.g,
        Bref: P.Bref,
        mask: P.mask,
        hl: P.hl,
        sh: P.sh,
        clarity: P.clarity,
        texture_: P.texture,
        burn: P.burn,
        aspect: src.filmUm[0] / src.filmUm[1],
        Us: P.Us,
        Uh: P.Uh,
        span: P.span,
        gamma: P.gamma,
        flash: P.flash,
        xR: m.pcurves.range,
        fadeK: P.fadeK,
        cpR: m.print.range,
        flareXYZ: P.flareXYZ,
        gain: P.gain
      };
    }
    printTex(pdName) {
      return { pd: this.targets.get(pdName), base: this.targets.get("base"), curves: this.luts.curves, printT: this.luts.print };
    }
    outUniforms(P, w, h, g2, view = 0, p3 = false) {
      const hu = P.hues, rad = (i) => [hu[i].dh, hu[i].ds];
      const toRGB = p3 ? [2.4934969, -0.829489, 0.0358458, -0.9313836, 1.7626641, -0.0761724, -0.4027108, 0.0236247, 0.9568845] : [3.2404542, -0.969266, 0.0556434, -1.5371385, 1.8760108, -0.2040259, -0.4985314, 0.041556, 1.0572252];
      return {
        g2,
        texel: [1 / w, 1 / h],
        bloom: P.bloom,
        sharp: P.sharp,
        vib: P.vib,
        cden: P.cden,
        roll: P.roll,
        hueA: [...rad(0), ...rad(1)],
        hueB: [...rad(2), ...rad(3)],
        hueC: [...rad(4), ...rad(5)],
        hueH0: [hu[0].c, hu[1].c, hu[2].c],
        hueH1: [hu[3].c, hu[4].c, hu[5].c],
        toRGB,
        shoulder: 0.82,
        view,
        Treb: this.src.Treb
      };
    }
    // ---------- the main pass at the working resolution → an 8-bit output target
    frame(s, { roll = {}, negKey = "", view = "print", out = "out", p3 = false } = {}) {
      const P = this.global(s, roll, negKey), src = this.src, w = src.w, h = src.h, g2 = [0, 0, 1, 1];
      const NU = this.negUniforms(P, src, w, h);
      const tex2 = { src: this.luts.src, solve: this.luts.solve, curves: this.luts.curves, pdA: this.luts.pdA, pdB: this.luts.pdB, noise: this.noise, hal: this.targets.get("halE") };
      this.pass("dyes", this.target("c", w, h, { filter: "nearest" }), { ...NU, g2 }, tex2);
      this.pass("pd", this.target("pd", w, h, { filter: "nearest" }), { ...NU, g2 }, { ...tex2, dyes: this.targets.get("c") });
      this.pass("print", this.target("pr", w, h, { filter: "nearest" }), this.printUniforms(P, w, h, g2), this.printTex("pd"));
      const vcode = { print: 0, negative: 1, dyes: 2, unreachable: 3 }[view] || 0;
      const dbg = vcode === 1 ? this.luts.src : this.targets.get("c");
      this.pass("out", this.target(out, w, h, { byte: true }), { ...this.outUniforms(P, w, h, g2, vcode, p3), sigD: src.sig.work, zN: Z_NOISE }, { pr: this.targets.get("pr"), bloomT: this.targets.get("bloom"), dbg, srcT: this.luts.src });
      return P;
    }
    // the values under one pixel of the working image (x, y in working pixels): T, dye amounts + residual, PD
    probe(x, y, r = 2) {
      const gl = this.gl, w = this.src.w, h = this.src.h, x0 = Math.max(0, Math.round(x) - r), y0 = Math.max(0, Math.round(y) - r), x1 = Math.min(w, Math.round(x) + r + 1), y1 = Math.min(h, Math.round(y) + r + 1);
      const n2 = (x1 - x0) * (y1 - y0);
      if (n2 <= 0) return null;
      const rd = (name) => {
        const t = this.targets.get(name);
        if (!t) return null;
        const out = new Float32Array(n2 * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
        gl.readPixels(x0, y0, x1 - x0, y1 - y0, gl.RGBA, gl.FLOAT, out);
        const m = [0, 0, 0, 0];
        for (let i = 0; i < n2; i++) for (let k = 0; k < 4; k++) m[k] += out[4 * i + k] / n2;
        return m;
      };
      const T = [0, 1, 2].map((k) => {
        let s = 0;
        for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) s += this.src.data[3 * (yy * w + xx) + k];
        return s / n2;
      });
      return { T, c: rd("c"), pd: rd("pd"), print: rd("pr") };
    }
    // draw one or two output targets on the canvas: xf = [x0, y0, w, h] of the image in canvas uv (y up)
    show(xf, { split = 0, a = "out", b = "before", bg = [1, 1, 1] } = {}) {
      const tb = this.targets.get(b) || this.targets.get(a);
      this.pass("view", null, { xf, split, bg }, { a: this.targets.get(a), b: tb });
    }
    // a small render of variations (ring-around): reuses the global pass, renders at the global size
    variant(s, roll, negKey, name) {
      const P = this.global(s, roll, negKey), src = this.src, w = src.gw, h = src.gh, g2 = [0, 0, 1, 1];
      this.pass("print", this.target("prV", w, h, { filter: "nearest" }), this.printUniforms(P, w, h, g2), this.printTex("pdG"));
      this.pass("out", this.target(name, w, h, { byte: true }), this.outUniforms(P, w, h, g2), { pr: this.targets.get("prV"), bloomT: this.targets.get("bloom"), dbg: this.targets.get("cG") });
      return this.targets.get(name);
    }
    // ---------- full-resolution tiles for export. getTile(x0, y0, w, h) returns Float32 RGB transmittance.
    // While it runs, busy is set: the store must not render in between tiles, or the global pass the tiles read (bases,
    // halation, bloom) would be redrawn for other settings half-way through the export.
    async exportFull(s, opts) {
      this.busy = true;
      try {
        return await this.exportTiles(s, opts);
      } finally {
        this.busy = false;
      }
    }
    async exportTiles(s, { roll, negKey, fullW, fullH, getTile, filmUm, tile = 1024, halo = 8, bits = 8, p3 = false, onProgress }) {
      const P = this.global(s, roll, negKey), out = bits === 16 ? new Uint16Array(fullW * fullH * 4) : new Uint8ClampedArray(fullW * fullH * 4);
      const nT = Math.ceil(fullW / tile) * Math.ceil(fullH / tile);
      let done = 0;
      for (let ty = 0; ty < fullH; ty += tile) for (let tx = 0; tx < fullW; tx += tile) {
        const x0 = Math.max(0, tx - halo), y0 = Math.max(0, ty - halo), x1 = Math.min(fullW, tx + tile + halo), y1 = Math.min(fullH, ty + tile + halo), w = x1 - x0, h = y1 - y0;
        const T = getTile(x0, y0, w, h), rgba = new Float32Array(w * h * 4);
        for (let i = 0; i < w * h; i++) {
          rgba[4 * i] = T[3 * i];
          rgba[4 * i + 1] = T[3 * i + 1];
          rgba[4 * i + 2] = T[3 * i + 2];
          rgba[4 * i + 3] = 1;
        }
        if (this.luts.tile) this.gl.deleteTexture(this.luts.tile.t);
        this.luts.tile = this.tex2D(w, h, rgba, { float32: false, filter: "linear" });
        const g2 = [x0 / fullW, y0 / fullH, w / fullW, h / fullH];
        const tsrc = { ...this.src, filmUm };
        const NU = this.negUniforms(P, tsrc, w, h);
        const tex2 = { src: this.luts.tile, solve: this.luts.solve, curves: this.luts.curves, pdA: this.luts.pdA, pdB: this.luts.pdB, noise: this.noise, hal: this.targets.get("halE") };
        this.pass("dyes", this.target("tc", w, h, { filter: "nearest" }), { ...NU, g2 }, tex2);
        this.pass("pd", this.target("tpd", w, h, { filter: "nearest" }), { ...NU, g2 }, { ...tex2, dyes: this.targets.get("tc") });
        this.pass("print", this.target("tpr", w, h, { filter: "nearest" }), this.printUniforms(P, w, h, g2), this.printTex("tpd"));
        let px;
        if (bits === 16) {
          this.pass("out", this.target("tout16", w, h, { filter: "nearest" }), this.outUniforms(P, w, h, g2, 0, p3), { pr: this.targets.get("tpr"), bloomT: this.targets.get("bloom") });
          px = this.read(this.targets.get("tout16"));
        } else {
          this.pass("out", this.target("tout", w, h, { byte: true }), this.outUniforms(P, w, h, g2, 0, p3), { pr: this.targets.get("tpr"), bloomT: this.targets.get("bloom") });
          px = this.readBytes(this.targets.get("tout"));
        }
        for (let y = ty; y < Math.min(fullH, ty + tile); y++) for (let x = tx; x < Math.min(fullW, tx + tile); x++) {
          const si = 4 * ((y - y0) * w + (x - x0)), di = 4 * (y * fullW + x);
          if (bits === 16) {
            for (let c = 0; c < 3; c++) out[di + c] = Math.max(0, Math.min(65535, Math.round(px[si + c] * 65535)));
            out[di + 3] = 65535;
          } else {
            out[di] = px[si];
            out[di + 1] = px[si + 1];
            out[di + 2] = px[si + 2];
            out[di + 3] = 255;
          }
        }
        done++;
        if (onProgress) onProgress(done / nT);
        await new Promise((r) => setTimeout(r, 0));
      }
      return out;
    }
  };

  // src/export.js
  var CRC = (() => {
    const t = new Uint32Array(256);
    for (let n2 = 0; n2 < 256; n2++) {
      let c = n2;
      for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
      t[n2] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8, crc = 4294967295) {
    for (let i = 0; i < u8.length; i++) crc = CRC[(crc ^ u8[i]) & 255] ^ crc >>> 8;
    return crc;
  }
  var crcEnd = (u8) => (crc32(u8) ^ 4294967295) >>> 0;
  async function deflate(u8) {
    const cs = new CompressionStream("deflate");
    return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(cs)).arrayBuffer());
  }
  function chunk(type, data) {
    const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crcEnd(out.subarray(4, 8 + data.length)));
    return out;
  }
  async function png16(rgba, w, h) {
    const row = 1 + w * 6, raw = new Uint8Array(row * h);
    for (let y = 0; y < h; y++) {
      raw[y * row] = 0;
      for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
        const v = rgba[4 * (y * w + x) + c], o = y * row + 1 + x * 6 + c * 2;
        raw[o] = v >> 8;
        raw[o + 1] = v & 255;
      }
    }
    const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
    dv.setUint32(0, w);
    dv.setUint32(4, h);
    ihdr[8] = 16;
    ihdr[9] = 2;
    const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("sRGB", new Uint8Array([0])), chunk("IDAT", await deflate(raw)), chunk("IEND", new Uint8Array(0))];
    return new Blob(parts, { type: "image/png" });
  }
  function canvasBlob(rgba8, w, h, type = "image/png", quality = 0.95, p3 = false) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", p3 ? { colorSpace: "display-p3" } : void 0);
    const id = p3 ? new ImageData(new Uint8ClampedArray(rgba8), w, h, { colorSpace: "display-p3" }) : new ImageData(new Uint8ClampedArray(rgba8), w, h);
    ctx.putImageData(id, 0, 0);
    return new Promise((res) => c.toBlob(res, type, quality));
  }
  function tiff16(rgba, w, h) {
    const n2 = 11, ifd = 8, dataOff = ifd + 2 + n2 * 12 + 4 + 16, bytes = w * h * 6, buf = new ArrayBuffer(dataOff + bytes), dv = new DataView(buf);
    dv.setUint16(0, 18761);
    dv.setUint16(2, 42, true);
    dv.setUint32(4, ifd, true);
    dv.setUint16(ifd, n2, true);
    const bpsOff = ifd + 2 + n2 * 12 + 4;
    [16, 16, 16].forEach((v, i) => dv.setUint16(bpsOff + 2 * i, v, true));
    const tags = [[256, 4, 1, w], [257, 4, 1, h], [258, 3, 3, bpsOff], [259, 3, 1, 1], [262, 3, 1, 2], [273, 4, 1, dataOff], [277, 3, 1, 3], [278, 4, 1, h], [279, 4, 1, bytes], [284, 3, 1, 1], [339, 3, 1, 1]];
    tags.forEach(([tag, type, count, v], i) => {
      const e = ifd + 2 + 12 * i;
      dv.setUint16(e, tag, true);
      dv.setUint16(e + 2, type, true);
      dv.setUint32(e + 4, count, true);
      if (type === 3 && count === 1) dv.setUint16(e + 8, v, true);
      else dv.setUint32(e + 8, v, true);
    });
    dv.setUint32(ifd + 2 + n2 * 12, 0, true);
    const px = new Uint16Array(buf, dataOff, w * h * 3);
    for (let i = 0; i < w * h; i++) {
      px[3 * i] = rgba[4 * i];
      px[3 * i + 1] = rgba[4 * i + 1];
      px[3 * i + 2] = rgba[4 * i + 2];
    }
    return new Uint8Array(buf);
  }
  function zip(entries) {
    const enc = new TextEncoder(), parts = [], cen = [];
    let off = 0;
    for (const [name, data] of entries) {
      const nm = enc.encode(name), crc = crcEnd(data), h = new Uint8Array(30 + nm.length), dv = new DataView(h.buffer);
      dv.setUint32(0, 67324752, true);
      dv.setUint16(4, 20, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, data.length, true);
      dv.setUint32(22, data.length, true);
      dv.setUint16(26, nm.length, true);
      h.set(nm, 30);
      const c = new Uint8Array(46 + nm.length), cv = new DataView(c.buffer);
      cv.setUint32(0, 33639248, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nm.length, true);
      cv.setUint32(42, off, true);
      c.set(nm, 46);
      parts.push(h, data);
      cen.push(c);
      off += h.length + data.length;
    }
    const size = cen.reduce((s, c) => s + c.length, 0), end = new Uint8Array(22), ev = new DataView(end.buffer);
    ev.setUint32(0, 101010256, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, size, true);
    ev.setUint32(16, off, true);
    return new Blob([...parts, ...cen, end], { type: "application/zip" });
  }
  function download(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 2e3);
  }
  var dlNs;
  function downloads() {
    if (!dlNs) {
      dlNs = null;
      try {
        if (typeof window !== "undefined" && window.claude && typeof window.claude.use === "function") dlNs = Promise.resolve(window.claude.use("downloads")).catch(() => null).then((ns) => ns || "none");
      } catch (e) {
        dlNs = null;
      }
    }
    return dlNs;
  }
  async function save(blob, name) {
    const p = downloads(), ns = p ? await p : null;
    if (!ns) {
      download(blob, name);
      return "saved";
    }
    if (ns === "none") throw new Error("this view cannot save files");
    try {
      await ns.save({ filename: name, data: blob });
      return "saved";
    } catch (e) {
      const code = e && e.code;
      if (code === "declined") return "declined";
      if (code === "rejected_extension" || code === "extension_not_enabled") throw new Error(`this view cannot save .${name.split(".").pop()} files`);
      if (code === "rate_limited") {
        await new Promise((r) => setTimeout(r, 1500));
        return save(blob, name);
      }
      throw new Error(e && e.message || String(code || e));
    }
  }

  // src/state.js
  var import_colour2 = __toESM(require_colour());

  // src/gpu.js
  var WG = 64;
  var MAXN = 128;
  var COMMON = (
    /* wgsl */
    `
const WG: u32 = ${WG}u;
const LOG2_10: f32 = 3.321928094887362;
const LOG10_2: f32 = 0.3010299956639812;
var<workgroup> sh: array<f32, ${7 * MAXN}>;
// node q of an N³ table, x fastest
fn nodeAt(q: u32, N: u32, lo: f32, hi: f32) -> vec3<f32> {
  let st = (hi - lo) / f32(N - 1u);
  return vec3<f32>(f32(q % N), f32((q / N) % N), f32(q / (N * N))) * st + vec3<f32>(lo);
}
`
  );
  var SOLVE = COMMON + /* wgsl */
  `
struct Params {
  K: mat3x3<f32>,        // analytical matrix, d = K a + D_base
  Dbase: vec4<f32>,
  rng: vec4<f32>,        // table key range (lo, hi), dye bounds (lo, hi)
  N: u32, n: u32, total: u32, maxIt: u32,
  tol: f32, gtol: f32, activeSet: u32, p2: f32,  // stop when the projected gradient is below gtol; activeSet: the active-set step
};
@group(0) @binding(0) var<uniform> U: Params;
@group(0) @binding(1) var<storage, read> spec: array<f32>;            // P0 P1 P2 E0 E1 E2 B, n samples each
@group(0) @binding(2) var<storage, read_write> outT: array<vec4<f32>>; // c, residual

struct Ev { F: f32, r: vec3<f32>, J0: vec3<f32>, J1: vec3<f32>, J2: vec3<f32> };   // J row k: ∂D_k/∂c

fn evalF(c: vec3<f32>, d: vec3<f32>, withJ: bool) -> Ev {
  let n = U.n;
  var s = vec3<f32>(0.0); var a0 = vec3<f32>(0.0); var a1 = vec3<f32>(0.0); var a2 = vec3<f32>(0.0);
  for (var i = 0u; i < n; i++) {
    let e = vec3<f32>(sh[3u * n + i], sh[4u * n + i], sh[5u * n + i]);
    let t = exp2(-LOG2_10 * (sh[6u * n + i] + dot(c, e)));
    let w = vec3<f32>(sh[i], sh[n + i], sh[2u * n + i]) * t;
    s += w;
    if (withJ) { a0 += w.x * e; a1 += w.y * e; a2 += w.z * e; }
  }
  var o: Ev;
  o.r = -log2(s) * LOG10_2 - d;
  o.F = dot(o.r, o.r);
  if (withJ) { o.J0 = a0 / s.x; o.J1 = a1 / s.y; o.J2 = a2 / s.z; }
  return o;
}

// the inverse of a symmetric 3 × 3 matrix by its adjugate; det returned in w of the last column
fn solve3(b: mat3x3<f32>, g: vec3<f32>, det: f32) -> vec3<f32> {
  let b00 = b[0][0]; let b01 = b[1][0]; let b02 = b[2][0]; let b11 = b[1][1]; let b12 = b[2][1]; let b22 = b[2][2];
  let i00 = (b11 * b22 - b12 * b12) / det; let i01 = (b02 * b12 - b01 * b22) / det; let i02 = (b01 * b12 - b02 * b11) / det;
  let i11 = (b00 * b22 - b02 * b02) / det; let i12 = (b01 * b02 - b00 * b12) / det; let i22 = (b00 * b11 - b01 * b01) / det;
  return vec3<f32>(i00 * g.x + i01 * g.y + i02 * g.z, i01 * g.x + i11 * g.y + i12 * g.z, i02 * g.x + i12 * g.y + i22 * g.z);
}

@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  // every invocation copies a share of the spectra, then all wait: the barrier must be reached by the whole group,
  // so the range check comes after it
  for (var i = li; i < 7u * U.n; i += WG) { sh[i] = spec[i]; }
  workgroupBarrier();
  let q = gid.x;
  if (q >= U.total) { return; }
  let a = nodeAt(q, U.N, U.rng.x, U.rng.y);
  let d = U.K * a + U.Dbase.xyz;
  let lo = vec3<f32>(U.rng.z); let hi = vec3<f32>(U.rng.w);
  var x = clamp(a, lo, hi);                       // the analytical start K⁻¹(d − D_base) is the key itself
  var ev = evalF(x, d, true);
  var F = ev.F;
  var mu: f32 = 1e-3;
  for (var it = 0u; it < U.maxIt && F > U.tol; it++) {
    let R = mat3x3<f32>(ev.J0, ev.J1, ev.J2);     // columns are the rows of J: R = Jᵀ
    let A = R * transpose(R);                       // JᵀJ
    var g = R * ev.r;                               // Jᵀr
    // the active set: a dye at a bound whose gradient points out of the box is held there (solve.js activeSet)
    var act = vec3<bool>(false);
    if (U.activeSet == 1u) {
      act = ((x <= lo) & (g > vec3<f32>(0.0))) | ((x >= hi) & (g < vec3<f32>(0.0)));
      g = select(g, vec3<f32>(0.0), act);
      if (max(abs(g.x), max(abs(g.y), abs(g.z))) < U.gtol) { break; }
    }
    let m = select(vec3<f32>(1.0), vec3<f32>(0.0), act);   // 1 for a free dye, 0 for a held one
    var improved = false;
    for (var tries = 0; tries < 12; tries++) {
      var b = A + mat3x3<f32>(vec3<f32>(mu * (1.0 + A[0][0]), 0.0, 0.0), vec3<f32>(0.0, mu * (1.0 + A[1][1]), 0.0), vec3<f32>(0.0, 0.0, mu * (1.0 + A[2][2])));
      // held dyes: their rows and columns become the identity, so the step leaves them where they are
      b = mat3x3<f32>(b[0] * m * m.x, b[1] * m * m.y, b[2] * m * m.z) + mat3x3<f32>(vec3<f32>(1.0 - m.x, 0.0, 0.0), vec3<f32>(0.0, 1.0 - m.y, 0.0), vec3<f32>(0.0, 0.0, 1.0 - m.z));
      let det = determinant(b);
      if (!(abs(det) > 1e-30)) { mu *= 10.0; continue; }
      let y = clamp(x - solve3(b, g, det), lo, hi);
      let F1 = evalF(y, d, false).F;
      if (F1 < F) { x = y; mu = max(mu / 3.0, 1e-12); improved = true; ev = evalF(x, d, true); F = ev.F; break; }
      mu *= 4.0;
    }
    if (!improved) { break; }
  }
  outT[q] = vec4<f32>(x, sqrt(F));
}
`;
  var SPECTRAL = COMMON + /* wgsl */
  `
struct Params {
  M: mat3x3<f32>,
  rng: vec4<f32>,        // table key range (lo, hi)
  N: u32, n: u32, total: u32, mode: u32,   // mode 0: −log10, 1: M ·
};
@group(0) @binding(0) var<uniform> U: Params;
@group(0) @binding(1) var<storage, read> spec: array<f32>;            // E0 E1 E2 B W0 W1 W2
@group(0) @binding(2) var<storage, read_write> outT: array<vec4<f32>>;

@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  for (var i = li; i < 7u * U.n; i += WG) { sh[i] = spec[i]; }
  workgroupBarrier();
  let q = gid.x;
  if (q >= U.total) { return; }
  let c = nodeAt(q, U.N, U.rng.x, U.rng.y);
  let n = U.n;
  var s = vec3<f32>(0.0);
  for (var i = 0u; i < n; i++) {
    let t = exp2(-LOG2_10 * (sh[3u * n + i] + c.x * sh[i] + c.y * sh[n + i] + c.z * sh[2u * n + i]));
    s += vec3<f32>(sh[4u * n + i], sh[5u * n + i], sh[6u * n + i]) * t;
  }
  if (U.mode == 0u) { outT[q] = vec4<f32>(-log2(s) * LOG10_2, 1.0); } else { outT[q] = vec4<f32>(U.M * s, 1.0); }
}
`;
  var devP = null;
  function gpuDevice() {
    if (devP) return devP;
    devP = (async () => {
      if (typeof navigator === "undefined" || !navigator.gpu) return { device: null, why: "this browser has no WebGPU" };
      let adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
      if (!adapter) adapter = await navigator.gpu.requestAdapter({ forceFallbackAdapter: true });
      if (!adapter) return { device: null, why: "no GPU adapter" };
      const info = adapter.info || (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : {}) || {};
      const name = [info.vendor, info.architecture, info.description].filter(Boolean).join(" ") || "GPU";
      const device = await adapter.requestDevice();
      device.lost.then(() => {
        devP = null;
      });
      return { device, name, fallback: !!info.isFallbackAdapter, pipes: {} };
    })().catch((e) => ({ device: null, why: e.message }));
    return devP;
  }
  async function pipeline(G, key, code) {
    if (!G.pipes[key]) G.pipes[key] = (async () => {
      const module = G.device.createShaderModule({ code }), info = module.getCompilationInfo ? await module.getCompilationInfo() : { messages: [] };
      const errs = info.messages.filter((m) => m.type === "error");
      if (errs.length) throw new Error(`WGSL ${key}: ` + errs.map((m) => `line ${m.lineNum}: ${m.message}`).join("; "));
      return G.device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "main" } });
    })();
    G.pipes[key].catch(() => {
      delete G.pipes[key];
    });
    return G.pipes[key];
  }
  async function run(G, key, code, uniforms, spec, total) {
    const dev = G.device;
    dev.pushErrorScope("validation");
    const pipe = await pipeline(G, key, code);
    const ub = dev.createBuffer({ size: uniforms.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const sb = dev.createBuffer({ size: spec.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const ob = dev.createBuffer({ size: total * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const rb = dev.createBuffer({ size: total * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    dev.queue.writeBuffer(ub, 0, uniforms);
    dev.queue.writeBuffer(sb, 0, spec);
    const bg = dev.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ub } }, { binding: 1, resource: { buffer: sb } }, { binding: 2, resource: { buffer: ob } }] });
    const enc = dev.createCommandEncoder(), pass = enc.beginComputePass();
    pass.setPipeline(pipe);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(Math.ceil(total / WG));
    pass.end();
    enc.copyBufferToBuffer(ob, 0, rb, 0, total * 16);
    dev.queue.submit([enc.finish()]);
    const err = await dev.popErrorScope();
    if (err) throw new Error("WebGPU: " + err.message);
    await rb.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(rb.getMappedRange().slice(0));
    rb.unmap();
    for (const b of [ub, sb, ob, rb]) b.destroy();
    return out;
  }
  var pack = (arrays, n2) => {
    const out = new Float32Array(arrays.length * n2);
    arrays.forEach((a, i) => out.set(a.subarray ? a.subarray(0, n2) : a.slice(0, n2), i * n2));
    return out;
  };
  var mat3 = (f, at, R) => {
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) f[at + 4 * c + r] = R[r][c];
  };
  async function gpuSolve(G, inp, N) {
    const n2 = inp.B.length;
    if (n2 > MAXN) throw new Error("too many spectral samples for the GPU kernel");
    const buf = new ArrayBuffer(112), f = new Float32Array(buf), u = new Uint32Array(buf);
    mat3(f, 0, inp.K);
    f.set([...inp.Dbase, 0], 12);
    f.set([inp.range[0], inp.range[1], inp.lo, inp.hi], 16);
    u.set([N, n2, N * N * N, inp.maxIterations], 20);
    f.set([inp.tolerance, Math.max(inp.gtol || 0, 1e-6)], 24);
    u[26] = inp.activeSet ? 1 : 0;
    return run(G, "solve", SOLVE, buf, pack([...inp.P, ...inp.E, inp.B], n2), N * N * N);
  }
  async function gpuSpectral(G, inp, N) {
    const n2 = inp.B.length;
    if (n2 > MAXN) throw new Error("too many spectral samples for the GPU kernel");
    const buf = new ArrayBuffer(80), f = new Float32Array(buf), u = new Uint32Array(buf);
    mat3(f, 0, inp.M);
    f.set([inp.range[0], inp.range[1], 0, 0], 12);
    u.set([N, n2, N * N * N, inp.mode === "log" ? 0 : 1], 16);
    return run(G, "spectral", SPECTRAL, buf, pack([...inp.E, inp.B, ...inp.W], n2), N * N * N);
  }

  // src/accel.js
  var store = { get(k) {
    try {
      return localStorage.getItem(k);
    } catch (e) {
      return null;
    }
  }, set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch (e) {
    }
  } };
  var now = () => performance.now();
  var Pool = class {
    constructor(n2) {
      this.n = n2;
      this.workers = [];
      this.queue = [];
      this.jobs = /* @__PURE__ */ new Map();
      this.seq = 0;
      this.ready = null;
    }
    start() {
      if (this.ready) return this.ready;
      const el = typeof document !== "undefined" && document.getElementById("st-worker");
      if (!el || typeof Worker === "undefined") return this.ready = Promise.reject(new Error("workers are not available"));
      const url = URL.createObjectURL(new Blob([el.textContent], { type: "text/javascript" }));
      this.ready = Promise.all(Array.from({ length: this.n }, () => new Promise((resolve, reject) => {
        const w = new Worker(url);
        w.onmessage = (e) => {
          if (e.data.type === "ready") {
            w.onmessage = (ev) => this.done(w, ev.data);
            w.busy = false;
            resolve(w);
          }
        };
        w.onerror = (e) => reject(new Error("worker: " + (e.message || "failed to start")));
        w.postMessage({ type: "init", cg: window.ST_DATA.cg });
      }))).then((ws) => {
        this.workers = ws;
        return this;
      });
      this.ready.catch(() => {
      });
      return this.ready;
    }
    // split nodes 0 … total into ranges of `chunk`, run them, and assemble one Float32Array (4 floats per node)
    // urgent jobs (the short tables) go to the front of the queue, so they are not left waiting behind a long solve
    async run(spec, total, { chunk: chunk2 = 512, onProgress, urgent = false } = {}) {
      await this.start();
      const id = ++this.seq, out = new Float32Array(total * 4);
      return new Promise((resolve, reject) => {
        const job = { out, left: 0, total, onProgress, resolve, reject, done: 0 }, tasks = [];
        for (let q0 = 0; q0 < total; q0 += chunk2) {
          tasks.push({ ...spec, id, q0, q1: Math.min(total, q0 + chunk2) });
          job.left++;
        }
        this.queue = urgent ? [...tasks, ...this.queue] : [...this.queue, ...tasks];
        this.jobs.set(id, job);
        this.pump();
      });
    }
    pump() {
      for (const w of this.workers) if (!w.busy && this.queue.length) {
        w.busy = true;
        w.postMessage(this.queue.shift());
      }
    }
    done(w, m) {
      w.busy = false;
      const job = this.jobs.get(m.id);
      if (job) {
        if (m.type === "error") {
          this.jobs.delete(m.id);
          this.queue = this.queue.filter((t) => t.id !== m.id);
          job.reject(new Error(m.message));
        } else {
          job.out.set(m.out, m.q0 * 4);
          job.done += m.out.length / 4;
          if (job.onProgress) job.onProgress(job.done / job.total);
          if (--job.left === 0) {
            this.jobs.delete(m.id);
            job.resolve(job.out);
          }
        }
      }
      this.pump();
    }
  };
  var BACKENDS = [["auto", "Auto"], ["gpu", "GPU (WebGPU)"], ["workers", "Workers"], ["main", "Main thread"]];
  var Accel = class {
    constructor({ onChange } = {}) {
      this.pref = store.get("cgstudio:engine") || "auto";
      const hc = typeof navigator !== "undefined" && navigator.hardwareConcurrency || 4;
      this.cores = hc;
      this.pool = new Pool(Math.max(1, Math.min(8, hc)));
      this.log = [];
      this.onChange = onChange || (() => {
      });
      this.gpu = null;
      this.bench = null;
    }
    setPref(p) {
      this.pref = p;
      store.set("cgstudio:engine", p);
      this.onChange();
    }
    // what the browser offers: the GPU adapter (a software adapter only when asked for by name) and the workers
    async detect() {
      this.gpu = await gpuDevice();
      this.onChange();
      return this.gpu;
    }
    // the backends to try, in order. Auto uses a hardware GPU, then the workers; a software GPU only when asked for.
    async order() {
      const G = this.gpu = await gpuDevice(), w = typeof Worker !== "undefined" && this.cores > 1;
      if (this.pref === "main") return ["main"];
      if (this.pref === "workers") return ["workers", "main"];
      if (this.pref === "gpu") return [...G.device ? ["gpu"] : [], "workers", "main"];
      return [...G.device && !G.fallback ? ["gpu"] : [], ...w ? ["workers"] : [], "main"];
    }
    // in words, for the panel
    resolved() {
      const G = this.gpu;
      if (!G) return "checking…";
      if (this.pref === "main") return "main thread";
      if (this.pref === "workers") return `${this.pool.n} workers`;
      if (G.device && (!G.fallback || this.pref === "gpu")) return "WebGPU · " + G.name + (G.fallback ? " (software)" : "");
      return `${this.pool.n} workers` + (this.pref === "gpu" ? " (no GPU)" : "");
    }
    record(kind, backend, ms2, note) {
      this.log.unshift({ kind, backend, ms: ms2, note, at: Date.now() });
      this.log.length = Math.min(this.log.length, 12);
      this.onChange();
    }
    // one table with one backend
    async build(kind, backend, args, onProgress) {
      const N = N3;
      if (backend === "gpu") {
        const G = this.gpu;
        if (kind === "solve") {
          const inp2 = solveInputs(args.scanner, args.film);
          return solveResult(inp2.sv, await gpuSolve(G, inp2, N), N);
        }
        if (kind === "pd") return { N, data: await gpuSpectral(G, spectralInputs("pd", { film: args.film, PCh: args.PCh }), N), range: C_RANGE };
        const inp = spectralInputs("print", { paper: args.paper, fade: args.fade });
        return printResult(inp.ps, await gpuSpectral(G, inp, N), N);
      }
      if (backend === "workers") {
        const ids = args.ids, total = N * N * N;
        if (kind === "solve") {
          const data = await this.pool.run({ job: "solve", scanner: ids.scanner, peaks: ids.peaks, film: ids.film, N }, total, { chunk: 512, onProgress });
          return solveResult(makeSolve(args.scanner, args.film), data, N);
        }
        if (kind === "pd") return { N, data: await this.pool.run({ job: "pd", film: ids.film, paper: ids.paper, N }, total, { chunk: 2048, urgent: true }), range: C_RANGE };
        return printResult(printSetup(args.paper, { fade: args.fade }), await this.pool.run({ job: "print", paper: ids.paper, fade: args.fade, N }, total, { chunk: 2048, urgent: true }), N);
      }
      if (kind === "solve") return solveTable(args.scanner, args.film, { onProgress });
      if (kind === "pd") return pdTable(args.film, args.PCh);
      return printTable(args.paper, { fade: args.fade });
    }
    // the first backend in the order that works, timed
    async any(kind, args, onProgress) {
      let last;
      for (const b of await this.order()) {
        const t0 = now();
        try {
          const T = await this.build(kind, b, args, onProgress);
          this.record(kind, b, now() - t0, last ? "after: " + last : "");
          T.backend = b;
          return T;
        } catch (e) {
          last = `${b} failed (${e.message})`;
          console.warn(last);
        }
      }
      throw new Error(last);
    }
    // the engine buildModel calls (model.js MAIN_ENGINE has the same shape)
    engine() {
      return {
        name: this.pref,
        solve: (scanner, film, { onProgress, ids }) => this.any("solve", { scanner, film, ids }, onProgress),
        pd: (film, PCh, { ids }) => this.any("pd", { film, PCh, ids }),
        print: (paper, { fade }, { ids }) => this.any("print", { paper, fade, ids })
      };
    }
    // every available backend on the current frame's tables, against the main thread; for the solve, the comparison is
    // over nodes the reference reaches (residual < 0.01 D), and flips count nodes that change sides of that threshold
    async benchmark({ scanner, film, paper, PCh, ids, onStep }) {
      const res = [], ref = {};
      const G = this.gpu = await gpuDevice();
      const backends = ["main", "workers", ...G.device ? ["gpu"] : []];
      const args = { scanner, film, paper, PCh, fade: 0, ids: { ...ids, paper: paper.name } };
      for (const b of backends) {
        const row = { backend: b, name: b === "gpu" ? G.name + (G.fallback ? " (software)" : "") : b === "workers" ? `${this.pool.n} workers` : "main thread" };
        try {
          if (b === "workers") {
            if (onStep) onStep("starting the workers");
            await this.pool.start();
          }
          if (b === "gpu") {
            if (onStep) onStep("compiling the GPU kernels");
            const t0 = now();
            await this.build("pd", "gpu", args);
            row.compile = now() - t0;
          }
          for (const kind of ["solve", "pd", "print"]) {
            if (onStep) onStep(`${kind} on ${row.name}`);
            const t0 = now(), T = await this.build(kind, b, args);
            row[kind] = now() - t0;
            if (b === "main") ref[kind] = T.data;
            else {
              const a = ref[kind], d = T.data;
              let mx = 0, flips = 0;
              for (let q = 0; q < d.length / 4; q++) {
                if (kind === "solve") {
                  const ok = a[4 * q + 3] < 0.01;
                  if (ok !== d[4 * q + 3] < 0.01) flips++;
                  if (!ok) continue;
                }
                for (let k = 0; k < 3; k++) mx = Math.max(mx, Math.abs(d[4 * q + k] - a[4 * q + k]));
              }
              row["d" + kind] = mx;
              if (kind === "solve") row.flips = flips;
            }
          }
        } catch (e) {
          row.error = e.message;
        }
        res.push(row);
        this.bench = res.slice();
        this.onChange();
      }
      return res;
    }
  };

  // src/state.js
  var clone = (o) => JSON.parse(JSON.stringify(o));
  var store2 = { get(k) {
    try {
      const v = localStorage.getItem(k);
      return v ? JSON.parse(v) : null;
    } catch (e) {
      return null;
    }
  }, set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) {
    }
  } };
  var NEG_KEYS = ["dyeSat", "halation", "grainReduction", "reshoot", "reshootAmount", "paper", "look"];
  var MODEL_KEYS = ["paper", "reshoot", "fade"];
  var VERSION = "1.2";
  var Studio = class {
    constructor() {
      this.frames = [];
      this.cur = -1;
      this.mode = "develop";
      this.view = "print";
      this.left = "develop";
      this.chapter = null;
      this.split = null;
      this.splitPos = 0.5;
      this.pick = null;
      this.status = { msg: "", progress: null, error: null };
      this.ringStep = 4;
      this.subs = /* @__PURE__ */ new Set();
      this.ver = 0;
      this.R = null;
      this.renderQueued = false;
      this.ms = 0;
      this.hist = null;
      this.readout = null;
      this.ring = null;
      this.matchRef = null;
      this.accel = new Accel({ onChange: () => this.notify() });
    }
    subscribe(f) {
      this.subs.add(f);
      return () => this.subs.delete(f);
    }
    notify() {
      this.ver++;
      for (const f of this.subs) f(this.ver);
    }
    get frame() {
      return this.frames[this.cur] || null;
    }
    setStatus(o) {
      this.status = Object.assign({}, this.status, o);
      this.notify();
    }
    attach(canvas) {
      if (this.R) return;
      try {
        this.R = new Renderer(canvas);
      } catch (e) {
        this.setStatus({ error: e.message });
      }
    }
    // ---------- frames
    async addSample() {
      const meta = window.ST_DATA.samples.gold200;
      this.setStatus({ msg: "Loading the real Gold 200 scan…" });
      try {
        const img = await loadSample("samples/gold200.png", meta);
        const src = { film: meta.film, scanner: meta.scanner, encoding: "linear", flipH: true, flipV: false, rotate: 0, crop: meta.frame, rebate: { box: meta.rebate }, format: "135" };
        await this.addFrame({ name: "Gold 200 · App. E", img, src, sample: meta });
      } catch (e) {
        this.setStatus({ error: e.message, msg: "" });
      }
    }
    async openFiles(files, { triplet = false } = {}) {
      files = [...files];
      if (!files.length) return;
      this.setStatus({ msg: `Decoding ${files.length} file${files.length > 1 ? "s" : ""}…`, error: null });
      try {
        if (triplet) {
          if (files.length !== 3) throw new Error("A triplet is three files: the red, green and blue exposures.");
          files.sort((a, b) => a.name.localeCompare(b.name, void 0, { numeric: true }));
          const imgs = [];
          for (const f of files) imgs.push(await decodeFile(f));
          const img = mergeTriplet(imgs);
          await this.addFrame({ name: files[0].name.replace(/\.\w+$/, "") + " (RGB)", img, src: this.defaultSrc(img) });
        } else {
          for (const f of files) {
            if (/\.json$/i.test(f.name)) {
              await this.loadRecipe(JSON.parse(await f.text()));
              continue;
            }
            const img = await decodeFile(f);
            await this.addFrame({ name: f.name.replace(/\.\w+$/, ""), img, src: this.defaultSrc(img) });
          }
        }
        this.setStatus({ msg: "" });
      } catch (e) {
        this.setStatus({ error: e.message, msg: "" });
      }
    }
    defaultSrc(img) {
      const prev = this.frame ? this.frame.src : null, pi = this.frame ? this.frame.img : null;
      const flat = prev && prev.flat && FLATS.has(prev.flat.id) && pi.w === img.w && pi.h === img.h && pi.kind === img.kind ? clone(prev.flat) : null;
      return { film: prev ? prev.film : "kodak_portra_400", scanner: prev ? prev.scanner : "rgb-led-book", peaks: prev ? prev.peaks : void 0, encoding: img.encodedHint || "linear", flipH: false, flipV: false, rotate: 0, crop: null, rebate: { auto: true }, format: prev ? prev.format : "135", flat };
    }
    async addFrame({ name, img, src, sample }) {
      const saved = store2.get("cgstudio:" + name);
      const f = { id: Math.random().toString(36).slice(2, 9), name, img, source: new Source(img), src: saved ? Object.assign(src, saved.src) : src, s: saved ? Object.assign(defaults(), saved.s) : defaults(), hist: [], fut: [], snaps: saved ? saved.snaps || {} : {}, stats: null, thumb: null, sample: !!sample };
      if (this.frame) {
        const keep = ["paper"];
        for (const k of keep) f.s[k] = this.frame.s[k];
      }
      this.frames.push(f);
      this.cur = this.frames.length - 1;
      this.split = null;
      this.notify();
      await this.ensureModel();
      this.queue();
    }
    select(i) {
      if (i === this.cur || !this.frames[i]) return;
      this.cur = i;
      this.split = null;
      this.ring = null;
      this.notify();
      this.ensureModel().then(() => this.queue());
    }
    removeFrame(i) {
      this.frames.splice(i, 1);
      this.cur = Math.min(this.cur, this.frames.length - 1);
      this.notify();
      if (this.frame) this.ensureModel().then(() => this.queue());
    }
    // ---------- the model for the current frame
    async ensureModel() {
      const f = this.frame;
      if (!f || !this.R) return null;
      const key = JSON.stringify([f.src.film, f.src.scanner, f.src.peaks, f.s.paper, f.s.reshoot, Math.round(f.s.fade)]);
      if (this.modelKey === key && this.model) return this.model;
      if (this.building) {
        this.pendingModel = true;
        return this.building;
      }
      this.building = (async () => {
        this.setStatus({ msg: "Building the dye solve for this scanner and film…", progress: 0 });
        const m = await buildModel({ film: f.src.film, scanner: f.src.scanner, peaks: f.src.peaks }, { paper: f.s.paper, reshoot: f.s.reshoot, fade: f.s.fade }, { engine: this.accel.engine(), onProgress: (p) => {
          this.status.progress = p;
          this.notify();
        } });
        this.model = m;
        this.modelKey = key;
        this.R.setModel(m);
        this.setStatus({ msg: "", progress: null });
        return m;
      })();
      try {
        return await this.building;
      } catch (e) {
        this.setStatus({ error: e.message, msg: "", progress: null });
        return null;
      } finally {
        this.building = null;
        if (this.pendingModel) {
          this.pendingModel = false;
          this.ensureModel().then(() => this.queue());
        }
      }
    }
    // the compute backend: set it, then rebuild this frame's tables with it so its timing shows
    async setBackend(p) {
      this.accel.setPref(p);
      clearModelCache("solve:");
      clearModelCache("pd:");
      clearModelCache("pr:");
      this.modelKey = null;
      await this.ensureModel();
      this.queue();
    }
    async benchmark() {
      const m = this.model, f = this.frame;
      if (!m || !f || this.benching) return;
      this.benching = true;
      this.notify();
      try {
        await this.accel.benchmark({ scanner: m.scanner, film: m.film, paper: m.paper, PCh: m.PCh, ids: { scanner: f.src.scanner, peaks: f.src.peaks, film: f.src.film }, onStep: (t) => this.setStatus({ msg: "Benchmark: " + t + "…" }) });
        this.setStatus({ msg: "" });
      } catch (e) {
        this.setStatus({ error: "benchmark: " + e.message, msg: "" });
      }
      this.benching = false;
      this.notify();
    }
    work(f = this.frame) {
      return f.source.working(f.src);
    }
    negKey(f = this.frame) {
      return JSON.stringify([this.work(f).key, this.modelKey, NEG_KEYS.map((k) => f.s[k])]);
    }
    rollInfo(f = this.frame) {
      const st = this.frames.filter((g) => g.stats && g.auto);
      const roll = {};
      if (st.length > 1) roll.mean = [0, 1, 2].map((k) => st.reduce((a, g) => a + g.auto[k], 0) / st.length);
      const ref = this.frames.find((g) => g.id === this.matchRef && g !== f && g.meanX);
      if (ref) roll.ref = { meanX: ref.meanX };
      return roll;
    }
    // ---------- rendering
    queue() {
      if (this.renderQueued) return;
      this.renderQueued = true;
      requestAnimationFrame(() => {
        this.renderQueued = false;
        this.renderNow();
      });
    }
    renderNow() {
      this.renders = (this.renders || 0) + 1;
      const f = this.frame, R = this.R;
      if (!f || !R || !this.model || this.building) return;
      if (R.busy) {
        setTimeout(() => this.queue(), 150);
        return;
      }
      try {
        const w = this.work(f);
        R.setSource(w, w.key);
        const t0 = performance.now(), roll = this.rollInfo(f), negKey = this.negKey(f);
        if (this.mode === "ring") {
          this.renderRing();
        } else {
          if (this.split) {
            const before = this.split === "__defaults" ? Object.assign(defaults(), { paper: f.s.paper, reshoot: f.s.reshoot, fade: f.s.fade }) : f.snaps[this.split];
            if (before) R.frame(before, { roll, negKey: negKey + ":b", out: "before", view: this.view });
          }
          const P = R.frame(f.s, { roll, negKey, view: this.view });
          this.P = P;
          R.show(this.fit(), { split: this.split ? this.splitPos : 0 });
          f.stats = R.lastStats;
          f.auto = autoLights(this.model, R.lastStats, f.s.autoColour / 100);
          f.meanX = R.lastStats.meanPD.map((p, k) => this.model.aim.clear[k] - p + P.lights.total[k]);
          if (R.lastPD) this.hist = windowHistogram(P, R.lastPD.data, R.lastPD.w, R.lastPD.h);
          if (!f.thumb || this.thumbDue) {
            if (this.view !== "print") R.frame(f.s, { roll, negKey, view: "print", out: "thumbsrc" });
            f.thumb = this.thumbnail(this.view !== "print" ? "thumbsrc" : "out");
            this.thumbDue = false;
          }
        }
        R.sync();
        this.ms = Math.round(performance.now() - t0);
        if (this.status.error && /render/.test(this.status.error)) this.status.error = null;
        this.notify();
      } catch (e) {
        console.error(e);
        this.setStatus({ error: "render: " + e.message });
      }
    }
    thumbnail(name = "out") {
      const t = this.R.targets.get(name);
      if (!t) return null;
      const px = this.R.readBytes(t);
      const c = document.createElement("canvas");
      const s = 96 / Math.max(t.w, t.h);
      c.width = Math.round(t.w * s);
      c.height = Math.round(t.h * s);
      const big = document.createElement("canvas");
      big.width = t.w;
      big.height = t.h;
      big.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(px), t.w, t.h), 0, 0);
      c.getContext("2d").drawImage(big, 0, 0, c.width, c.height);
      return c.toDataURL();
    }
    // the image's rectangle in canvas uv (y up), fitted with a margin
    fit() {
      const cv = this.R.canvas, w = this.R.src.w, h = this.R.src.h, m = 12 * (window.devicePixelRatio || 1);
      const s = Math.min((cv.width - 2 * m) / w, (cv.height - 2 * m) / h), iw = w * s, ih = h * s;
      this.xf = [(cv.width - iw) / 2 / cv.width, (cv.height - ih) / 2 / cv.height, iw / cv.width, ih / cv.height];
      return this.xf;
    }
    // canvas client coordinates → working-image pixel
    toImage(cx, cy, rect) {
      if (!this.xf || !this.R || !this.R.src) return null;
      const u = cx / rect.width, v = 1 - cy / rect.height, [x0, y0, ww, hh] = this.xf;
      const tx = (u - x0) / ww, ty = (v - y0) / hh;
      if (tx < 0 || ty < 0 || tx > 1 || ty > 1) return null;
      return [tx * this.R.src.w, (1 - ty) * this.R.src.h, tx];
    }
    // ---------- settings
    set(changes, { commit = true, label } = {}) {
      const f = this.frame;
      if (!f) return;
      const before = this.editStart || clone(f.s);
      let modelChange = false;
      if (!commit && !this.editStart) this.editStart = before;
      for (const [k, v] of Object.entries(changes)) {
        if (k.startsWith("hues.")) {
          f.s.hues = Object.assign({}, f.s.hues, { [k.slice(5)]: v });
        } else {
          if (MODEL_KEYS.includes(k) && f.s[k] !== v) modelChange = true;
          f.s[k] = v;
        }
      }
      if (commit) {
        f.hist.push({ s: before, label: label || Object.keys(changes).map((k) => (BY_ID[k] || { label: k.replace(/^hues\./, "Hue: ") }).label).join(", ") });
        if (f.hist.length > 200) f.hist.shift();
        f.fut = [];
        this.editStart = null;
        this.save();
      }
      this.notify();
      if (modelChange) this.ensureModel().then(() => this.queue());
      else this.queue();
    }
    setSrc(changes) {
      const f = this.frame;
      if (!f) return;
      const before = clone(f.src);
      Object.assign(f.src, changes);
      f.hist.push({ src: before, label: "Source: " + Object.keys(changes).join(", ") });
      this.save();
      this.notify();
      if (["film", "scanner", "peaks"].some((k) => k in changes)) this.ensureModel().then(() => this.queue());
      else this.queue();
    }
    undo() {
      const f = this.frame;
      if (!f || !f.hist.length) return;
      const h = f.hist.pop();
      f.fut.push(h.src ? { src: clone(f.src), label: h.label } : { s: clone(f.s), label: h.label });
      if (h.src) f.src = h.src;
      else f.s = h.s;
      this.notify();
      this.ensureModel().then(() => this.queue());
    }
    redo() {
      const f = this.frame;
      if (!f || !f.fut.length) return;
      const h = f.fut.pop();
      f.hist.push(h.src ? { src: clone(f.src), label: h.label } : { s: clone(f.s), label: h.label });
      if (h.src) f.src = h.src;
      else f.s = h.s;
      this.notify();
      this.ensureModel().then(() => this.queue());
    }
    reset(only) {
      const d = defaults(), ch = {};
      for (const sl of SLIDERS) {
        const sec = SECTIONS.find((x) => x.id === sl.section);
        if (!only || only === "all" || only === "finishing" && sec.kind === "operator" || only === "print" && sec.kind === "macro" || only === sl.section) ch[sl.id] = d[sl.id];
      }
      this.set(ch, { label: "Reset " + (only || "all") });
    }
    save() {
      const f = this.frame;
      if (f) {
        clearTimeout(this.saveT);
        this.saveT = setTimeout(() => store2.set("cgstudio:" + f.name, { src: f.src, s: f.s, snaps: f.snaps }), 400);
      }
    }
    snapshot(name) {
      const f = this.frame;
      if (!f) return;
      name = name || String.fromCharCode(65 + Object.keys(f.snaps).length);
      f.snaps[name] = clone(f.s);
      this.save();
      this.notify();
      return name;
    }
    compare(name) {
      this.split = this.split === name ? null : name;
      this.notify();
      this.queue();
    }
    // ---------- light arithmetic: a change of lights (log H) as Exposure, Warmth and Tint
    lightsToSliders(dL) {
      const m = (dL[0] + dL[1] + dL[2]) / 3, d = dL.map((v) => v - m);
      const W = colourOffset(this.model, 1, 0), T = colourOffset(this.model, 0, 1);
      const a = W[0] * W[0] + W[1] * W[1] + W[2] * W[2], b = W[0] * T[0] + W[1] * T[1] + W[2] * T[2], c = T[0] * T[0] + T[1] * T[1] + T[2] * T[2];
      const p = W[0] * d[0] + W[1] * d[1] + W[2] * d[2], q = T[0] * d[0] + T[1] * d[1] + T[2] * d[2], det = a * c - b * b;
      return { exposure: -m / STOP, warmth: (c * p - b * q) / det, tint: (a * q - b * p) / det };
    }
    // the print of a printing density through the macros (no spatial terms): XYZ and CIELAB (D65)
    printOf(P, pd) {
      const m = this.model, x = paperX(P, pd), cp = x.map((v, k) => look1(m.pcurves, v, k) * P.fadeK[k]);
      const X = look3(m.print, cp).slice(0, 3).map((v, k) => (v + P.flareXYZ[k]) * P.gain);
      return { x, X, lab: import_colour2.default.lab(X, import_colour2.default.D65) };
    }
    // grey pick: the Warmth and Tint that print this printing density neutral
    neutralise(pd) {
      const f = this.frame;
      let w = f.s.warmth, t = f.s.tint;
      const roll = this.rollInfo(f);
      const ab = (w_, t_) => {
        const P = frameParams(this.model, Object.assign({}, f.s, { warmth: w_, tint: t_ }), f.stats, roll);
        const L = this.printOf(P, pd).lab;
        return [L[1], L[2]];
      };
      for (let it = 0; it < 12; it++) {
        const r = ab(w, t);
        if (Math.hypot(r[0], r[1]) < 0.05) break;
        const h = 2, rw = ab(w + h, t), rt = ab(w, t + h);
        const J = [[(rw[0] - r[0]) / h, (rt[0] - r[0]) / h], [(rw[1] - r[1]) / h, (rt[1] - r[1]) / h]], det = J[0][0] * J[1][1] - J[0][1] * J[1][0];
        if (Math.abs(det) < 1e-9) break;
        w -= (J[1][1] * r[0] - J[0][1] * r[1]) / det;
        t -= (-J[1][0] * r[0] + J[0][0] * r[1]) / det;
        w = Math.max(-100, Math.min(100, w));
        t = Math.max(-100, Math.min(100, t));
      }
      return { warmth: Math.round(w), tint: Math.round(t) };
    }
    pickAt(ix, iy) {
      const pr = this.R.probe(ix, iy, 3);
      if (!pr || !pr.pd) return;
      if (this.pick === "grey") {
        this.set(this.neutralise(pr.pd.slice(0, 3)), { label: "Grey pick" });
        this.pick = null;
        this.notify();
      }
    }
    probeAt(ix, iy) {
      if (!this.R || !this.model || !this.P) return;
      const pr = this.R.probe(ix, iy, 1);
      if (!pr || !pr.pd) {
        this.readout = null;
        this.notify();
        return;
      }
      const p = this.printOf(this.P, pr.pd.slice(0, 3)), one = this.R.probe(ix, iy, 0), w = this.work();
      const base = one && one.c ? classify(one.T, w.Treb, w.sig.work, one.c[3]) : null;
      this.readout = { xy: [Math.round(ix), Math.round(iy)], T: pr.T, c: pr.c, pd: pr.pd, x: p.x, lab: import_colour2.default.lab(pr.print.slice(0, 3), import_colour2.default.D65), base, resid: one && one.c ? one.c[3] : 0 };
      this.notify();
    }
    // ---------- flat field: a capture of the light with no film in it, divided out of the scan (source.js)
    async openFlat(files) {
      const f = this.frame;
      if (!f) return;
      files = [...files];
      if (!files.length) return;
      this.setStatus({ msg: "Reading the flat field…", error: null });
      try {
        const trip = f.img.kind === "triplet";
        if (trip && files.length !== 3) throw new Error("This frame is a triplet: choose the three blank exposures, one per LED, named so they sort R, G, B like the scan.");
        if (!trip && files.length !== 1) throw new Error("Choose one blank exposure (three only for a triplet frame).");
        files.sort((a, b) => a.name.localeCompare(b.name, void 0, { numeric: true }));
        const imgs = [];
        for (const fl of files) imgs.push(await decodeFile(fl));
        const img = trip ? mergeTriplet(imgs) : imgs[0], ar = img.w / img.h, sr = f.img.w / f.img.h;
        if (Math.abs(ar - sr) > 0.01 * sr) throw new Error(`The flat field is ${img.w} × ${img.h} and the scan ${f.img.w} × ${f.img.h}: they must have the same shape, as captured (no rotation or crop).`);
        let mx = [0, 0, 0];
        for (let i = 0; i < img.data.length; i++) mx[i % 3] = Math.max(mx[i % 3], img.data[i]);
        if (mx.some((v) => !(v > 0))) throw new Error("The flat field has an empty channel: is the light in it?");
        const id = "flat-" + Math.random().toString(36).slice(2, 8), name = trip ? files[0].name.replace(/\.\w+$/, "") + " (RGB)" : files[0].name.replace(/\.\w+$/, "");
        FLATS.set(id, { id, name, w: img.w, h: img.h, data: img.data, kind: img.kind });
        this.setStatus({ msg: "" });
        this.setSrc({ flat: { id, name, detail: f.src.flat && f.src.flat.detail || "smooth" } });
      } catch (e) {
        this.setStatus({ error: "flat field: " + e.message, msg: "" });
      }
    }
    flatInfo(f = this.frame) {
      if (!f || !f.src.flat) return null;
      const F = FLATS.get(f.src.flat.id), G = F ? f.source.flat(f.src) : null;
      return { name: f.src.flat.name, detail: f.src.flat.detail || "smooth", loaded: !!F, used: !!G, size: F ? [F.w, F.h] : null, falloff: G ? G.falloff : null };
    }
    // the current frame's flat field on every other frame captured the same way (same size and kind)
    flatToAll() {
      const f = this.frame;
      if (!f || !f.src.flat) return;
      let n2 = 0;
      for (const g of this.frames) if (g !== f && g.img.w === f.img.w && g.img.h === f.img.h && g.img.kind === f.img.kind) {
        g.src.flat = clone(f.src.flat);
        g.stats = null;
        store2.set("cgstudio:" + g.name, { src: g.src, s: g.s, snaps: g.snaps });
        n2++;
      }
      this.setStatus({ msg: n2 ? `Flat field set on ${n2} more frame${n2 > 1 ? "s" : ""}` : "No other frame has the same size" });
      setTimeout(() => {
        if (/^(Flat field set|No other)/.test(this.status.msg)) this.setStatus({ msg: "" });
      }, 3e3);
      this.notify();
    }
    // ---------- ring-around: six moves of one step and a density strip, rendered small
    renderRing() {
      const f = this.frame, R = this.R, st = this.ringStep * PT, roll = this.rollInfo(f), negKey = this.negKey(f);
      const moves = [["+R (−C)", [0, 1, 1]], ["+M (−G)", [0, 1, 0]], ["+B (−Y)", [1, 1, 0]], ["+C (−R)", [1, 0, 0]], ["+G (−M)", [1, 0, 1]], ["+Y (−B)", [0, 0, 1]]];
      const tiles = [];
      const one = (dL, label, key) => {
        const ch = this.lightsToSliders(dL), s = Object.assign({}, f.s, { exposure: f.s.exposure + ch.exposure, warmth: f.s.warmth + ch.warmth, tint: f.s.tint + ch.tint });
        const t = R.variant(s, roll, negKey, "ring_" + key);
        const px = R.readBytes(t);
        return { label, key, dL, w: t.w, h: t.h, px, set: { exposure: +s.exposure.toFixed(2), warmth: Math.round(s.warmth), tint: Math.round(s.tint) } };
      };
      for (const [label, v] of moves) {
        const m = (v[0] + v[1] + v[2]) / 3;
        tiles.push(one(v.map((x) => (x - m) * st * 1.5), label, label));
      }
      tiles.push(one([0, 0, 0], "current", "current"));
      const dens = [-2, -1, 1, 2].map((k) => one([k * st, k * st, k * st].map((v) => v), k > 0 ? `+${k * this.ringStep} pt darker` : `${k * this.ringStep} pt lighter`, "d" + k));
      this.ring = { tiles, dens, step: this.ringStep };
    }
    setMode(m) {
      this.mode = m;
      if (m !== "ring") this.ring = null;
      this.notify();
      this.queue();
    }
    // ---------- roll
    async analyseRoll() {
      const keep = this.cur;
      for (let i = 0; i < this.frames.length; i++) {
        this.cur = i;
        await this.ensureModel();
        this.renderNow();
        this.setStatus({ msg: `Analysing frame ${i + 1} of ${this.frames.length}…` });
        await new Promise((r) => setTimeout(r, 0));
      }
      this.cur = keep;
      this.setStatus({ msg: "" });
      await this.ensureModel();
      this.queue();
    }
    // ---------- book links: st:set?…, st:reset?only=…, st:show?view=…, st:sample?name=…, st:chapter?id=…
    async link(href) {
      const m = href.match(/^st:(\w+)\??(.*)$/);
      if (!m) return;
      const [, verb, qs] = m, q = new URLSearchParams(qs.replace(/#.*$/, ""));
      if (verb === "chapter") {
        this.left = "book";
        this.chapter = q.get("id");
        this.notify();
        return;
      }
      if (verb === "sample") {
        if (!this.frames.some((f) => f.sample)) await this.addSample();
        else {
          this.select(this.frames.findIndex((f) => f.sample));
        }
        return;
      }
      if (!this.frame) {
        await this.addSample();
      }
      if (verb === "reset") {
        this.reset(q.get("only") || "all");
        return;
      }
      if (verb === "bench") {
        this.left = "develop";
        this.notify();
        await this.benchmark();
        return;
      }
      if (verb === "backend") {
        const b = q.get("b");
        if (["auto", "gpu", "workers", "main"].includes(b)) {
          this.left = this.left === "book" ? "book" : "develop";
          await this.setBackend(b);
        }
        return;
      }
      if (verb === "show") {
        const v = q.get("view");
        if (["print", "negative", "dyes", "unreachable", "base"].includes(v)) {
          this.view = v === "base" ? "unreachable" : v;
          this.mode = "develop";
        } else if (v === "split") {
          if (!Object.keys(this.frame.snaps).length) this.split = "__defaults";
          else this.split = Object.keys(this.frame.snaps)[0];
          this.mode = "develop";
        } else if (v === "ring") this.mode = "ring";
        else if (v === "window") {
          this.flash = "window";
          setTimeout(() => {
            this.flash = null;
            this.notify();
          }, 1600);
        }
        this.notify();
        this.queue();
        return;
      }
      if (verb === "set") {
        const ch = {};
        for (const [k, v] of q) {
          if (k.startsWith("hues.")) {
            ch[k] = v.split(",").map(Number);
            continue;
          }
          const s = BY_ID[k];
          if (!s) continue;
          ch[k] = s.type === "pad" ? v.split(",").map(Number) : s.type === "select" ? v : Math.max(s.min, Math.min(s.max, Number(v)));
        }
        this.set(ch, { label: "Book: " + Object.keys(ch).join(", ") });
      }
    }
    // ---------- recipes and export
    async saveRecipe() {
      const f = this.frame;
      if (!f) return;
      try {
        await save(new Blob([JSON.stringify(this.recipe(f), null, 1)], { type: "application/json" }), f.name.replace(/[^\w.-]+/g, "_") + ".recipe.json");
      } catch (e) {
        this.setStatus({ error: "recipe: " + e.message });
      }
    }
    recipe(f = this.frame) {
      const P = this.P;
      return { chromogen_studio: VERSION, frame: f.name, source: f.src, settings: f.s, lights: P ? { logH: P.lights.total.map((v) => +v.toFixed(4)), points: P.lights.total.map((v) => +(v / PT).toFixed(1)), auto: P.lights.auto.map((v) => +v.toFixed(4)) } : null, model: this.model ? { film: this.model.film.name, paper: this.model.paper.name, scanner: this.model.scanner.name } : null, written: (/* @__PURE__ */ new Date()).toISOString() };
    }
    async loadRecipe(r) {
      if (!r || !r.settings) throw new Error("not a Studio recipe");
      if (!this.frame) throw new Error("open the frame first, then its recipe");
      Object.assign(this.frame.src, r.source || {});
      this.set(Object.assign(defaults(), r.settings), { label: "Recipe" });
      await this.ensureModel();
      this.queue();
    }
    async exportFrame({ format = "png8", size = "full", p3 = false, recipe = true } = {}) {
      const f = this.frame, R = this.R;
      if (!f || !R) return;
      this.setStatus({ msg: "Exporting…", progress: 0 });
      try {
        const w = this.work(f), roll = this.rollInfo(f), negKey = this.negKey(f), bits = format === "png16" || format === "tiff16" ? 16 : 8;
        let px, W, H;
        if (size === "full") {
          W = w.fullW;
          H = w.fullH;
          px = await R.exportFull(f.s, { roll, negKey, fullW: W, fullH: H, filmUm: w.filmUm, bits, p3, getTile: (x0, y0, tw, th) => f.source.tile(f.src, x0, y0, tw, th), onProgress: (p) => {
            this.status.progress = p;
            this.notify();
          } });
        } else {
          R.frame(f.s, { roll, negKey, out: "exp", p3 });
          W = w.w;
          H = w.h;
          const b = R.readBytes(R.targets.get("exp"));
          px = bits === 16 ? Uint16Array.from(b, (v) => v * 257) : new Uint8ClampedArray(b);
        }
        const base = f.name.replace(/[^\w.-]+/g, "_"), rec = new TextEncoder().encode(JSON.stringify(this.recipe(f), null, 1));
        const recBlob = new Blob([rec], { type: "application/json" });
        let r;
        if (format === "tiff16") r = await save(zip([[base + ".tif", tiff16(px, W, H)], ...recipe ? [[base + ".recipe.json", rec]] : []]), base + ".zip");
        else {
          const img = format === "png16" ? await png16(px, W, H) : await canvasBlob(px, W, H, format === "jpeg" ? "image/jpeg" : "image/png", 0.95, p3);
          r = await save(img, base + (format === "jpeg" ? ".jpg" : ".png"));
          if (r === "saved" && recipe) r = await save(recBlob, base + ".recipe.json");
        }
        if (r === "declined") {
          this.setStatus({ msg: "Export not saved", progress: null });
          setTimeout(() => {
            if (/^Export not/.test(this.status.msg)) this.setStatus({ msg: "" });
          }, 4e3);
          this.queue();
          return;
        }
        this.setStatus({ msg: `Exported ${W} × ${H}`, progress: null });
        setTimeout(() => {
          if (/^Exported/.test(this.status.msg)) this.setStatus({ msg: "" });
        }, 4e3);
      } catch (e) {
        this.setStatus({ error: "export: " + e.message, msg: "", progress: null });
      }
      this.queue();
    }
  };

  // src/ui/controls.jsx
  var { useState, useRef } = React;
  var DEF = defaults();
  var same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function Slider({ st, sl, value, label, onSet }) {
    const v = value ?? sl.def, frac = (x) => (x - sl.min) / (sl.max - sl.min);
    const zero = sl.min < 0 && sl.max > 0 ? 0 : sl.def;
    const set = (x, commit) => onSet ? onSet(x, commit) : st.set({ [sl.id]: x }, { commit });
    const z = Math.max(0, Math.min(1, frac(zero))), t = Math.max(0, Math.min(1, frac(v)));
    return /* @__PURE__ */ React.createElement("div", { className: "ctl" + (same(v, sl.def) ? "" : " changed"), title: sl.what }, /* @__PURE__ */ React.createElement("div", { className: "row" }, /* @__PURE__ */ React.createElement("label", { onDoubleClick: () => set(sl.def, true) }, label || sl.label), sl.aside && /* @__PURE__ */ React.createElement("span", { className: "aside" }, sl.aside(v)), /* @__PURE__ */ React.createElement("span", { className: "val" }, sl.fmt ? sl.fmt(v) : v)), /* @__PURE__ */ React.createElement("div", { className: "track" }, /* @__PURE__ */ React.createElement("span", { className: "zero", style: { left: `calc(${z * 100}% )` } }), t !== z && /* @__PURE__ */ React.createElement("span", { className: "fillbar", style: { left: `${Math.min(z, t) * 100}%`, width: `${Math.abs(t - z) * 100}%` } }), /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "range",
        min: sl.min,
        max: sl.max,
        step: sl.step,
        value: v,
        "aria-label": sl.label,
        onChange: (e) => set(Number(e.target.value), false),
        onPointerUp: (e) => set(Number(e.target.value), true),
        onKeyUp: (e) => set(Number(e.target.value), true)
      }
    )));
  }
  function Pad({ st, sl, value }) {
    const v = value || [0, 0], ref = useRef(null), drag = useRef(false);
    const at = (e) => {
      const r = ref.current.getBoundingClientRect();
      const x = Math.max(-100, Math.min(100, ((e.clientX - r.left) / r.width * 2 - 1) * 100)), y = Math.max(-100, Math.min(100, (1 - (e.clientY - r.top) / r.height * 2) * 100));
      return [Math.round(x), Math.round(y)];
    };
    const W = 100, H = 60, px = (v[0] / 100 + 1) / 2 * W, py = (1 - (v[1] / 100 + 1) / 2) * H;
    return /* @__PURE__ */ React.createElement("div", { className: "cpad", title: sl.what }, /* @__PURE__ */ React.createElement("div", { className: "row" }, /* @__PURE__ */ React.createElement("label", { onDoubleClick: () => st.set({ [sl.id]: [0, 0] }) }, sl.label), /* @__PURE__ */ React.createElement("span", null, sl.fmt(v))), /* @__PURE__ */ React.createElement(
      "svg",
      {
        ref,
        viewBox: `0 0 ${W} ${H}`,
        preserveAspectRatio: "none",
        onPointerDown: (e) => {
          drag.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          st.set({ [sl.id]: at(e) }, { commit: false });
        },
        onPointerMove: (e) => {
          if (drag.current) st.set({ [sl.id]: at(e) }, { commit: false });
        },
        onPointerUp: (e) => {
          drag.current = false;
          st.set({ [sl.id]: at(e) }, { commit: true });
        },
        onDoubleClick: () => st.set({ [sl.id]: [0, 0] })
      },
      /* @__PURE__ */ React.createElement("line", { x1: W / 2, y1: "0", x2: W / 2, y2: H, stroke: "var(--rule)", vectorEffect: "non-scaling-stroke" }),
      /* @__PURE__ */ React.createElement("line", { x1: "0", y1: H / 2, x2: W, y2: H / 2, stroke: "var(--rule)", vectorEffect: "non-scaling-stroke" }),
      /* @__PURE__ */ React.createElement("text", { x: W - 2, y: H / 2 - 2, fontSize: "7", textAnchor: "end", fill: "var(--ink-2)" }, "warm"),
      /* @__PURE__ */ React.createElement("text", { x: "2", y: H / 2 - 2, fontSize: "7", fill: "var(--ink-2)" }, "cool"),
      /* @__PURE__ */ React.createElement("text", { x: W / 2 + 2, y: "7", fontSize: "7", fill: "var(--ink-2)" }, "magenta"),
      /* @__PURE__ */ React.createElement("text", { x: W / 2 + 2, y: H - 2, fontSize: "7", fill: "var(--ink-2)" }, "green"),
      /* @__PURE__ */ React.createElement("ellipse", { cx: px, cy: py, rx: "3.2", ry: "5.3", fill: "var(--bg)", stroke: same(v, [0, 0]) ? "var(--ink)" : "var(--accent)", strokeWidth: "1.4", vectorEffect: "non-scaling-stroke" })
    ));
  }
  var HUE_SW = { reds: "#d23c3c", skin: "#d9926a", yellows: "#d2b22a", greens: "#3c9a50", blues: "#3c64c8", purples: "#8c4cb4" };
  function Hues({ st, sl, value }) {
    const [fam, setFam] = useState("greens");
    const v = value && value[fam] || [0, 0];
    const mk = (i, label, min, max) => ({ id: "hue" + i, label, min, max, step: 1, def: 0, fmt: (x) => `${x > 0 ? "+" : ""}${Math.round(x)}`, what: sl.what });
    return /* @__PURE__ */ React.createElement("div", { className: "hues" }, /* @__PURE__ */ React.createElement("div", { className: "fam" }, sl.targets.map(([id, label]) => /* @__PURE__ */ React.createElement("button", { key: id, className: (fam === id ? "on " : "") + (value && value[id] && (value[id][0] || value[id][1]) ? "set" : ""), onClick: () => setFam(id) }, /* @__PURE__ */ React.createElement("i", { style: { background: HUE_SW[id] } }), label))), /* @__PURE__ */ React.createElement(Slider, { st, sl: mk(0, `${sl.targets.find((t) => t[0] === fam)[1]}: hue`, -100, 100), value: v[0], onSet: (x, c) => st.set({ ["hues." + fam]: [x, v[1]] }, { commit: c }) }), /* @__PURE__ */ React.createElement(Slider, { st, sl: mk(1, `${sl.targets.find((t) => t[0] === fam)[1]}: saturation`, -100, 100), value: v[1], onSet: (x, c) => st.set({ ["hues." + fam]: [v[0], x] }, { commit: c }) }));
  }
  function Select({ st, sl, value, options, label }) {
    return /* @__PURE__ */ React.createElement("div", { className: "sel-row", title: sl.what }, /* @__PURE__ */ React.createElement("label", null, label || sl.label), /* @__PURE__ */ React.createElement("select", { value, onChange: (e) => st.set({ [sl.id]: e.target.value }) }, (options || sl.options).map(([v, l]) => /* @__PURE__ */ React.createElement("option", { key: v, value: v }, l))));
  }
  function Control({ st, sl, s }) {
    if (sl.type === "pad") return null;
    if (sl.type === "select") return /* @__PURE__ */ React.createElement(Select, { st, sl, value: s[sl.id] });
    if (sl.type === "hues") return /* @__PURE__ */ React.createElement(Hues, { st, sl, value: s.hues });
    if (sl.id === "reshootAmount" && (!s.reshoot || s.reshoot === "none")) return null;
    return /* @__PURE__ */ React.createElement(Slider, { st, sl, value: s[sl.id] });
  }
  function Panel({ st }) {
    const f = st.frame, [closed, setClosed] = useState({});
    if (!f) return /* @__PURE__ */ React.createElement("div", { className: "pad16 mut small" }, "Open a scan, or load the real Gold 200 sample, to start.");
    const s = f.s, changed = (sec) => SLIDERS.some((sl) => sl.section === sec && !same(s[sl.id], DEF[sl.id]));
    const head = (sec, extra) => /* @__PURE__ */ React.createElement("div", { className: "h" }, /* @__PURE__ */ React.createElement("b", null, sec.title), /* @__PURE__ */ React.createElement("span", { className: "tag" + (sec.kind === "operator" ? " op" : "") }, sec.kind === "macro" ? "macros" : "operators"), /* @__PURE__ */ React.createElement("span", { className: "sp" }), extra, changed(sec.id) && /* @__PURE__ */ React.createElement("button", { className: "lnk", onClick: () => st.reset(sec.id) }, "reset"), /* @__PURE__ */ React.createElement("button", { className: "lnk", onClick: () => setClosed(Object.assign({}, closed, { [sec.id]: !closed[sec.id] })) }, closed[sec.id] ? "show" : "hide"));
    const look = BY_ID.look;
    return /* @__PURE__ */ React.createElement("div", null, SECTIONS.map((sec) => {
      const items = SLIDERS.filter((sl) => sl.section === sec.id && sl.id !== "look");
      return /* @__PURE__ */ React.createElement(React.Fragment, { key: sec.id }, sec.id === "tone" && /* @__PURE__ */ React.createElement("div", { className: "sec", style: { borderTop: "1px solid var(--ink)", marginTop: 16, paddingTop: 2 } }, /* @__PURE__ */ React.createElement("div", { className: "h", style: { borderBottom: 0, marginBottom: 2 } }, /* @__PURE__ */ React.createElement("b", null, "Finishing"), /* @__PURE__ */ React.createElement("span", { className: "tag op" }, "operators"), /* @__PURE__ */ React.createElement("span", { className: "sp" }), /* @__PURE__ */ React.createElement("button", { className: "lnk", onClick: () => st.reset("finishing") }, "reset all")), /* @__PURE__ */ React.createElement("div", { className: "about" }, "Operations outside the physical model, on top of the print. Look strength scales all of them."), /* @__PURE__ */ React.createElement(Slider, { st, sl: look, value: s.look })), /* @__PURE__ */ React.createElement("div", { className: "sec" + (closed[sec.id] ? " closed" : "") }, head(sec), /* @__PURE__ */ React.createElement("div", { className: "about" }, sec.about), sec.id === "print" && /* @__PURE__ */ React.createElement("div", { className: "pads" }, ["shadowColour", "highlightColour"].map((id) => /* @__PURE__ */ React.createElement(Pad, { key: id, st, sl: BY_ID[id], value: s[id] }))), items.map((sl) => /* @__PURE__ */ React.createElement(Control, { key: sl.id, st, sl, s })), sec.id === "roll" && /* @__PURE__ */ React.createElement(RollExtras, { st })));
    }), /* @__PURE__ */ React.createElement("div", { style: { height: 40 } }));
  }
  function RollExtras({ st }) {
    const others = st.frames.filter((g) => g !== st.frame);
    const withStats = st.frames.filter((g) => g.stats).length;
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "sel-row" }, /* @__PURE__ */ React.createElement("label", null, "Reference"), /* @__PURE__ */ React.createElement("select", { value: st.matchRef || "", onChange: (e) => {
      st.matchRef = e.target.value || null;
      st.notify();
      st.queue();
    } }, /* @__PURE__ */ React.createElement("option", { value: "" }, "(choose a frame)"), others.map((g) => /* @__PURE__ */ React.createElement("option", { key: g.id, value: g.id }, g.name)))), /* @__PURE__ */ React.createElement("div", { className: "skv" }, /* @__PURE__ */ React.createElement("span", null, "frames analysed"), /* @__PURE__ */ React.createElement("b", null, withStats, " of ", st.frames.length)), /* @__PURE__ */ React.createElement("button", { className: "btn sm", style: { marginTop: 6 }, disabled: st.frames.length < 2, onClick: () => st.analyseRoll() }, "Analyse roll"));
  }

  // src/markdown.js
  var esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  var slug = (s) => String(s).toLowerCase().replace(/<[^>]+>/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  function tex(src, display) {
    const K2 = globalThis.katex;
    if (K2 && K2.renderToString) {
      try {
        return K2.renderToString(src, { displayMode: !!display, output: "mathml", throwOnError: false, strict: false });
      } catch (e) {
      }
    }
    return display ? `<pre class="tex">${esc(src)}</pre>` : `<code class="tex">${esc(src)}</code>`;
  }
  function inline(s) {
    const keep = [];
    const stash = (html) => `\0${keep.push(html) - 1}\0`;
    s = s.replace(/`([^`]+)`/g, (_, c) => stash(`<code>${esc(c)}</code>`));
    s = s.replace(/\$\$([^$]+)\$\$/g, (_, m) => stash(tex(m, true)));
    s = s.replace(/(^|[^\\$\w])\$([^$\n]+?)\$(?![\w$])/g, (_, pre, m) => pre + stash(tex(m, false)));
    s = esc(s).replace(/\\\$/g, "$");
    s = s.replace(/\[([^\]]+)\]\((st:(?:[^()\n]|\([^()\n]*\))*|[^)\s]+)\)/g, (_, text, href) => {
      const h = href.replace(/&amp;/g, "&");
      if (/^st:/.test(h)) return `<a href="#" class="stlink" data-st="${esc(h)}">${text}</a>`;
      if (/^#/.test(h)) return `<a href="#" data-anchor="${esc(h.slice(1))}">${text}</a>`;
      if (/^https?:/.test(h)) return `<a href="${esc(h)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
      return text;
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<i>$2</i>").replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, "$1<i>$2</i>");
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[+i]);
  }
  var CALLOUTS = [[/^(try it|try|play)\b/i, "try"], [/^(exercise|exercises|challenge)\b/i, "exercise"], [/^(caveat|careful|warning|watch out|note)\b/i, "caveat"]];
  function render(md, o = {}) {
    const lines = String(md || "").replace(/\r/g, "").split("\n");
    const out = [], toc = [];
    let i = 0;
    const para = [];
    const flushPara = () => {
      if (para.length) {
        out.push(`<p>${inline(para.join(" "))}</p>`);
        para.length = 0;
      }
    };
    while (i < lines.length) {
      const L = lines[i];
      let m = L.match(/^```\s*([\w-]*)\s*$/);
      if (m) {
        flushPara();
        const lang = m[1].toLowerCase(), body = [];
        i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
        i++;
        if (lang === "math" || lang === "tex" || lang === "latex") out.push(`<div class="mathblock">${tex(body.join("\n"), true)}</div>`);
        else if (lang === "svg") {
          let j = i;
          while (j < lines.length && /^\s*$/.test(lines[j])) j++;
          let cap = "";
          if (j < lines.length && /^\s*\*{0,2}_?Figure\s+[\w.]+/.test(lines[j])) {
            const c = [];
            while (j < lines.length && !/^\s*$/.test(lines[j])) c.push(lines[j++].trim());
            cap = c.join(" ");
            i = j;
          }
          out.push(figure(body.join("\n"), cap, o));
        } else out.push(`<pre class="src${lang ? " lang-" + lang : ""}">${o.highlight && (lang === "js" || lang === "javascript" || lang === "") ? o.highlight(body.join("\n")) : esc(body.join("\n"))}</pre>`);
        continue;
      }
      if (/^\s*\$\$/.test(L)) {
        flushPara();
        let body = L.replace(/^\s*\$\$/, "");
        if (/\$\$\s*$/.test(body)) {
          out.push(`<div class="mathblock">${tex(body.replace(/\$\$\s*$/, ""), true)}</div>`);
          i++;
          continue;
        }
        const parts = [body];
        i++;
        while (i < lines.length && !/\$\$\s*$/.test(lines[i])) parts.push(lines[i++]);
        if (i < lines.length) parts.push(lines[i].replace(/\$\$\s*$/, ""));
        i++;
        out.push(`<div class="mathblock">${tex(parts.join("\n"), true)}</div>`);
        continue;
      }
      m = L.match(/^(#{1,4})\s+(.*)$/);
      if (m) {
        flushPara();
        const lvl = m[1].length, text = m[2].trim(), id = slug(text);
        if (lvl === 2) toc.push({ id, text });
        out.push(`<h${lvl} id="${o.idPrefix || ""}${id}">${inline(text)}</h${lvl}>`);
        i++;
        continue;
      }
      if (/^\s*(---|\*\*\*|___)\s*$/.test(L)) {
        flushPara();
        out.push("<hr>");
        i++;
        continue;
      }
      if (/^\s*\|.*\|\s*$/.test(L) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
        flushPara();
        const row = (s) => s.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
        const head = row(L), aligns = row(lines[i + 1]).map((c) => /:$/.test(c) ? /^:/.test(c) ? "center" : "right" : "left");
        i += 2;
        const rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(row(lines[i++]));
        const al = (k) => aligns[k] && aligns[k] !== "left" ? ` style="text-align:${aligns[k]}"` : "";
        out.push(`<div class="tablewrap-x"><table class="rt doc-t"><thead><tr>${head.map((c, k) => `<th${al(k)}>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, k) => `<td${al(k)}>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
        continue;
      }
      if (/^>\s?/.test(L)) {
        flushPara();
        const body = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ""));
        const first = body.join(" ").replace(/^\*\*([^*]+)\*\*.*/, "$1").trim();
        let cls = "";
        for (const [re, c] of CALLOUTS) if (re.test(first)) {
          cls = c;
          break;
        }
        out.push(`<div class="callout ${cls}">${render(body.join("\n"), Object.assign({}, o, { inner: true })).html}</div>`);
        continue;
      }
      if (/^\s*([-*+]|\d+[.)])\s+/.test(L)) {
        flushPara();
        const items = [];
        while (i < lines.length && (/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) || /^\s{2,}\S/.test(lines[i]) && items.length)) {
          const mm = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
          if (mm) items.push({ ind: mm[1].length, ord: /\d/.test(mm[2]), text: mm[3] });
          else items[items.length - 1].text += " " + lines[i].trim();
          i++;
        }
        out.push(listHtml(items, 0, items.length ? items[0].ind : 0).html);
        continue;
      }
      if (/^\s*$/.test(L)) {
        flushPara();
        i++;
        continue;
      }
      para.push(L.trim());
      i++;
    }
    flushPara();
    let html = out.join("\n");
    if (!o.inner && o.toc !== false && toc.length >= 3) html = html.replace(/(<\/h1>\s*(?:<p>[\s\S]*?<\/p>)?)/, `$1
<nav class="toc">${toc.map((t) => `<a href="#" data-anchor="${o.idPrefix || ""}${t.id}">${esc(t.text.replace(/[`*$]/g, ""))}</a>`).join("")}</nav>`);
    return { html, toc };
  }
  function listHtml(items, start, ind) {
    const ord = items[start] && items[start].ord, parts = [];
    let i = start;
    while (i < items.length && items[i].ind >= ind) {
      if (items[i].ind > ind) {
        const sub = listHtml(items, i, items[i].ind);
        parts[parts.length - 1] = parts[parts.length - 1].replace(/<\/li>$/, sub.html + "</li>");
        i = sub.next;
        continue;
      }
      parts.push(`<li>${inline(items[i].text)}</li>`);
      i++;
    }
    return { html: `<${ord ? "ol" : "ul"}>${parts.join("")}</${ord ? "ol" : "ul"}>`, next: i };
  }
  var hash = (s) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  };
  function sanitizeSvg(src) {
    let s = String(src).trim();
    if (!/^<svg[\s>]/.test(s)) return null;
    s = s.replace(/<\!--[\s\S]*?-->/g, "").replace(/<(script|style|foreignObject|iframe|image)\b[\s\S]*?<\/\1\s*>/gi, "").replace(/<(script|style|foreignObject|iframe|image)\b[^>]*\/>/gi, "");
    s = s.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "").replace(/\s(xlink:)?href\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, "");
    const p = "f" + hash(s) + "-";
    s = s.replace(/\sid\s*=\s*"([^"]+)"/g, ` id="${p}$1"`).replace(/url\(#([^)]+)\)/g, `url(#${p}$1)`).replace(/(\s(?:xlink:)?href\s*=\s*")#([^"]+)"/g, `$1#${p}$2"`);
    const root2 = s.match(/^<svg\b[^>]*>/)[0];
    const vb = (root2.match(/viewBox\s*=\s*"([^"]+)"/) || [])[1], w = +((root2.match(/\swidth\s*=\s*"([\d.]+)/) || [])[1] || (vb ? vb.trim().split(/[\s,]+/)[2] : 0));
    let r = root2.replace(/\s(width|height|style|class)\s*=\s*"[^"]*"/g, "");
    if (!/xmlns=/.test(r)) r = r.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
    r = r.replace(/>$/, ` class="figsvg"${w ? ` style="max-width:${w}px"` : ""}>`);
    return s.replace(/^<svg\b[^>]*>/, r);
  }
  function figure(src, cap, o) {
    const svg = sanitizeSvg(src);
    if (!svg) return `<pre class="src">${esc(src)}</pre>`;
    const label = cap.replace(/[*_`$\\]/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
    const s = label ? svg.replace(/^<svg\b/, `<svg role="img" aria-label="${esc(label)}"`) : svg;
    return `<figure class="fig">${s}${cap ? `<figcaption>${inline(cap)}</figcaption>` : ""}</figure>`;
  }

  // src/ui/left.jsx
  var { useEffect, useRef: useRef2, useMemo } = React;
  var COL = ["var(--pR)", "var(--pG)", "var(--pB)"];
  function PrintWindow({ st }) {
    const h = st.hist, m = st.model;
    if (!h || !m) return null;
    const W = 252, H = 120, pad = 14, x = (v) => (v - h.lo) / (h.hi - h.lo) * W, max = Math.max(1e-6, ...h.H.flat());
    const win = m.aim.window;
    const clip = [0, 1, 2].map((k) => {
      let lo = 0, hi = 0;
      h.H[k].forEach((v, i) => {
        const c = h.lo + (i + 0.5) / h.bins * (h.hi - h.lo);
        if (c < win[k][0]) lo += v;
        if (c > win[k][1]) hi += v;
      });
      return [lo, hi];
    });
    return /* @__PURE__ */ React.createElement("div", { className: "pw" + (st.flash === "window" ? " flash" : "") }, /* @__PURE__ */ React.createElement("svg", { viewBox: `0 0 ${W} ${H + pad}`, preserveAspectRatio: "none" }, /* @__PURE__ */ React.createElement("rect", { x: x(win[0][0]), y: "0", width: x(win[0][1]) - x(win[0][0]), height: H, fill: "var(--fill)" }), [0, 1].map((e) => /* @__PURE__ */ React.createElement("line", { key: e, x1: x(win[0][e]), x2: x(win[0][e]), y1: "0", y2: H, stroke: "var(--ink-2)", strokeDasharray: "3 2", vectorEffect: "non-scaling-stroke" })), [1, 2].map((k) => [0, 1].map((e) => /* @__PURE__ */ React.createElement("line", { key: k + "" + e, x1: x(win[k][e]), x2: x(win[k][e]), y1: H - 6, y2: H, stroke: COL[k], vectorEffect: "non-scaling-stroke" }))), h.H.map((a, k) => /* @__PURE__ */ React.createElement("polyline", { key: k, fill: "none", stroke: COL[k], strokeWidth: "1.4", vectorEffect: "non-scaling-stroke", points: a.map((v, i) => `${x(h.lo + (i + 0.5) / h.bins * (h.hi - h.lo)).toFixed(1)},${(H - v / max * (H - 8)).toFixed(1)}`).join(" ") })), /* @__PURE__ */ React.createElement("line", { x1: "0", x2: W, y1: H, y2: H, stroke: "var(--ink-2)", vectorEffect: "non-scaling-stroke" }), [-1, 0, 1].map((v) => /* @__PURE__ */ React.createElement("text", { key: v, x: x(v), y: H + 11, fontSize: "9", textAnchor: "middle", fill: "var(--ink-2)" }, v > 0 ? "+" : v < 0 ? "−" : "", Math.abs(v))), /* @__PURE__ */ React.createElement("text", { x: x(win[0][0]) + 3, y: "10", fontSize: "9", fill: "var(--ink-2)" }, "toe"), /* @__PURE__ */ React.createElement("text", { x: x(win[0][1]) - 3, y: "10", fontSize: "9", textAnchor: "end", fill: "var(--ink-2)" }, "shoulder")), /* @__PURE__ */ React.createElement("div", { className: "small mut", style: { marginTop: 4 } }, "paper log H per layer · window ", (win[0][1] - win[0][0]).toFixed(2), " log H ≈ ", Math.round((win[0][1] - win[0][0]) / PT), " pt (", m.paper.title || m.paper.name, ", red)"), /* @__PURE__ */ React.createElement("div", { className: "small mut" }, "past the shoulder (print black): ", clip.map((c) => (c[1] * 100).toFixed(1)).join(" · "), " % · below the toe (paper white): ", clip.map((c) => (c[0] * 100).toFixed(1)).join(" · "), " %"));
  }
  function Lights({ st }) {
    const P = st.P, m = st.model;
    if (!P || !m) return null;
    const a = m.aim.lights, L = P.lights, pt = (v) => (v / PT).toFixed(1);
    const rel = (v) => v.map((x, k) => x);
    const rows = [["auto (integrate, α)", L.auto.map((v, k) => v - a[k])], ["roll consistency", L.base.map((v, k) => v - L.auto[k])], ["match", L.match], ["exposure", L.exposure], ["warmth and tint", L.colour]];
    return /* @__PURE__ */ React.createElement("table", { className: "lights" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", { style: { textAlign: "left" } }, "points vs aim"), /* @__PURE__ */ React.createElement("th", null, "R"), /* @__PURE__ */ React.createElement("th", null, "G"), /* @__PURE__ */ React.createElement("th", null, "B"))), /* @__PURE__ */ React.createElement("tbody", null, rows.filter(([, v]) => v.some((x) => Math.abs(x) > 1e-4) || rows[0][1] === v).map(([n2, v]) => /* @__PURE__ */ React.createElement("tr", { key: n2 }, /* @__PURE__ */ React.createElement("td", null, n2), rel(v).map((x, k) => /* @__PURE__ */ React.createElement("td", { key: k }, x >= 0 ? "+" : "−", Math.abs(x / PT).toFixed(1))))), /* @__PURE__ */ React.createElement("tr", { className: "tot" }, /* @__PURE__ */ React.createElement("td", null, "lights, log H"), L.total.map((v, k) => /* @__PURE__ */ React.createElement("td", { key: k }, v.toFixed(3)))), /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", null, "vs aim, points"), L.total.map((v, k) => /* @__PURE__ */ React.createElement("td", { key: k }, v - a[k] >= 0 ? "+" : "−", Math.abs((v - a[k]) / PT).toFixed(1))))));
  }
  function SourceSummary({ st }) {
    const f = st.frame, m = st.model;
    if (!f || !m) return null;
    const w = st.work(f), S = f.stats && f.stats.blank != null ? f.stats : null, fi = st.flatInfo(f), pc = (v) => (v * 100).toFixed(1) + " %";
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "skv" }, /* @__PURE__ */ React.createElement("span", null, "film"), /* @__PURE__ */ React.createElement("b", null, m.film.title || m.film.name)), /* @__PURE__ */ React.createElement("div", { className: "skv" }, /* @__PURE__ */ React.createElement("span", null, "scanner"), /* @__PURE__ */ React.createElement("b", null, m.scanner.name)), /* @__PURE__ */ React.createElement("div", { className: "skv" }, /* @__PURE__ */ React.createElement("span", null, "rebate T"), /* @__PURE__ */ React.createElement("b", null, w.Treb.map((v) => v.toFixed(3)).join(" · "))), /* @__PURE__ */ React.createElement("div", { className: "skv" }, /* @__PURE__ */ React.createElement("span", null, "frame"), /* @__PURE__ */ React.createElement("b", null, w.fullW, " × ", w.fullH, " px · ", (w.filmUm[0] / 1e3).toFixed(0), " × ", (w.filmUm[1] / 1e3).toFixed(1), " mm")), /* @__PURE__ */ React.createElement("div", { className: "skv" }, /* @__PURE__ */ React.createElement("span", null, "flat field"), /* @__PURE__ */ React.createElement("b", null, fi ? fi.used ? fi.name : fi.name + " (not loaded)" : "none")), /* @__PURE__ */ React.createElement("div", { className: "skv" }, /* @__PURE__ */ React.createElement("span", null, "noise σ, D (", w.sig.from, ")"), /* @__PURE__ */ React.createElement("b", null, w.sig.work.map((v) => v.toFixed(4)).join(" · "))), S && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "skv" }, /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("i", { className: "sw blank" }), "blank film"), /* @__PURE__ */ React.createElement("b", null, pc(S.blank))), /* @__PURE__ */ React.createElement("div", { className: "skv" }, /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("i", { className: "sw below" }), "below base"), /* @__PURE__ */ React.createElement("b", null, pc(S.below))), /* @__PURE__ */ React.createElement("div", { className: "skv" }, /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("i", { className: "sw gamut" }), "out of gamut"), /* @__PURE__ */ React.createElement("b", { style: { color: S.gamut > 0.01 ? "var(--accent)" : void 0 } }, pc(S.gamut))), /* @__PURE__ */ React.createElement("div", { className: "skv" }, /* @__PURE__ */ React.createElement("span", null, "unreachable (solve)"), /* @__PURE__ */ React.createElement("b", null, pc(S.unreachable)))), /* @__PURE__ */ React.createElement("button", { className: "lnk", onClick: () => st.setMode("source") }, "edit the source, crop and rebate…"));
  }
  var ms = (v) => v == null ? "–" : v < 10 ? v.toFixed(1) + " ms" : v < 1e3 ? Math.round(v) + " ms" : (v / 1e3).toFixed(2) + " s";
  var KIND = { solve: "dye solve", pd: "printing density", print: "print" };
  function Compute({ st }) {
    const A = st.accel, G = A.gpu, last = {};
    for (const r of A.log) if (!last[r.kind]) last[r.kind] = r;
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "sel-row" }, /* @__PURE__ */ React.createElement("label", null, "Tables on"), /* @__PURE__ */ React.createElement("select", { value: A.pref, disabled: st.benching, onChange: (e) => st.setBackend(e.target.value) }, BACKENDS.map(([k, l]) => /* @__PURE__ */ React.createElement("option", { key: k, value: k }, l)))), /* @__PURE__ */ React.createElement("div", { className: "skv" }, /* @__PURE__ */ React.createElement("span", null, "now"), /* @__PURE__ */ React.createElement("b", null, A.resolved())), /* @__PURE__ */ React.createElement("div", { className: "skv" }, /* @__PURE__ */ React.createElement("span", null, "GPU"), /* @__PURE__ */ React.createElement("b", null, !G ? "checking…" : G.device ? G.name + (G.fallback ? " (software)" : "") : G.why)), /* @__PURE__ */ React.createElement("div", { className: "skv" }, /* @__PURE__ */ React.createElement("span", null, "workers"), /* @__PURE__ */ React.createElement("b", null, A.pool.n, " of ", A.cores, " cores")), ["solve", "pd", "print"].map((k) => last[k] && /* @__PURE__ */ React.createElement("div", { key: k, className: "skv", title: last[k].note || "" }, /* @__PURE__ */ React.createElement("span", null, KIND[k]), /* @__PURE__ */ React.createElement("b", null, ms(last[k].ms), " · ", last[k].backend))), st.ms > 0 && /* @__PURE__ */ React.createElement("div", { className: "skv" }, /* @__PURE__ */ React.createElement("span", null, "last render"), /* @__PURE__ */ React.createElement("b", null, ms(st.ms))), /* @__PURE__ */ React.createElement("button", { className: "lnk", disabled: st.benching || !st.model, onClick: () => st.benchmark() }, st.benching ? "benchmarking…" : "benchmark every backend on this frame…"), A.bench && /* @__PURE__ */ React.createElement("table", { className: "lights bench" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", { style: { textAlign: "left" } }, "backend"), /* @__PURE__ */ React.createElement("th", null, "solve"), /* @__PURE__ */ React.createElement("th", null, "pd"), /* @__PURE__ */ React.createElement("th", null, "print"), /* @__PURE__ */ React.createElement("th", { title: "largest difference from the main thread, in dye amount, over the nodes the solve reaches" }, "Δc"))), /* @__PURE__ */ React.createElement("tbody", null, A.bench.map((r) => /* @__PURE__ */ React.createElement("tr", { key: r.backend, title: r.error || (r.compile ? "first call, compiling the kernels: " + ms(r.compile) : "") }, /* @__PURE__ */ React.createElement("td", null, r.name), r.error ? /* @__PURE__ */ React.createElement("td", { colSpan: "4", style: { color: "var(--accent)" } }, r.error) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("td", null, ms(r.solve)), /* @__PURE__ */ React.createElement("td", null, ms(r.pd)), /* @__PURE__ */ React.createElement("td", null, ms(r.print)), /* @__PURE__ */ React.createElement("td", null, r.backend === "main" ? "ref." : r.dsolve != null ? (r.dsolve === 0 ? "0" : r.dsolve.toExponential(0)) + (r.flips ? ` · ${r.flips} flips` : "") : "–")))))));
  }
  function Snapshots({ st }) {
    const f = st.frame;
    if (!f) return null;
    const names = Object.keys(f.snaps);
    return /* @__PURE__ */ React.createElement("div", { className: "list" }, names.length === 0 && /* @__PURE__ */ React.createElement("div", { className: "small mut" }, "None yet. A snapshot keeps the current settings to compare against (before / after)."), names.map((n2) => /* @__PURE__ */ React.createElement("div", { key: n2, className: "it" + (st.split === n2 ? " on" : ""), onClick: () => st.compare(n2) }, /* @__PURE__ */ React.createElement("b", null, n2), /* @__PURE__ */ React.createElement("span", { className: "sp" }), /* @__PURE__ */ React.createElement("small", null, st.split === n2 ? "comparing" : "compare"), /* @__PURE__ */ React.createElement("button", { className: "lnk", onClick: (e) => {
      e.stopPropagation();
      st.set(JSON.parse(JSON.stringify(f.snaps[n2])), { label: "Restore " + n2 });
    } }, "restore"), /* @__PURE__ */ React.createElement("button", { className: "lnk", onClick: (e) => {
      e.stopPropagation();
      delete f.snaps[n2];
      if (st.split === n2) st.split = null;
      st.save();
      st.notify();
      st.queue();
    } }, "delete"))));
  }
  function History({ st }) {
    const f = st.frame;
    if (!f) return null;
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6, marginBottom: 6 } }, /* @__PURE__ */ React.createElement("button", { className: "btn sm", disabled: !f.hist.length, onClick: () => st.undo() }, "Undo"), /* @__PURE__ */ React.createElement("button", { className: "btn sm", disabled: !f.fut.length, onClick: () => st.redo() }, "Redo")), f.hist.slice(-8).reverse().map((h, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "hist-it" }, h.label)), !f.hist.length && /* @__PURE__ */ React.createElement("div", { className: "small mut" }, "No changes yet."));
  }
  function Book({ st }) {
    const chapters = window.ST_DATA.book || [], ref = useRef2(null);
    const cur = chapters.find((c) => c.id === st.chapter) || chapters[0];
    const html = useMemo(() => cur ? render(cur.body, { toc: false }).html : "", [cur && cur.id]);
    useEffect(() => {
      if (ref.current) ref.current.scrollTop = 0;
    }, [cur && cur.id]);
    if (!cur) return /* @__PURE__ */ React.createElement("div", { className: "pad16 mut" }, "The book is not bundled in this build.");
    const i = chapters.indexOf(cur);
    const click = (e) => {
      const a = e.target.closest("a");
      if (!a) return;
      if (a.dataset.st) {
        e.preventDefault();
        st.link(a.dataset.st);
      } else if (a.dataset.anchor) {
        e.preventDefault();
        const el = ref.current.querySelector("#" + CSS.escape(a.dataset.anchor));
        if (el) el.scrollIntoView({ block: "start" });
      }
    };
    return /* @__PURE__ */ React.createElement("div", { className: "sbook", ref, onClick: click }, /* @__PURE__ */ React.createElement("div", { className: "chap-nav" }, /* @__PURE__ */ React.createElement("button", { className: "btn sm", disabled: i <= 0, onClick: () => {
      st.chapter = chapters[i - 1].id;
      st.notify();
    } }, "◂"), /* @__PURE__ */ React.createElement("select", { value: cur.id, onChange: (e) => {
      st.chapter = e.target.value;
      st.notify();
    } }, chapters.map((c) => /* @__PURE__ */ React.createElement("option", { key: c.id, value: c.id }, c.title))), /* @__PURE__ */ React.createElement("button", { className: "btn sm", disabled: i >= chapters.length - 1, onClick: () => {
      st.chapter = chapters[i + 1].id;
      st.notify();
    } }, "▸")), /* @__PURE__ */ React.createElement("div", { dangerouslySetInnerHTML: { __html: html } }), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", marginTop: 24 } }, i > 0 ? /* @__PURE__ */ React.createElement("button", { className: "btn sm", onClick: () => {
      st.chapter = chapters[i - 1].id;
      st.notify();
    } }, "◂ ", chapters[i - 1].title) : /* @__PURE__ */ React.createElement("span", null), i < chapters.length - 1 && /* @__PURE__ */ React.createElement("button", { className: "btn sm", onClick: () => {
      st.chapter = chapters[i + 1].id;
      st.notify();
    } }, chapters[i + 1].title, " ▸")));
  }
  function Left({ st }) {
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "tabs" }, /* @__PURE__ */ React.createElement("button", { className: st.left === "develop" ? "on" : "", onClick: () => {
      st.left = "develop";
      st.notify();
    } }, "Print"), /* @__PURE__ */ React.createElement("button", { className: st.left === "book" ? "on" : "", onClick: () => {
      st.left = "book";
      st.notify();
    } }, "Book")), st.left === "book" ? /* @__PURE__ */ React.createElement(Book, { st }) : /* @__PURE__ */ React.createElement("div", { className: "pad16" }, /* @__PURE__ */ React.createElement("div", { className: "h" }, /* @__PURE__ */ React.createElement("b", null, "Print window"), /* @__PURE__ */ React.createElement("span", { className: "sp" }), /* @__PURE__ */ React.createElement("span", { className: "tag" }, "paper log H")), /* @__PURE__ */ React.createElement(PrintWindow, { st }), /* @__PURE__ */ React.createElement("div", { className: "h" }, /* @__PURE__ */ React.createElement("b", null, "Printer lights")), /* @__PURE__ */ React.createElement(Lights, { st }), /* @__PURE__ */ React.createElement("div", { className: "h" }, /* @__PURE__ */ React.createElement("b", null, "Source")), /* @__PURE__ */ React.createElement(SourceSummary, { st }), /* @__PURE__ */ React.createElement("div", { className: "h" }, /* @__PURE__ */ React.createElement("b", null, "Compute"), /* @__PURE__ */ React.createElement("span", { className: "sp" }), /* @__PURE__ */ React.createElement("button", { className: "lnk", onClick: () => st.link("st:chapter?id=perf") }, "how it works")), /* @__PURE__ */ React.createElement(Compute, { st }), /* @__PURE__ */ React.createElement("div", { className: "h" }, /* @__PURE__ */ React.createElement("b", null, "Snapshots"), /* @__PURE__ */ React.createElement("span", { className: "sp" }), /* @__PURE__ */ React.createElement("button", { className: "lnk", disabled: !st.frame, onClick: () => st.snapshot() }, "+ snapshot (S)")), /* @__PURE__ */ React.createElement(Snapshots, { st }), /* @__PURE__ */ React.createElement("div", { className: "h" }, /* @__PURE__ */ React.createElement("b", null, "History")), /* @__PURE__ */ React.createElement(History, { st })));
  }

  // src/ui/views.jsx
  var { useEffect: useEffect2, useRef: useRef3, useState: useState2 } = React;
  function CanvasView({ st }) {
    const wrap = useRef3(null), cv = useRef3(null), drag = useRef3(null), last = useRef3(0);
    useEffect2(() => {
      st.attach(cv.current);
      const ro = new ResizeObserver(() => {
        const r2 = wrap.current.getBoundingClientRect(), d = window.devicePixelRatio || 1;
        cv.current.width = Math.max(1, Math.round(r2.width * d));
        cv.current.height = Math.max(1, Math.round(r2.height * d));
        st.queue();
      });
      ro.observe(wrap.current);
      return () => ro.disconnect();
    }, []);
    const pos = (e) => {
      const r2 = cv.current.getBoundingClientRect();
      return st.toImage(e.clientX - r2.left, e.clientY - r2.top, r2);
    };
    const move = (e) => {
      const p = pos(e);
      if (drag.current === "split" && p) {
        st.splitPos = Math.max(0.02, Math.min(0.98, p[2]));
        st.queue();
        return;
      }
      const now2 = performance.now();
      if (now2 - last.current < 60) return;
      last.current = now2;
      if (p) st.probeAt(p[0], p[1]);
      else if (st.readout) {
        st.readout = null;
        st.notify();
      }
    };
    const down = (e) => {
      const p = pos(e);
      if (!p) return;
      if (st.pick) {
        st.pickAt(p[0], p[1]);
        return;
      }
      if (st.split) {
        drag.current = "split";
        e.currentTarget.setPointerCapture(e.pointerId);
        st.splitPos = p[2];
        st.queue();
      }
    };
    const drop = (e) => {
      e.preventDefault();
      if (e.dataTransfer.files.length) st.openFiles(e.dataTransfer.files, { triplet: e.dataTransfer.files.length === 3 && e.shiftKey });
    };
    const r = st.readout;
    return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { ref: wrap, className: "canvas-wrap" + (st.pick ? " picking" : ""), onPointerMove: move, onPointerDown: down, onPointerUp: () => {
      drag.current = null;
    }, onPointerLeave: () => {
      if (st.readout) {
        st.readout = null;
        st.notify();
      }
    }, onDragOver: (e) => e.preventDefault(), onDrop: drop }, /* @__PURE__ */ React.createElement("canvas", { ref: cv }), !st.frames.length && /* @__PURE__ */ React.createElement(Drop, { st }), st.view === "unreachable" && st.mode === "develop" && st.frame && /* @__PURE__ */ React.createElement(BaseLegend, { st })), /* @__PURE__ */ React.createElement("div", { className: "sreadout" }, st.pick === "grey" ? /* @__PURE__ */ React.createElement("span", { className: "warn" }, "Click a neutral (grey, white or black) area: Warmth and Tint are set to print it neutral.") : r ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", null, "x ", /* @__PURE__ */ React.createElement("b", null, r.xy[0]), " y ", /* @__PURE__ */ React.createElement("b", null, r.xy[1])), r.c && /* @__PURE__ */ React.createElement("span", null, "dyes ", /* @__PURE__ */ React.createElement("b", null, r.c.slice(0, 3).map((v) => v.toFixed(2)).join(" · "))), r.base && r.base.cls !== "ok" && /* @__PURE__ */ React.createElement("span", { className: "base " + r.base.cls }, /* @__PURE__ */ React.createElement("i", { className: "sw " + r.base.cls }), BASE_TEXT[r.base.cls](r)), r.pd && /* @__PURE__ */ React.createElement("span", null, "printing density ", /* @__PURE__ */ React.createElement("b", null, r.pd.slice(0, 3).map((v) => v.toFixed(2)).join(" · "))), /* @__PURE__ */ React.createElement("span", null, "paper log H ", /* @__PURE__ */ React.createElement("b", null, r.x.map((v) => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(2)).join(" · "))), /* @__PURE__ */ React.createElement("span", null, "print L* ", /* @__PURE__ */ React.createElement("b", null, r.lab[0].toFixed(1)), " a* ", /* @__PURE__ */ React.createElement("b", null, r.lab[1].toFixed(1)), " b* ", /* @__PURE__ */ React.createElement("b", null, r.lab[2].toFixed(1)))) : st.frames.length ? /* @__PURE__ */ React.createElement("span", null, "Hover the print for its densities and colour. ", st.split ? "Drag across the image to move the split." : "") : /* @__PURE__ */ React.createElement("span", null, "No frame yet.")));
  }
  var LAYER = ["R", "G", "B"];
  var BASE_TEXT = {
    blank: (r) => `blank film: ${r.base.layers.map((k) => LAYER[k]).join(", ")} at base (density ${r.base.layers.map((k) => (r.base.D[k] >= 0 ? "+" : "−") + Math.abs(r.base.D[k]).toFixed(3)).join(", ")} D, within the noise)`,
    below: (r) => `below base: ${r.base.layers.map((k) => LAYER[k] + " " + Math.abs(r.base.D[k]).toFixed(3)).join(", ")} D lighter than the rebate, more than the noise explains`,
    gamut: (r) => `out of gamut: no dye amounts reproduce these densities (residual ${r.resid.toFixed(3)} D)`
  };
  function BaseLegend({ st }) {
    const S = st.frame.stats, w = st.work(), fi = st.flatInfo(), pc = (v) => S && S[v] != null ? (S[v] * 100).toFixed(1) + " %" : "";
    return /* @__PURE__ */ React.createElement("div", { className: "legend" }, /* @__PURE__ */ React.createElement("span", { title: "Some layer reads at the film's base, within ±3 σ of the scan's noise: that layer recorded nothing here, and the print can only show it as one tone." }, /* @__PURE__ */ React.createElement("i", { className: "sw blank" }), "blank film ", /* @__PURE__ */ React.createElement("b", null, pc("blank"))), /* @__PURE__ */ React.createElement("span", { title: "Some layer reads lighter than the rebate by more than 3 σ, which unexposed film cannot do: uneven light across the scan (a flat field fixes it) or an unrepresentative rebate." }, /* @__PURE__ */ React.createElement("i", { className: "sw below" }), "below base ", /* @__PURE__ */ React.createElement("b", null, pc("below"))), /* @__PURE__ */ React.createElement("span", { title: "Every layer has formed dye, yet no dye amounts reproduce the densities: the scanner profile or the film stock is wrong." }, /* @__PURE__ */ React.createElement("i", { className: "sw gamut" }), "out of gamut ", /* @__PURE__ */ React.createElement("b", null, pc("gamut"))), /* @__PURE__ */ React.createElement("span", { className: "mut", title: "The scan's noise per channel, as density: the ±3 σ band decides blank film and below base." }, "σ ", w.sig.work.map((v) => v.toFixed(4)).join(" · "), " D · ", w.sig.from === "rebate" ? "from the rebate" : w.sig.from === "frame" ? "from thin areas" : "assumed", " · flat field ", fi && fi.used ? fi.name : "none"));
  }
  function Drop({ st }) {
    const one = useRef3(null), three = useRef3(null);
    return /* @__PURE__ */ React.createElement("div", { className: "drop" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("b", null, "Drop scans here"), ", or ", /* @__PURE__ */ React.createElement("button", { className: "lnk", style: { fontSize: 13 }, onClick: () => one.current.click() }, "open scans…"), /* @__PURE__ */ React.createElement("br", null), "a red, green and blue exposure of one frame: ", /* @__PURE__ */ React.createElement("button", { className: "lnk", style: { fontSize: 13 }, onClick: () => three.current.click() }, "open a triplet…"), /* @__PURE__ */ React.createElement("br", null), "16-bit linear TIFF (or linear DNG), 16-bit PNG, JPEG · raw camera files are not decoded yet", /* @__PURE__ */ React.createElement("br", null), /* @__PURE__ */ React.createElement("br", null), /* @__PURE__ */ React.createElement("button", { className: "btn primary", onClick: () => st.addSample() }, "Load the real Gold 200 scan (Appendix E)"), /* @__PURE__ */ React.createElement("input", { ref: one, type: "file", multiple: true, hidden: true, accept: ".tif,.tiff,.dng,.png,.jpg,.jpeg,.webp,.json", onChange: (e) => st.openFiles(e.target.files) }), /* @__PURE__ */ React.createElement("input", { ref: three, type: "file", multiple: true, hidden: true, accept: ".tif,.tiff,.dng,.png,.jpg,.jpeg", onChange: (e) => st.openFiles(e.target.files, { triplet: true }) })));
  }
  function RingView({ st }) {
    const ring = st.ring;
    useEffect2(() => {
      if (!ring) st.queue();
    }, [ring]);
    if (!ring) return /* @__PURE__ */ React.createElement("div", { className: "ring mut" }, "Rendering the ring-around…");
    const Tile = ({ t, cur }) => {
      const ref = useRef3(null);
      useEffect2(() => {
        const c = ref.current;
        c.width = t.w;
        c.height = t.h;
        c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(t.px.buffer.slice(0)), t.w, t.h), 0, 0);
      }, [t]);
      return /* @__PURE__ */ React.createElement("div", { className: "rtile" + (cur ? " cur" : ""), onClick: () => {
        if (!cur) st.set(t.set, { label: "Ring-around " + t.label });
      } }, /* @__PURE__ */ React.createElement("canvas", { ref }), /* @__PURE__ */ React.createElement("span", null, t.label));
    };
    const T = Object.fromEntries(ring.tiles.map((t) => [t.key, t]));
    const grid = [T["+Y (−B)"], T["+R (−C)"], T["+M (−G)"], T["+G (−M)"], T.current, T["+B (−Y)"], null, T["+C (−R)"], null];
    return /* @__PURE__ */ React.createElement("div", { className: "ring" }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10, alignItems: "center", maxWidth: 980, margin: "0 auto", width: "100%" } }, /* @__PURE__ */ React.createElement("b", { style: { fontSize: 13 } }, "Ring-around"), /* @__PURE__ */ React.createElement("span", { className: "mut small" }, "One step of the printer lights in each direction. Click the print that looks right; opposite tiles are opposite moves."), /* @__PURE__ */ React.createElement("span", { style: { flex: 1 } }), /* @__PURE__ */ React.createElement("div", { className: "seg" }, [2, 4, 8].map((k) => /* @__PURE__ */ React.createElement("button", { key: k, className: ring.step === k ? "on" : "", onClick: () => {
      st.ringStep = k;
      st.ring = null;
      st.notify();
      st.queue();
    } }, k, " pt")))), /* @__PURE__ */ React.createElement("div", { className: "hex" }, grid.map((t, i) => t ? /* @__PURE__ */ React.createElement(Tile, { key: i, t, cur: t.key === "current" }) : /* @__PURE__ */ React.createElement("div", { key: i }))), /* @__PURE__ */ React.createElement("div", { style: { maxWidth: 980, margin: "0 auto", width: "100%" }, className: "small mut" }, "Density (equal change of all three lights)"), /* @__PURE__ */ React.createElement("div", { className: "dens" }, [ring.dens[0], ring.dens[1], T.current, ring.dens[2], ring.dens[3]].map((t, i) => /* @__PURE__ */ React.createElement(Tile, { key: i, t, cur: t.key === "current" }))));
  }
  function SourceView({ st }) {
    const f = st.frame, cv = useRef3(null), box = useRef3(null), [ov, setOv] = useState2(null), [tool, setTool] = useState2("crop"), drag = useRef3(null), [fit, setFit] = useState2([0, 0]);
    useEffect2(() => {
      if (!box.current) return;
      const ro = new ResizeObserver(() => {
        const r = box.current.getBoundingClientRect();
        setFit([r.width - 32, r.height - 32]);
      });
      ro.observe(box.current);
      return () => ro.disconnect();
    }, [!!ov]);
    useEffect2(() => {
      if (!f) return;
      const o = f.source.overview(f.src);
      setOv(o);
    }, [f && f.id, f && f.src.flipH, f && f.src.flipV, f && f.src.rotate, f && f.src.encoding, f && JSON.stringify(f.src.flat)]);
    useEffect2(() => {
      if (!ov || !cv.current) return;
      const c = cv.current;
      c.width = ov.w;
      c.height = ov.h;
      const id = new ImageData(ov.w, ov.h), mx = [0, 1, 2].map((k) => {
        let m = 0;
        for (let i = k; i < ov.data.length; i += 3) m = Math.max(m, ov.data[i]);
        return m || 1;
      });
      for (let i = 0; i < ov.w * ov.h; i++) for (let k = 0; k < 3; k++) id.data[4 * i + k] = Math.round(255 * Math.pow(Math.min(1, ov.data[3 * i + k] / mx[k]), 1 / 2.2));
      for (let i = 0; i < ov.w * ov.h; i++) id.data[4 * i + 3] = 255;
      c.getContext("2d").putImageData(id, 0, 0);
    }, [ov]);
    if (!f || !ov) return /* @__PURE__ */ React.createElement("div", { className: "srcview mut" }, "No frame.");
    const s = ov.scale, crop = f.source.crop(f.src), reb = f.src.rebate && f.src.rebate.box;
    const at = (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      return [Math.round((e.clientX - r.left) / r.width * ov.W), Math.round((e.clientY - r.top) / r.height * ov.H)];
    };
    const down = (e) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      const p = at(e);
      drag.current = { p0: p, tool };
    };
    const move = (e) => {
      if (!drag.current) return;
      const p = at(e), p0 = drag.current.p0;
      const box2 = [Math.min(p[0], p0[0]), Math.min(p[1], p0[1]), Math.abs(p[0] - p0[0]), Math.abs(p[1] - p0[1])];
      drag.current.box = box2;
      drag.current.live = true;
      setOv(Object.assign({}, ov, { live: { tool: drag.current.tool, box: box2 } }));
    };
    const up = () => {
      const d = drag.current;
      drag.current = null;
      if (!d || !d.box || d.box[2] < 4 || d.box[3] < 4) {
        setOv(Object.assign({}, ov, { live: null }));
        return;
      }
      if (d.tool === "crop") st.setSrc({ crop: d.box });
      else st.setSrc({ rebate: { box: d.box } });
      setOv(Object.assign({}, ov, { live: null }));
    };
    const live = ov.live;
    return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "tools" }, /* @__PURE__ */ React.createElement("b", { style: { fontSize: 12 } }, "Source"), /* @__PURE__ */ React.createElement("span", { className: "mut small" }, "The whole scan as captured. Drag to set the ", tool === "crop" ? "printed frame (crop)" : "rebate: clear, unexposed film beside the frame", "."), /* @__PURE__ */ React.createElement("span", { className: "sp" }), /* @__PURE__ */ React.createElement("div", { className: "seg" }, /* @__PURE__ */ React.createElement("button", { className: tool === "crop" ? "on" : "", onClick: () => setTool("crop") }, "Crop"), /* @__PURE__ */ React.createElement("button", { className: tool === "rebate" ? "on" : "", onClick: () => setTool("rebate") }, "Rebate")), /* @__PURE__ */ React.createElement("button", { className: "btn sm", onClick: () => st.setMode("develop") }, "Done")), /* @__PURE__ */ React.createElement("div", { className: "srcview", ref: box }, /* @__PURE__ */ React.createElement("div", { className: "stage", style: (() => {
      const sc = Math.min(fit[0] / ov.w, fit[1] / ov.h) || 0;
      return { width: Math.max(1, ov.w * sc), height: Math.max(1, ov.h * sc) };
    })() }, /* @__PURE__ */ React.createElement("canvas", { ref: cv, style: { width: "100%", height: "100%" } }), /* @__PURE__ */ React.createElement("svg", { viewBox: `0 0 ${ov.W} ${ov.H}`, preserveAspectRatio: "none", onPointerDown: down, onPointerMove: move, onPointerUp: up, style: { cursor: "crosshair" } }, /* @__PURE__ */ React.createElement("path", { d: `M0,0 H${ov.W} V${ov.H} H0 Z M${crop[0]},${crop[1]} v${crop[3]} h${crop[2]} v${-crop[3]} Z`, fill: "rgba(0,0,0,.35)", fillRule: "evenodd" }), /* @__PURE__ */ React.createElement("rect", { className: "crop", x: crop[0], y: crop[1], width: crop[2], height: crop[3], vectorEffect: "non-scaling-stroke" }), reb && /* @__PURE__ */ React.createElement("rect", { className: "reb", x: reb[0], y: reb[1], width: reb[2], height: reb[3], vectorEffect: "non-scaling-stroke" }), live && /* @__PURE__ */ React.createElement("rect", { className: live.tool === "crop" ? "crop" : "reb", x: live.box[0], y: live.box[1], width: live.box[2], height: live.box[3], vectorEffect: "non-scaling-stroke", strokeDasharray: "5 3" })))), /* @__PURE__ */ React.createElement("div", { className: "sreadout" }, /* @__PURE__ */ React.createElement("span", null, "crop ", /* @__PURE__ */ React.createElement("b", null, crop.join(", "))), /* @__PURE__ */ React.createElement("span", null, "rebate ", /* @__PURE__ */ React.createElement("b", null, reb ? reb.join(", ") : "auto (bright percentile of the frame)")), /* @__PURE__ */ React.createElement("span", null, "scan ", /* @__PURE__ */ React.createElement("b", null, ov.W, " × ", ov.H))));
  }
  function SourcePanel({ st }) {
    const f = st.frame, flatIn = useRef3(null);
    if (!f) return null;
    const fi = st.flatInfo(f), trip = f.img.kind === "triplet";
    const s = f.src, set = (o) => st.setSrc(o);
    const sel = (label, value, opts, on) => /* @__PURE__ */ React.createElement("div", { className: "sel-row" }, /* @__PURE__ */ React.createElement("label", null, label), /* @__PURE__ */ React.createElement("select", { value, onChange: (e) => on(e.target.value) }, opts.map(([v, l]) => /* @__PURE__ */ React.createElement("option", { key: v, value: v }, l))));
    const peaks = s.peaks || [665, 530, 450];
    return /* @__PURE__ */ React.createElement("div", { className: "sec" }, /* @__PURE__ */ React.createElement("div", { className: "h" }, /* @__PURE__ */ React.createElement("b", null, "Source"), /* @__PURE__ */ React.createElement("span", { className: "tag" }, "this frame")), /* @__PURE__ */ React.createElement("div", { className: "about" }, "What was scanned and how. The film's dyes and the scanner's channels drive the dye solve (§9); changing either rebuilds its table."), sel("Film", s.film, FILMS, (v) => set({ film: v })), sel("Scanner", s.scanner, SCANNERS, (v) => set({ scanner: v })), s.scanner === "custom-led" && /* @__PURE__ */ React.createElement("div", { className: "sel-row" }, /* @__PURE__ */ React.createElement("label", null, "LED peaks, nm"), [0, 1, 2].map((k) => /* @__PURE__ */ React.createElement("input", { key: k, type: "number", value: peaks[k], min: "380", max: "780", onChange: (e) => {
      const p = peaks.slice();
      p[k] = Number(e.target.value);
      set({ peaks: p });
    } }))), sel("Encoding", s.encoding, [["linear", "linear (raw, scanner raw)"], ["srgb", "sRGB-encoded"], ["gamma22", "gamma 2.2"]], (v) => set({ encoding: v })), sel("Format", s.format || "135", FORMATS.map((x) => [x[0], x[1]]), (v) => set({ format: v })), /* @__PURE__ */ React.createElement("div", { className: "sel-row" }, /* @__PURE__ */ React.createElement("label", null, "Orientation"), /* @__PURE__ */ React.createElement("button", { className: "tog" + (s.flipH ? " on" : ""), onClick: () => set({ flipH: !s.flipH, crop: null, rebate: s.rebate && s.rebate.box ? { auto: true } : s.rebate }) }, "flip ↔"), /* @__PURE__ */ React.createElement("button", { className: "tog" + (s.flipV ? " on" : ""), onClick: () => set({ flipV: !s.flipV, crop: null, rebate: s.rebate && s.rebate.box ? { auto: true } : s.rebate }) }, "flip ↕"), /* @__PURE__ */ React.createElement("button", { className: "btn sm", onClick: () => set({ rotate: ((s.rotate || 0) + 90) % 360, crop: null, rebate: { auto: true } }) }, "⟳ 90°")), /* @__PURE__ */ React.createElement("div", { className: "h" }, /* @__PURE__ */ React.createElement("b", null, "Rebate")), /* @__PURE__ */ React.createElement("div", { className: "about" }, "The density zero (§8.7): unexposed, processed film. Pick it in the source view (Rebate tool), or let the Studio take a bright percentile of the frame."), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6 } }, /* @__PURE__ */ React.createElement("button", { className: "btn sm", onClick: () => st.setMode("source") }, "Pick in the source view"), /* @__PURE__ */ React.createElement("button", { className: "btn sm", onClick: () => set({ rebate: { auto: true } }) }, "Auto"), /* @__PURE__ */ React.createElement("button", { className: "btn sm", onClick: () => set({ crop: null }) }, "Reset crop")), /* @__PURE__ */ React.createElement("div", { className: "skv", style: { marginTop: 8 } }, /* @__PURE__ */ React.createElement("span", null, "rebate T (R, G, B)"), /* @__PURE__ */ React.createElement("b", null, st.work(f).Treb.map((v) => v.toFixed(4)).join(" · "))), /* @__PURE__ */ React.createElement("div", { className: "skv" }, /* @__PURE__ */ React.createElement("span", null, "noise σ, D (", st.work(f).sig.from, ")"), /* @__PURE__ */ React.createElement("b", null, st.work(f).sig.work.map((v) => v.toFixed(4)).join(" · "))), /* @__PURE__ */ React.createElement("div", { className: "h" }, /* @__PURE__ */ React.createElement("b", null, "Flat field")), /* @__PURE__ */ React.createElement("div", { className: "about" }, "A capture of the light with no film in the holder", trip ? ", one per LED" : "", ", with the same lens, aperture, focus and exposure as the scans. The scan is divided by it, so the rebate reads the same across the frame and the shadows are not pushed below base. Smooth keeps the illumination and lens fall-off; Fine also keeps small marks on the light."), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("button", { className: "btn sm", onClick: () => flatIn.current.click() }, fi ? "Replace…" : `Open flat field${trip ? " (3 files)" : ""}…`), fi && /* @__PURE__ */ React.createElement("button", { className: "btn sm", disabled: !fi.used || st.frames.length < 2, onClick: () => st.flatToAll() }, "Use for all frames"), fi && /* @__PURE__ */ React.createElement("button", { className: "btn sm", onClick: () => set({ flat: null }) }, "Remove")), fi && /* @__PURE__ */ React.createElement(React.Fragment, null, sel("Detail", fi.detail, [["smooth", "Smooth (illumination)"], ["fine", "Fine (also small marks)"]], (v) => set({ flat: Object.assign({}, s.flat, { detail: v }) })), /* @__PURE__ */ React.createElement("div", { className: "skv" }, /* @__PURE__ */ React.createElement("span", null, "flat"), /* @__PURE__ */ React.createElement("b", null, fi.name, fi.size ? ` · ${fi.size[0]} × ${fi.size[1]}` : "")), fi.used ? /* @__PURE__ */ React.createElement("div", { className: "skv" }, /* @__PURE__ */ React.createElement("span", null, "fall-off across the light, D"), /* @__PURE__ */ React.createElement("b", null, fi.falloff.map((v) => v.toFixed(3)).join(" · "))) : /* @__PURE__ */ React.createElement("div", { className: "small", style: { color: "var(--accent)" } }, fi.loaded ? "The flat field does not match this scan’s shape." : "Not loaded in this session: open it again.")), /* @__PURE__ */ React.createElement("input", { ref: flatIn, type: "file", multiple: true, hidden: true, accept: ".tif,.tiff,.dng,.png,.jpg,.jpeg", onChange: (e) => {
      st.openFlat(e.target.files);
      e.target.value = "";
    } }));
  }

  // src/ui/app.jsx
  var { useEffect: useEffect3, useState: useState3, useRef: useRef4, useSyncExternalStore } = React;
  var useStudio = (st) => useSyncExternalStore((cb) => st.subscribe(cb), () => st.ver);
  function Bar({ st, onExport }) {
    const f = st.frame, open = useRef4(null), trip = useRef4(null), rec = useRef4(null), S = st.status;
    const S2 = f && f.stats && f.stats.blank != null ? f.stats : null, pct2 = (v) => (v * 100).toFixed(v < 0.1 ? 1 : 0) + " %";
    const toMap = () => {
      st.view = "unreachable";
      st.mode = "develop";
      st.notify();
      st.queue();
    };
    return /* @__PURE__ */ React.createElement("div", { className: "st-bar" }, /* @__PURE__ */ React.createElement("div", { className: "brand" }, "Chromogen Studio"), /* @__PURE__ */ React.createElement("div", { className: "frame-t" }, /* @__PURE__ */ React.createElement("small", null, "Frame"), /* @__PURE__ */ React.createElement("b", { title: f ? f.name : "" }, f ? f.name : "none")), /* @__PURE__ */ React.createElement("div", { className: "seg" }, [["develop", "Develop"], ["ring", "Ring-around"], ["source", "Source"]].map(([k, l]) => /* @__PURE__ */ React.createElement("button", { key: k, className: st.mode === k ? "on" : "", disabled: !f, onClick: () => st.setMode(k) }, l))), /* @__PURE__ */ React.createElement("div", { className: "seg" }, [["print", "Print"], ["negative", "Negative"], ["dyes", "Dyes"], ["unreachable", "Base & gamut"]].map(([k, l]) => /* @__PURE__ */ React.createElement("button", { key: k, className: st.view === k ? "on" : "", disabled: !f || st.mode !== "develop", onClick: () => {
      st.view = k;
      st.notify();
      st.queue();
    } }, l))), /* @__PURE__ */ React.createElement("button", { className: "tog" + (st.split ? " on" : ""), disabled: !f, title: "Compare with a snapshot (or the defaults): \\\\", onClick: () => {
      st.split = st.split ? null : Object.keys(f.snaps)[0] || "__defaults";
      st.notify();
      st.queue();
    } }, "Before / after"), /* @__PURE__ */ React.createElement("button", { className: "tog" + (st.pick === "grey" ? " on" : ""), disabled: !f, title: "Click a neutral to set Warmth and Tint: G", onClick: () => {
      st.pick = st.pick ? null : "grey";
      st.mode = "develop";
      st.notify();
    } }, "Grey pick"), /* @__PURE__ */ React.createElement("span", { className: "sp" }), S.progress != null && /* @__PURE__ */ React.createElement("span", { className: "pill" }, /* @__PURE__ */ React.createElement("span", null, S.msg || "Working"), /* @__PURE__ */ React.createElement("span", { className: "bar-p" }, /* @__PURE__ */ React.createElement("i", { style: { width: `${Math.round(S.progress * 100)}%` } }))), S.progress == null && S.msg && /* @__PURE__ */ React.createElement("span", { className: "pill" }, /* @__PURE__ */ React.createElement("span", null, S.msg)), S2 && S2.gamut > 5e-3 && /* @__PURE__ */ React.createElement("button", { className: "pill err", onClick: toMap, title: "Out of gamut: every layer has formed dye, yet no dye amounts reproduce the densities (§9.7). Check the scanner profile and the film." }, /* @__PURE__ */ React.createElement("i", { className: "sw gamut" }), /* @__PURE__ */ React.createElement("span", null, "out of gamut ", pct2(S2.gamut))), S2 && S2.below > 5e-3 && /* @__PURE__ */ React.createElement("button", { className: "pill", onClick: toMap, title: "Below base: a layer reads lighter than the rebate by more than the noise explains. Uneven light across the scan (no flat field) or a rebate that is not representative." }, /* @__PURE__ */ React.createElement("i", { className: "sw below" }), /* @__PURE__ */ React.createElement("span", null, "below base ", pct2(S2.below))), /* @__PURE__ */ React.createElement("button", { className: "btn", onClick: () => open.current.click() }, "Open…"), /* @__PURE__ */ React.createElement("button", { className: "btn", onClick: () => trip.current.click(), title: "Three exposures of one frame, one per LED (sorted by name: R, G, B)" }, "Triplet…"), /* @__PURE__ */ React.createElement("button", { className: "btn", disabled: !f, onClick: () => rec.current.click(), title: "Apply a recipe (.json) to this frame" }, "Recipe…"), /* @__PURE__ */ React.createElement("button", { className: "btn primary", disabled: !f, onClick: onExport }, "Export…"), /* @__PURE__ */ React.createElement("input", { ref: open, type: "file", multiple: true, hidden: true, accept: ".tif,.tiff,.dng,.png,.jpg,.jpeg,.webp,.json", onChange: (e) => {
      st.openFiles(e.target.files);
      e.target.value = "";
    } }), /* @__PURE__ */ React.createElement("input", { ref: trip, type: "file", multiple: true, hidden: true, accept: ".tif,.tiff,.dng,.png,.jpg,.jpeg", onChange: (e) => {
      st.openFiles(e.target.files, { triplet: true });
      e.target.value = "";
    } }), /* @__PURE__ */ React.createElement("input", { ref: rec, type: "file", hidden: true, accept: ".json", onChange: async (e) => {
      const fl = e.target.files[0];
      e.target.value = "";
      if (fl) {
        try {
          await st.loadRecipe(JSON.parse(await fl.text()));
        } catch (err) {
          st.setStatus({ error: err.message });
        }
      }
    } }));
  }
  function Strip({ st }) {
    return /* @__PURE__ */ React.createElement("div", { className: "st-strip" }, st.frames.map((f, i) => /* @__PURE__ */ React.createElement("div", { key: f.id, className: "thumb" + (i === st.cur ? " on" : ""), onClick: () => st.select(i) }, /* @__PURE__ */ React.createElement("div", { className: "im" }, f.thumb ? /* @__PURE__ */ React.createElement("img", { src: f.thumb, alt: "" }) : /* @__PURE__ */ React.createElement("span", { className: "small mut" }, "not rendered"), f.stats && f.stats.gamut > 0.02 ? /* @__PURE__ */ React.createElement("span", { className: "badge", title: "out of gamut" }, Math.round(f.stats.gamut * 100), " %") : f.stats && f.stats.below > 0.02 ? /* @__PURE__ */ React.createElement("span", { className: "badge below", title: "below base: uneven light or rebate" }, Math.round(f.stats.below * 100), " %") : null, /* @__PURE__ */ React.createElement("span", { className: "x", onClick: (e) => {
      e.stopPropagation();
      st.removeFrame(i);
    } }, "×")), /* @__PURE__ */ React.createElement("small", null, String(i + 1).padStart(2, "0"), " · ", f.name))), !st.frames.some((f) => f.sample) && /* @__PURE__ */ React.createElement("div", { className: "thumb add", onClick: () => st.addSample() }, /* @__PURE__ */ React.createElement("div", { className: "im" }, "Load the real", /* @__PURE__ */ React.createElement("br", null), "Gold 200 scan"), /* @__PURE__ */ React.createElement("small", null, "sample, Appendix E")));
  }
  function ExportModal({ st, onClose }) {
    const f = st.frame, w = f ? st.work(f) : null, [fmt, setFmt] = useState3("png16"), [size, setSize] = useState3("full"), [p3, setP3] = useState3(false), [rec, setRec] = useState3(true);
    if (!f) return null;
    const go = async () => {
      onClose();
      await st.exportFrame({ format: fmt, size, p3: p3 && (fmt === "png8" || fmt === "jpeg"), recipe: rec });
    };
    return /* @__PURE__ */ React.createElement("div", { className: "modal-back", onClick: onClose }, /* @__PURE__ */ React.createElement("div", { className: "modal", onClick: (e) => e.stopPropagation() }, /* @__PURE__ */ React.createElement("h3", null, "Export ", f.name), /* @__PURE__ */ React.createElement("div", { className: "row" }, /* @__PURE__ */ React.createElement("span", null, "Format"), /* @__PURE__ */ React.createElement("div", { className: "seg" }, [["png16", "PNG 16"], ["png8", "PNG 8"], ["jpeg", "JPEG"], ["tiff16", "TIFF 16"]].map(([k, l]) => /* @__PURE__ */ React.createElement("button", { key: k, className: fmt === k ? "on" : "", onClick: () => setFmt(k) }, l)))), /* @__PURE__ */ React.createElement("div", { className: "row" }, /* @__PURE__ */ React.createElement("span", null, "Size"), /* @__PURE__ */ React.createElement("div", { className: "seg" }, /* @__PURE__ */ React.createElement("button", { className: size === "full" ? "on" : "", onClick: () => setSize("full") }, "Full ", w.fullW, " × ", w.fullH), /* @__PURE__ */ React.createElement("button", { className: size === "work" ? "on" : "", onClick: () => setSize("work") }, "Screen ", w.w, " × ", w.h))), /* @__PURE__ */ React.createElement("div", { className: "row" }, /* @__PURE__ */ React.createElement("span", null, "Colour"), /* @__PURE__ */ React.createElement("div", { className: "seg" }, /* @__PURE__ */ React.createElement("button", { className: !p3 ? "on" : "", onClick: () => setP3(false) }, "sRGB"), /* @__PURE__ */ React.createElement("button", { className: p3 ? "on" : "", disabled: !(fmt === "png8" || fmt === "jpeg"), onClick: () => setP3(true) }, "Display P3"))), /* @__PURE__ */ React.createElement("div", { className: "row" }, /* @__PURE__ */ React.createElement("span", null, "Recipe"), /* @__PURE__ */ React.createElement("div", { className: "seg" }, /* @__PURE__ */ React.createElement("button", { className: rec ? "on" : "", onClick: () => setRec(true) }, fmt === "tiff16" ? "In the zip" : "Second file"), /* @__PURE__ */ React.createElement("button", { className: !rec ? "on" : "", onClick: () => setRec(false) }, "None"))), /* @__PURE__ */ React.createElement("div", { className: "small mut" }, "The recipe (.json) holds every control and source setting; open it later with Recipe… to reproduce the print. TIFF arrives inside a .zip. Display P3 is for 8-bit PNG and JPEG. Full size renders in tiles at the scan's resolution. On a hosted page you confirm each file as it is saved."), /* @__PURE__ */ React.createElement("div", { className: "foot" }, /* @__PURE__ */ React.createElement("button", { className: "btn", onClick: () => {
      onClose();
      st.saveRecipe();
    } }, "Recipe only"), /* @__PURE__ */ React.createElement("span", { style: { flex: 1 } }), /* @__PURE__ */ React.createElement("button", { className: "btn", onClick: onClose }, "Cancel"), /* @__PURE__ */ React.createElement("button", { className: "btn primary", onClick: go }, "Export"))));
  }
  function App({ st }) {
    useStudio(st);
    const [exp, setExp] = useState3(false);
    useEffect3(() => {
      const key = (e) => {
        if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== "range") return;
        const k = e.key.toLowerCase();
        if ((e.ctrlKey || e.metaKey) && k === "z") {
          e.preventDefault();
          e.shiftKey ? st.redo() : st.undo();
          return;
        }
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (k === "\\") {
          st.split = st.split ? null : st.frame && Object.keys(st.frame.snaps)[0] || "__defaults";
          st.notify();
          st.queue();
        } else if (k === "g") {
          st.pick = st.pick ? null : "grey";
          st.notify();
        } else if (k === "r") st.setMode(st.mode === "ring" ? "develop" : "ring");
        else if (k === "s") st.snapshot();
        else if (k === "b") {
          st.left = st.left === "book" ? "develop" : "book";
          st.notify();
        } else if (k === "escape") {
          st.pick = null;
          st.notify();
        }
      };
      window.addEventListener("keydown", key);
      return () => window.removeEventListener("keydown", key);
    }, []);
    useEffect3(() => {
      st.queue();
    }, [st.left]);
    const S = st.status;
    return /* @__PURE__ */ React.createElement("div", { id: "studio", className: st.left === "book" ? "withbook" : "" }, /* @__PURE__ */ React.createElement(Bar, { st, onExport: () => setExp(true) }), /* @__PURE__ */ React.createElement("div", { className: "st-left" }, /* @__PURE__ */ React.createElement(Left, { st })), /* @__PURE__ */ React.createElement("div", { className: "st-mid" }, st.mode === "ring" && st.frame ? /* @__PURE__ */ React.createElement(RingView, { st }) : st.mode === "source" && st.frame ? /* @__PURE__ */ React.createElement(SourceView, { st }) : null, /* @__PURE__ */ React.createElement("div", { style: { display: st.mode === "develop" || !st.frame ? "contents" : "none" } }, /* @__PURE__ */ React.createElement(CanvasView, { st })), S.error && /* @__PURE__ */ React.createElement("div", { className: "err-line" }, /* @__PURE__ */ React.createElement("span", null, S.error), /* @__PURE__ */ React.createElement("span", { className: "sp" }), /* @__PURE__ */ React.createElement("button", { className: "lnk", onClick: () => st.setStatus({ error: null }) }, "dismiss"))), /* @__PURE__ */ React.createElement("div", { className: "st-right" }, st.mode === "source" ? /* @__PURE__ */ React.createElement(SourcePanel, { st }) : /* @__PURE__ */ React.createElement(Panel, { st })), /* @__PURE__ */ React.createElement(Strip, { st }), exp && /* @__PURE__ */ React.createElement(ExportModal, { st, onClose: () => setExp(false) }));
  }

  // src/main.jsx
  loadData(window.ST_DATA.cg);
  var studio = new Studio();
  window.studio = studio;
  window.__spec = spec_exports;
  window.__flats = FLATS;
  downloads();
  studio.accel.detect();
  var root = ReactDOM.createRoot(document.getElementById("root"));
  root.render(React.createElement(App, { st: studio }));
  studio.chapter = (window.ST_DATA.book[0] || {}).id;
  setTimeout(() => {
    if (!studio.frames.length) studio.addSample();
  }, 50);
})();

