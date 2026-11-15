# Tasks

## TODO
- [x] [stage 1] geometry.ts: rotate, fitsInside, constrain, fitCrop, toSource/toShown over 8 orientations, with round-trip tests <!-- t:uxkx -->
- [x] [stage 1] Worked-example golden test: 3000x2000, 1.3 deg, 4:5 gives a 1568x1960 crop <!-- t:obey -->
- [x] [stage 2] Contract request via CHB-017: view.frame {orientation, angle_deg, crop} for both frame kinds; output.frame args <!-- t:8jbn -->
- [x] [stage 2] Contract request: retouch.spots.* record paths with null delete; retouch.heal and finishing.tone op defs; crop validity check <!-- t:hdxk -->
- [x] [stage 3] Mock engine: rotation, crop and naive clone so the UI can be built before the real engine <!-- t:z3aa -->
- [x] [stage 4] Crop tool: modes (move, 8 handles, rotate), aspect lock, keep-inside constraint, overlay, Esc, one undo step <!-- t:73ln -->
- [x] [stage 4] Crop panel and commands: aspect select, lock, swap, reset, done, orient.* <!-- t:s0bi -->
- [x] [stage 5] Spot tool: dust/heal/clone modes, source pin, suggestSource (ring SSD on proxy), spot commands <!-- t:krzw -->
- [x] [stage 5] Dust mode writes scan.dust.spots; clone/heal write retouch.spots.<id>; spots unaffected by crop and rotation <!-- t:11by -->
- [x] [stage 6] Finishing panel from ArgSpec, honest labelling, finish/* passes (crop-valid, spots-bounds, finishing-label, order) — superseded by CHB-037 P5b-2: Finish is a stack view with controls from ArgSpecs; CB-F110 crop-valid (kits/finish/src/state.ts:127) and CB-F102 (kits/finish/src/passes.ts); spot order is the repair stage law <!-- t:5v8b -->
- [x] [stage 6] finish.toggle before/after of the finishing set (finishing.look held at 0 in a preview) <!-- t:wm0u -->
- [x] [stage 7] Engine retouch.heal: CPU patch pass (harmonic seam correction in log XYZ), cache by node id, pointwise composite <!-- t:lco6 -->
- [ ] [stage 7] Engine output.frame rotation kernel (bilinear draft, Lanczos-3 export) with CHB-005; tiled-vs-one-pass test — now: GPU output.frame exists with a bilinear straighten (gpu/src/frame.ts, CHB-037 P3b) and exact tiled export covers it; remaining: a Lanczos-3 (or better) resampler for export <!-- t:z8nq -->
- [x] [stage 8] Local tones: brush, linear, radial tools over CHB-009 maskSpec; finishing.local record — superseded by CHB-037's masks (contract 1.0 mask library: linear, radial, ellipse, paint components; stack kit mask tools, P2a/P5b-2): a local tone is any layer with a mask <!-- t:7llb -->
- [x] [stage 9] Agent counterparts: pure geom.* bindings in CHB-007 prelude, frame-handle fragments, agent snippet equals UI flow — superseded by CHB-037 P6b: the agent edits document geometry with frame.propose and runs the crop commands with wb.run, the same command the UI runs <!-- t:w2q3 -->
- [ ] [stage 10] Optional, licence-gated: Workbench provider adapter (fill mode, select.subject/sky) <!-- t:5krk -->
- [x] [stage 11] Variants: install finishKit in simple and classic variants, headless build, explain snapshot, Playwright smoke <!-- t:jhh4 -->
