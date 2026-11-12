# Tasks

## TODO
- [x] (superseded by CHB-018 and CHB-019; see CHB-028) [stage 1] Freeze the vocabulary (nouns/verbs, binding times, IR kinds, CK-/CB- code families) with the CHB-018 and CHB-019 implementers; update the guide and the UI design brief where they differ <!-- t:2htd -->
- [x] (superseded by CHB-018 and CHB-019; see CHB-028) [stage 2] Write the ck and cb declarations of guide §12 as .d.ts files in reference/, including RecipePath generated from RECIPE_FIELDS; done when tsc passes <!-- t:72iu -->
- [x] (superseded by CHB-018 and CHB-019; see CHB-028) [stage 2] Turn the 14 guide examples into .js files with // @ts-check, checked by tsc --checkJs against the declarations <!-- t:ewaa -->
- [x] (superseded by CHB-018 and CHB-019; see CHB-028) [stage 2] Write the diagnostics table: every CK-/CB- code with family, title, owner and fix template; map contract ERROR_CODES to levels <!-- t:vp7c -->
- [x] (superseded by CHB-018 and CHB-019; see CHB-028) [stage 3] Prototype the EditLog bridge in Node (scripts/): recipes projection, multi-path preview overlay, commit as one unit, UnifiedHistory undo across shell entries and log units, cursor-skew case <!-- t:b6q5 -->
- [x] (superseded by CHB-018 and CHB-019; see CHB-028) [stage 3] Prototype deferred fragment calls and the pass manager (after/before ordering, CK-X120/X121/X130, rewrites keep at) in Node <!-- t:elt7 -->
- [x] (superseded by CHB-018 and CHB-019; see CHB-028) [stage 3] Measure DR-2: patch + compile + intern per change for one frame and a 36-frame roll; record numbers in the diary (target under 2 ms per frame) <!-- t:lemz -->
- [x] (superseded by CHB-018 and CHB-019; see CHB-028) [stage 4] Contract requests to CHB-017: EditLog batch preview (preview(ms[] | null)) and Diagnostic.where.file <!-- t:i1kq -->
- [x] (superseded by CHB-018 and CHB-019; see CHB-028) [stage 4] Requests to CHB-007: extract the vocabulary expansion from packages/dsl/src/host.ts into a shared module; session takes a host propose(batch) hook <!-- t:8g0w -->
- [x] (superseded by CHB-018 and CHB-019; see CHB-028) [stage 4] Review the CHB-018 shell API against the guide; write deviations back into the guide <!-- t:jtui -->
- [x] (superseded by CHB-018 and CHB-019; see CHB-028) [stage 4] Review the CHB-019 studio-kit, host and variants; both example variants build headless with zero errors and stable explain snapshots <!-- t:30l7 -->
- [x] (superseded by CHB-018 and CHB-019; see CHB-028) [stage 5] Write the Help topic 'Writing a variant' from the declarations and examples; offer ck.explain(app) to CHB-008 as a read-only agent tool (DR-4 groundwork) <!-- t:no98 -->
