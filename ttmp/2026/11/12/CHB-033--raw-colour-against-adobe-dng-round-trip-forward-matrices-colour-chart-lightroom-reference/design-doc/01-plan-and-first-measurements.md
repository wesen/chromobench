---
Title: Plan and first measurements
Ticket: CHB-033
Status: active
Topics:
    - ingest
    - testing
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-12T23:39:34.671924911-05:00
WhatFor: ""
WhenToUse: ""
---

# Plan and first measurements

## Executive Summary

<!-- Provide a high-level overview of the design proposal -->

## Problem Statement

<!-- Describe the problem this design addresses -->

## Proposed Solution

<!-- Describe the proposed solution in detail -->

## Design Decisions

<!-- Document key design decisions and rationale -->

## Alternatives Considered

<!-- List alternative approaches that were considered and why they were rejected -->

## Implementation Plan

<!-- Outline the steps to implement this design -->

## Open Questions

<!-- List any unresolved questions or concerns -->

## References

<!-- Link to related documents, RFCs, or external resources -->

# RAW colour against Adobe

The owner asked how to make sure the RAW import matches Lightroom. chromobench does not render like Lightroom on
purpose (film and paper replace Adobe's look: the Adobe Color profile's look table and tone curve), so the stage that
must match is the **scene colour before the film**: white balance, camera RGB → XYZ, exposure.

## Tools (2026-11-12)

- Adobe DNG Converter 19.0, unpacked without an installer on the owner's Mac (the cask needs sudo):
  `~/chromobench-tools/dngc/DNGConverter.pkg/Payload/Adobe DNG Converter.app/Contents/MacOS/Adobe DNG Converter`;
  `-c -p0 -d <out> <files>`. Converted DSC_8559 (daylight), 8541 (tungsten), 8536 (evening), 8655 (night) from the
  Mac's Dropbox copy; the DNGs are in the git-ignored `.playwright-mcp/dng/` (private).
- `scripts/01-nef-vs-adobe-dng.ts`: decodes the NEF (our path: LibRaw's single Adobe D65 matrix, as-shot neutral
  from cam_mul) and Adobe's DNG (our DNG path: dual-illuminant ColorMatrix1/2 interpolated at the as-shot white),
  both through core's `cameraMatrix` (as-shot, CAT16 to D65), at 256 px, exposure matched on mean Y; ΔE2000 over
  pixels with 0.005 < Y < 0.9. Also Adobe's forward-matrix path (DNG SDK: XYZ(D50) = FM(cct) · diag(1/neutral) ·
  camera RGB), Lab against its own white.

## First measurements

| Photo | Neutral NEF = Adobe? | ΔE2000 NEF vs DNG colour matrices (median / p90 / p99) | ΔE2000 vs Adobe forward matrix (median / p90 / p99) | Exposure NEF/DNG |
|---|---|---|---|---|
| DSC_8559 daylight | identical [0.522, 1, 0.740] | 0.13 / 0.47 / 0.66 | 2.53 / 5.53 / 10.37 | 0.824 |
| DSC_8541 tungsten | identical [0.617, 1, 0.569] | 0.34 / 0.62 / 0.95 | 6.48 / 8.62 / 9.75 | 0.897 |
| DSC_8536 evening | identical | 0.36 / 1.26 / 1.32 | 4.95 / 6.92 / 10.48 | 0.886 |
| DSC_8655 night | identical | 0.51 / 0.70 / 1.23 | 6.87 / 8.31 / 11.45 | 0.874 |

- The white balance now matches Adobe exactly (the CHB-031 fix 50c46a2: as-shot neutral from cam_mul).
- LibRaw's single matrix vs Adobe's dual-illuminant colour matrices: below visibility (median ≤ 0.5).
- Adobe's **forward matrices** give clearly different colour (median 2.5–6.9). Checked: both FMs map white to D50
  (row sums 0.9643 / 1 / 0.8251), CameraCalibration and AnalogBalance are identity, illuminants StdA (17) and D65
  (21), BaselineExposure +0.1 EV. Not yet ruled out: the chromatic-adaptation difference (ours CAT16 to D65, Adobe's
  FM to D50, compared in Lab against each white) — for the daylight frame it should be small, so most of the gap is
  the matrices. Neither our NEF nor our DNG path uses ForwardMatrix today (read in `decode/tiff.ts`, never applied),
  nor BaselineExposure.

## Next

1. Separate adaptation from matrix: compare both in XYZ(D50) with the same CAT (Bradford), per hue region.
2. Ground truth: a ColorChecker shot by the photographer in daylight and tungsten with the D750; patch Lab against
   the chart's reference, our two paths and Adobe's FM path (and Lightroom's Lab readout).
3. If Adobe's FM path is closer to the chart: use forward matrices when a DNG has them, and ship the D750's
   ColorMatrix1/2 + ForwardMatrix1/2 (from one converted DNG) for his NEFs.
4. Lightroom's full rendering (Adobe Color look) as a taste reference only, like the NLP comparison (CHB-026 F30).
5. Turn script 01 into a regression test that skips when the private files are absent.
