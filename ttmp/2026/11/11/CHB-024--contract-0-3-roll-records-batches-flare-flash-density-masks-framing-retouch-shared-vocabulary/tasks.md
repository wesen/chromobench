# Tasks

## TODO
- [ ] [stage 1] Collect every open request (packages/*/CONTRACT-REQUESTS.md, apps/studio, CHB-016/019/020/022 guide proposals, CHB-001 diary Step 8 list) into one table in CONTRACT-DECISIONS.md 'Contract 0.3' with applied/adapted/deferred and a reason <!-- t:y2ou -->
- [ ] [stage 1] Roll and batches: FrameRecipe.roll + Roll record, LoggedMutation.batch, EditLog.preview with several mutations (studio-kit R1, R3–R7); scan.baseT <!-- t:07wt -->
- [ ] [stage 2] scan.flare as number | Vec3, implemented in core and gpu (today only the mock has it; real engines fail E_NOT_IMPLEMENTED) <!-- t:xuf7 -->
- [ ] [stage 2] Flash: print.combine modes flash-base/flash-open and compile() using them (core C6); density masks reachable from recipes (C5); document normalised-mode weighting and mask arguments (C7, C8); darkroom.lightsToFiltration with print settings (C1); grade/magnification docs (C2, C3) <!-- t:5360 -->
- [ ] [stage 2] Framing and retouch (CHB-022 proposals): view.frame {orientation, angle_deg, crop} for every frame kind; retouch.spots.<id> with null-delete in checkSet <!-- t:x651 -->
- [ ] [stage 2] Output: CAM16-UCS knee (output R1, with recipe migration), output.encode result fields (R2), notes R3; Diagnostic.where with a file (CHB-016) <!-- t:7j2b -->
- [ ] [stage 3] Shared frame vocabulary module (ACCESSORS, PRINT_OPTIONS, cut) used by packages/dsl and packages/studio-kit (studio-kit R2); remove studio-kit's copy <!-- t:lan4 -->
- [ ] [stage 3] Bump CONTRACT_VERSION to 0.3.0, regenerate docs and DSL d.ts, baseline for contract:check, migrations for old recipes; all engines pass conformance <!-- t:t9li -->
