# Tasks

## TODO
- [x] F17 (major): verify first — test strip in seconds under normalised mode; the automatic first print in real mode for photos and negatives <!-- t:x86v -->
- [x] F17: real enlarger mode by default for the darkroom-style layouts (classic, darkroom, lab): first print sets the time; Lighter/Darker change time by 1/3 stop; owner decision 2026-11-12 (recommendation accepted) <!-- t:0xav -->
- [x] F17: normalised mode stays an option (default in simple and tiny); Time, Aperture and magnification hidden while it is on; History never records an inert control <!-- t:5ywv -->
- [x] F18: Open As preference — show it on the frame when it overrides the guess; do not apply it silently when relinking a library frame (use the frame's own kind) <!-- t:odem -->
- [x] F19: Darkroom panel with no frame selected — empty state instead of placeholder text and live sliders <!-- t:9i1n -->
- [x] F20: strip frames orientation (rotate per frame; Frame menu rotate commands), blockiness (working size for crops), frame 1 haze (base/veil per frame?) <!-- t:6wti -->
- [x] F21: 'Where is …?' must not open by itself after Remove (relink only on an explicit selection by the user) <!-- t:jb0i -->
- [x] F22: cold first open ~29 s with only 'opening…' — profile the cold path (WASM, tables, packs); progress display is CHB-029 item 6 <!-- t:9t2y -->
- [x] F23: hide negative-only controls (film stock for scans, scanner, viewing light) for digital photos, or explain them <!-- t:3z8z -->
- [x] Leftovers from session 02: F8 (relative '-5': consider unsigned = absolute only, signed with unit), F9 (engine tooltip, decode note, Dyes / Base & gamut tabs), F12 (Edit menu names the frame); F10 on the CPU engine (sharper preview vs speed) <!-- t:l1ny -->
- [x] Cosplay re-run (session 03) of the session-02 steps plus the darkroom flow (test strip, time, filtration in real mode); before/after table <!-- t:b50a -->
- [x] From WS-A: enforce 'no inert control' in the edit log too — the looks kit's density look, agent proposals and the DSL's time test strip can still set or vary Time on a normalised recipe <!-- t:srvr -->
- [x] From WS-A: darkroom layout with no frame shows the empty-state text twice (Enlarger, Paper) and an empty Exposures panel <!-- t:8iv8 -->
- [x] From WS-B: the decode note still says 'film edge found' for a strip whose base now comes from the gaps between frames (apps/studio/src/status-text.ts / decode notes): say where the base was read <!-- t:ko8e -->
- [x] From WS-B: F10 has no true 1:1 focus check at full resolution on the CPU engine (previews at 640 px, tabulated); decide with the session-03 result whether a refine pass for the visible region is needed <!-- t:qi3r -->
- [x] Round 2 WS-C: F31 photos get an automatic first print (time from density, as-shot colour) <!-- t:nj2u -->
- [x] Round 2 WS-C: F30 colour share (alpha) as one setting; NLP comparison script and numbers for the owner (default unchanged) <!-- t:bey6 -->
- [x] Round 2 WS-C: F28 Epson strip frames upright by default <!-- t:s7hd -->
- [x] Round 2 WS-C: F25 Simple hides the Time row while normalised; distinct 'Printer lights' titles <!-- t:88jx -->
- [x] Round 2 WS-D: F24 layout switch keeps open frames open <!-- t:6o2t -->
- [x] Round 2 WS-D: F26 'Where is …?' closes when its frame is opened another way <!-- t:58p8 -->
- [x] Round 2 WS-D: F32 F35 History and tooltip wording (units, no raw JSON, codes only in Technical lines, typo) <!-- t:oc2f -->
- [x] Round 2 WS-D: F33 History rows do not overlap <!-- t:oyf6 -->
- [x] Round 2 WS-D: F34 View ▸ Actual Pixels (1:1) and a zoom readout <!-- t:bjc2 -->
- [x] Round 2 WS-D: F36 Undo of another frame shows that frame <!-- t:kwlw -->
- [x] Round 2: cosplay check of round 2 (session 04, short: F24–F36 and the photo first print) <!-- t:92iq -->
