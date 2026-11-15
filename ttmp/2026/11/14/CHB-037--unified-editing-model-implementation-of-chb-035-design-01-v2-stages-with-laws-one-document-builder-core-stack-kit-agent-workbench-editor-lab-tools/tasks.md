# Tasks

## TODO

- [x] P9-8 (blocker, FIXED in P9 d63a220): Roll > New roll failed with E_PATH after View > Layout from Darkroom first — Store.adopt now adds the new layout's own state (Log.withFields) <!-- t:rkcb -->
- [x] P9-4 (major, FIXED in P9 744e78f + d63a220): Darkroom first's film strip had no height, then 2 px thumbnails — side columns lay out collections as flex; vertical strip rows 150 px <!-- t:d0vf -->
- [x] K1 (major, FIXED in P9 c0d8a78): Settings > Copy / Paste / Sync Settings (Mod+Shift+C/V/S) in Classic and Darkroom first <!-- t:c4lc -->
- [x] K2 (minor, FIXED in P9 f1007f5): History named layers by op ids ("Added curve1p3", "Added a hsl"); agent layers showed "burn" <!-- t:6s0m -->
- [ ] P9-9 (major): Frame > Apply Print Settings to Selection copies from the last-clicked frame (the primary) and overwrites a corrected frame silently; show the source and what is copied (or ask), and make the primary visible in the strip — owner: studio-kit (frame commands, strip) <!-- t:crj2 -->
- [ ] P9-1 (major): a mask tool stays armed after a gesture; a later click on the canvas adds a gradient mask to whatever layer is selected — disarm after one mask (or require a drag) — owner: studio-kit stack kit mask tools <!-- t:hqwh -->
- [ ] P9-3 (major, check): film edge detected along the bottom instead of the left on the synthetic negative; the edge stays in print and export, base read there, first print blue — check rebate detection with a left edge (ingest) and whether the synthetic scene misleads it — owner: ingest <!-- t:h0zb -->
- [ ] P9-5 (major): Darkroom first has no crop, straighten or spot removal (and Find a Command does not offer them) — add a Finish palette to the darkroom arrangement — owner: studio-kit layouts (needed before it can be the default) <!-- t:btm4 -->
- [ ] P9-12 (major): no white balance before the film: the Scene stage has exposure etc. but no white-balance layer/control; Darkroom first has no scene stage for camera files — owner: contract catalogue (scene op) + studio-kit layouts; owner decision (design §38 q2) <!-- t:ig9q -->
- [ ] P9-11 (major): E_GPU_OOM after ~6 open frames on SwiftShader (512 MiB budget); the failed frame shows the previous picture under the new name — evict textures of frames not on screen, and show an error state instead of the old picture — owner: gpu engine + studio-kit viewer <!-- t:zkmo -->
- [ ] P9-10 (major): Classic's Output module is a placeholder ("No photos yet" with a photo open, "come with CHB-011", Save PNG only) — owner: CHB-011 / studio-kit <!-- t:936y -->
- [ ] P9-6 (minor): sliders coarse: 60 px of Time = 2 stops, 40 px of Filtration Y = -43 CC — finer drag ranges or fine-drag modifier — owner: studio-kit controls <!-- t:eo25 -->
- [ ] P9-7 (minor): developer text in layer descriptions (dodge formula, HSL OkLCh/finishing.hue, grading formula, "Editor lab", mask "Reads … scan cut", SHA-256 in metadata) — catalogue docs in photographer's words — owner: contract catalogue ui docs <!-- t:6cgv -->
- [ ] P9-13 (minor): layers cannot be multi-selected; Mod+G groups a single layer ("1 entries") — owner: stack kit <!-- t:tkue -->
- [ ] P9-14 (minor): Export offers no JPEG and no output size — owner: CHB-011 output <!-- t:baq3 -->
- [ ] P9-15 (minor): View > Layout dialog lists eight layouts with no explanation; "Darkroom first" label clipped — show descriptions — owner: studio-kit host command <!-- t:vktj -->
- [ ] P9-16 (minor): first prints of a roll's denser frames come out nearly white (12.6 s needed 31.75 s) — check the first-print metering on dense negatives / roll first print — owner: apps/studio first-print <!-- t:n1nz -->
- [ ] P9-2 (note): the first Linear drag right after adding a Dodge did nothing (not reproduced) — watch <!-- t:siez -->
- [ ] P9-17 (note): panel titles look like buttons (click folds the panel); Classic's Layer panel shows a layer selected in another module; Edit/Roll/Finish are both menus and modules — owner: shell/studio-kit design pass <!-- t:3606 -->
- [ ] P9-18 (note): Ring-around "+Y (-B)" names filtration but moves the printer lights — label in printer-light words or move filtration — owner: studio-kit ring-around <!-- t:b91y -->
- [ ] Default arrangement (owner decision): persona session recommends Classic as the default now (opening a file into Print, not Library) and Darkroom first once it has Finish, scene and ring-around/test-strip palettes and P9-1 is fixed <!-- t:qv4l -->
- [ ] Exact export speed: 4000 px darkroom export 1650 ms on Metal (tiles 512 + 64 halo); plan haloed tiles from the DAG's live-texture peak, build fields in one pass — owner: gpu engine (P3b future items) <!-- t:mr9z -->
- [ ] Agent layouts: View > Layout cannot remove a kept assistant layout; File > Import Look for .cblook.js files — owner: apps/studio host <!-- t:1qlj -->
