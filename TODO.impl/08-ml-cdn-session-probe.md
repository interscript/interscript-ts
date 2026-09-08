# 08 — /ml CDN session probe (P2)

## Goal
The last unverified claim in `docs/CDN.md` closed with evidence: a
real ONNX session created from CDN-imported `interscript/ml` +
`onnxruntime-web` pinned from the same origin, decoding a real model
in a worker.

## Why
CDN.md documents that hosts "provide" onnxruntime-web — import of the
namespace was probed, session creation was not. The maps path is
CI-proven; the neural path deserves one live proof, kotoshu-style
(with the failure mode honestly recorded if ORT-from-CDN breaks).

## Spec

1. One-time local probe (Playwright): worker imports
   `esm.sh/interscript@5.3.0/ml` + `esm.sh/onnxruntime-web@<pin>`,
   resolves `tha-g2p-small-1.0-int4` (193 MB, the smallest tier),
   decodes one Thai input, asserts IPA output.
2. Findings land in `docs/CDN.md` — the working ORT pin recipe, or
   the failure mode with its cause. Not a CI test (193 MB); the
   document is the artifact, the probe log the evidence.

## Acceptance
- CDN.md's neural section states only what the probe observed.
