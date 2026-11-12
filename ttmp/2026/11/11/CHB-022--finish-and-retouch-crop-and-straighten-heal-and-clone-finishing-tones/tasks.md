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
- [ ] [stage 6] Finishing panel from ArgSpec, honest labelling, finish/* passes (crop-valid, spots-bounds, finishing-label, order) <!-- t:5v8b -->
- [x] [stage 6] finish.toggle before/after of the finishing set (finishing.look held at 0 in a preview) <!-- t:wm0u -->
- [x] [stage 7] Engine retouch.heal: CPU patch pass (harmonic seam correction in log XYZ), cache by node id, pointwise composite <!-- t:lco6 -->
- [ ] [stage 7] Engine output.frame rotation kernel (bilinear draft, Lanczos-3 export) with CHB-005; tiled-vs-one-pass test <!-- t:z8nq -->
- [ ] [stage 8] Local tones: brush, linear, radial tools over CHB-009 maskSpec; finishing.local record <!-- t:7llb -->
- [ ] [stage 9] Agent counterparts: pure geom.* bindings in CHB-007 prelude, frame-handle fragments, agent snippet equals UI flow <!-- t:w2q3 -->
- [ ] [stage 10] Optional, licence-gated: Workbench provider adapter (fill mode, select.subject/sky) <!-- t:5krk -->
- [x] [stage 11] Variants: install finishKit in simple and classic variants, headless build, explain snapshot, Playwright smoke <!-- t:jhh4 -->
