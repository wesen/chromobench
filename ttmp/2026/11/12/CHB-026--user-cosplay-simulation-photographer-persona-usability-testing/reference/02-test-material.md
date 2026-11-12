---
Title: Test material — Manfred's Nikon D750 NEFs and a real negative strip
Ticket: CHB-026
Status: active
Topics:
    - ui
    - ingest
    - testing
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Catalogue of the private test photos: where they are, how to get them into the test browser, what each one exercises."
LastUpdated: 2026-11-12T13:35:00-05:00
WhatFor: "Pick files for a scenario."
WhenToUse: "Setting up a session."
---

# Test material

**These are private family photographs.** They stay on this machine: never commit them, never upload them, never
paste pixels or EXIF dumps of them into anything that leaves the machine. Screenshots of the app showing them go
into this ticket's `various/` and `sessions/` folders (the repository has no remote).

## Where they are and how to reach them

| What | Path |
|---|---|
| 33 NEFs, Nikon D750 (digital photos — **not** negatives) | `~/Downloads/2026-11-11 - manfred test bilder/DSC_*.NEF` |
| A real colour negative, 3-frame strip, DNG 1672×3695 16-bit | `~/Downloads/raw010.dng` |
| Embedded-JPEG previews + contact sheet (for choosing, not for testing) | scratchpad of the CHB-026 session (`manfred/prev/`, `manfred/contact.jpg`) |

The Playwright MCP browser can only read files under the repository. Copy what a scenario needs into the
**git-ignored** folder `.playwright-mcp/photos/` first:

```bash
mkdir -p .playwright-mcp/photos
cp "$HOME/Downloads/2026-11-11 - manfred test bilder/"DSC_{8559,8536,8541}.NEF .playwright-mcp/photos/
cp ~/Downloads/raw010.dng .playwright-mcp/photos/
```

Each NEF is about 30 MB; the camera RAW decode (LibRaw in a worker) takes several seconds each.

## The NEFs (all 50 mm, f/2.8–6.3, auto white balance, 2026-11-09 … 11)

| Group | Files | ISO / shutter | What it exercises |
|---|---|---|---|
| Dusk street, landscape | 8515, 8517, 8518, 8520 | 2500–3200, 1/60–1/250 | high ISO noise, falling light |
| Dusk, **portrait** orientation | 8521 (270°) | 3200, 1/60 | EXIF rotation |
| Evening street, slow shutter | 8534 (270°), 8535, 8536, 8537 (270°) | 2000, 1/20–1/30 | shadows, motion, rotation |
| **Tungsten interior, mixed light** | 8538–8543 | 2000, 1/40–1/500 | white balance, colour casts, a bracket-like run of similar frames (batch/sync) |
| Bright morning, portrait | 8552 (270°), 8553 (**90°**), 8554 | 100–400, ≤1/1600 | both rotation directions, highlights |
| **Daylight street** (red/yellow delivery truck) | 8558, 8559, 8562 | 125, 1/2500–1/3200 | the "easy" photo; first contact |
| Daylight, mostly portrait | 8582, 8583–8586 (270°) | 125–160, f/3.2–6.3 | sequence for sync / compare |
| **Night, very high ISO** | 8646, 8647 (270°), **8655 (red fire truck)** | 5000 | noise, saturated reds under street light |
| Night, extreme ISO, portrait | 8687 (90°) | 8000 | the hardest noise case |
| Daylight, late | 8688, 8689, 8690 (270°) | 800, 1/4000 | |

## The negative

`raw010.dng` — a strip of **three frames** on colour negative film (orange mask), vertical, with rebate on the
edges; opened as a negative the app reads a base of about 0.12 / 0.41 / 0.71 D. It exercises inversion, frame
finding on a strip, base and flare reading, and the negative→print path.

## Known traps (from session 01)

- A file's first open **mode** (photo vs negative) is remembered by its content hash in the browser's storage and
  re-used on every later open (finding F3). If you need a clean start for a file, load the app with `?fresh`
  (an in-memory store: nothing is saved) — but note in your diary that a real user cannot do that.
