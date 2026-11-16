# Tasks

## TODO

- [x] MASK-3 (CHB-040 t:srjo): mask density, per-component invert (on/off exists), on-picture handles to move/resize/rotate linear, radial, ellipse (and rectangle) components with snapping, brush size/hardness/flow in the tool options; the stack's own amount and mask sliders on the relative drag with Alt fine (CHB-046 leftover) <!-- t:y991 -->
- [x] MASK-2 (CHB-040 t:f4vl, D3): selections as mask components in their own kit: rectangle and ellipse marquee, freehand and polygonal lasso, magic wand (tolerance, contiguous, what it samples), select all/none/invert, grow/contract, feather, selection -> mask on the selected layer; contract, core, GPU, mock, laws, parity, commands, undo, e2e <!-- t:tmd5 -->
- [x] MASK-4 (CHB-039 Step 2): live preview of a mask tool's gesture as a draft before release; measure the frame budget on Metal <!-- t:apue -->
- [x] Checks: typecheck, lint, gen:check, vitest, goldens, SwiftShader browser suite, gpu-parity on Metal under the lock <!-- t:8xzp -->
- [x] Diary, changelog, CHB-040 tasks marked done <!-- t:a5h1 -->

## Left open

- [ ] Handles and mask/selection tools in the cropped or turned display geometry (today: document px = the shown image's px, as before) <!-- t:open1 -->
- [ ] A value dialog for Select ▸ Feather… and Grow…/Contract… (menu: 1 mm and 0.5 mm; the panel and the commands take any value) <!-- t:open2 -->
- [ ] A key for the brush size ([ and ] are the spot tool's) <!-- t:open3 -->
- [ ] The viewer requests the latest draft when a gesture rests (under load a superseded draft can stay until the next move) <!-- t:open4 -->
- [ ] Owner/photographer: Deselect removes the mask (Photoshop) and Draw defaults to Add (not "new selection") — confirm <!-- t:open5 -->
