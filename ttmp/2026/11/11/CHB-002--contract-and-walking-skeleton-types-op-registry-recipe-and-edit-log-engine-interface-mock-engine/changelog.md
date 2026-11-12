# Changelog

## 2026-11-11

- Initial workspace created

## 2026-11-11

Contract v0 (CONTRACT_VERSION 0.1.0) implemented on branch task/chb-002-contract. All §11 proposals and the other guides' 'Proposed contract additions' are settled in packages/contract/CONTRACT-DECISIONS.md (accepted / adapted / deferred per item), which also holds the change-note template (CC-NNN, class, changes, consumers, migration, tests). Key v0 changes vs the architecture doc: print.lights.logH path in log H; Engine.adopt(defs); EvalTarget/MeasureSpec.signal; optional Engine.plan; domains scan-classes and scalar-field; finishing.* on print-xyz before output.display; source.xyz absorbs capture.sceneXYZ; KneeSpec {method, strength}.

### Related Files

- /home/manuel/code/wesen/chromobench/packages/contract/CONTRACT-DECISIONS.md — every contract decision and the change-note template
- /home/manuel/code/wesen/chromobench/packages/contract/catalog.snapshot.json — v0 baseline for contract:check

## 2026-11-11

Closed: contract v0, mock engine, conformance and the M1 page done; contract continued in CHB-017 (0.2) and CHB-024 (0.3)
