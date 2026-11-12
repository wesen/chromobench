// Unused exports over the workspace program (tsconfig.json), with the TypeScript checker (CHB-032 z99j; neither
// knip nor ts-prune is a dependency).
// Every import specifier, re-export and `import('…')` type in any file is resolved to the original declaration;
// an export of a source file (packages/*/src, packages/studio-kit/kits/*/src, apps/*/src) that no other file
// imports is reported, split into "used in its own file" (could be un-exported), "used by nothing" (dead), and
// exports imported only by tests/demos. Usage: node tools/scripts/unused-exports.mjs . [--json out.json]
// Directories outside tsconfig.json (packages/gpu/parity-page, packages/studio-kit/variants, *.js playbooks) are not
// in the program: grep a reported name before deleting it.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2]);
const require = createRequire(path.join(root, 'package.json'));
const ts = require('typescript');

const cfgPath = path.join(root, 'tsconfig.json');
const cfg = ts.getParsedCommandLineOfConfigFile(cfgPath, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
const host = ts.createCompilerHost(cfg.options);
const program = ts.createProgram({ rootNames: cfg.fileNames, options: cfg.options, host });
const checker = program.getTypeChecker();
const rel = (f) => path.relative(root, f);
const isSource = (f) => /^(packages\/[^/]+\/src|packages\/studio-kit\/kits\/[^/]+\/src|apps\/[^/]+\/src)\//.test(rel(f)) && !/\.d\.ts$/.test(f);
const isTesty = (f) => /(^|\/)(test|e2e|demo|parity-page)\//.test(rel(f)) || /\.(test|spec)\.ts$/.test(f) || /^tools\//.test(rel(f));

const files = program.getSourceFiles().filter((sf) => !sf.isDeclarationFile && rel(sf.fileName) && !rel(sf.fileName).startsWith('..') && !rel(sf.fileName).includes('node_modules'));

/** original symbol → Set of files that import it (directly or through re-exports) */
const users = new Map();
const wholeModule = new Set(); // modules imported as namespace or dynamically: every export counts as used
const orig = (s) => {
  let x = s;
  for (let i = 0; i < 10 && x && x.flags & ts.SymbolFlags.Alias; i++) {
    try { x = checker.getAliasedSymbol(x); } catch { break; }
  }
  return x;
};
const mark = (sym, file) => {
  if (!sym) return;
  const o = orig(sym);
  if (!users.has(o)) users.set(o, new Set());
  users.get(o).add(file);
};
const moduleOf = (spec, from) => {
  const r = ts.resolveModuleName(spec, from, cfg.options, host).resolvedModule;
  return r ? path.resolve(r.resolvedFileName) : null;
};

for (const sf of files) {
  const file = sf.fileName;
  const visit = (n) => {
    if (ts.isImportDeclaration(n) && n.importClause) {
      const c = n.importClause;
      if (c.name) mark(checker.getSymbolAtLocation(c.name), file);
      if (c.namedBindings) {
        if (ts.isNamespaceImport(c.namedBindings)) {
          const m = moduleOf(n.moduleSpecifier.text, file);
          if (m) wholeModule.add(m);
        } else for (const e of c.namedBindings.elements) mark(checker.getSymbolAtLocation(e.name), file);
      }
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier) {
      // a re-export is not a use; consumers resolve through it to the original
      if (!n.exportClause) {
        /* export * */
      } else if (ts.isNamespaceExport(n.exportClause)) {
        const m = moduleOf(n.moduleSpecifier.text, file);
        if (m) wholeModule.add(m);
      }
    } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) {
      const m = moduleOf(n.arguments[0].text, file);
      if (m) wholeModule.add(m);
    } else if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument) && ts.isStringLiteral(n.argument.literal)) {
      const m = moduleOf(n.argument.literal.text, file);
      if (m) wholeModule.add(m);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

const service = ts.createLanguageService({
  getCompilationSettings: () => cfg.options,
  getScriptFileNames: () => cfg.fileNames,
  getScriptVersion: () => '1',
  getScriptSnapshot: (f) => { const t = ts.sys.readFile(f); return t === undefined ? undefined : ts.ScriptSnapshot.fromString(t); },
  getCurrentDirectory: () => root,
  getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
  fileExists: ts.sys.fileExists, readFile: ts.sys.readFile, readDirectory: ts.sys.readDirectory,
}, ts.createDocumentRegistry());

const report = { unexport: [], dead: [], testOnly: [] };
for (const sf of files) {
  if (!isSource(sf.fileName) || wholeModule.has(path.resolve(sf.fileName))) continue;
  const ms = checker.getSymbolAtLocation(sf);
  if (!ms) continue;
  for (const ex of checker.getExportsOfModule(ms)) {
    const o = orig(ex);
    const decl = o.declarations?.[0];
    if (!decl || path.resolve(decl.getSourceFile().fileName) !== path.resolve(sf.fileName)) continue; // re-exports: judged at their origin
    const u = [...(users.get(o) ?? [])].filter((f) => path.resolve(f) !== path.resolve(sf.fileName));
    const line = decl.getSourceFile().getLineAndCharacterOfPosition(decl.getStart()).line + 1;
    const where = `${rel(sf.fileName)}:${line}`;
    if (u.length && u.every(isTesty)) { report.testOnly.push({ name: ex.name, where, by: u.map(rel) }); continue; }
    if (u.length) continue;
    // used in its own file?
    const nameNode = decl.name ?? decl;
    const refs = service.findReferences(sf.fileName, nameNode.getStart()) ?? [];
    const n = refs.flatMap((r) => r.references).filter((r) => !r.isDefinition).length;
    (n ? report.unexport : report.dead).push({ name: ex.name, where, localRefs: n });
  }
}
for (const k of Object.keys(report)) report[k].sort((a, b) => a.where.localeCompare(b.where, 'en', { numeric: true }));
console.log(`exports used by nothing: ${report.dead.length}`);
for (const x of report.dead) console.log(`  DEAD   ${x.where}  ${x.name}`);
console.log(`exports used only in their own file: ${report.unexport.length}`);
for (const x of report.unexport) console.log(`  LOCAL  ${x.where}  ${x.name} (${x.localRefs} refs)`);
console.log(`exports used only by tests, demos or tools: ${report.testOnly.length}`);
for (const x of report.testOnly) console.log(`  TEST   ${x.where}  ${x.name}  ← ${x.by.slice(0, 2).join(', ')}${x.by.length > 2 ? ', …' : ''}`);
const j = process.argv.indexOf('--json');
if (j > 0) writeFileSync(process.argv[j + 1], JSON.stringify(report, null, 1));
