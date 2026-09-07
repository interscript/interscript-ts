# [COMPLETE 2026-09-07] 02 — CDN delivery recipe (P1)

## Goal
The verified, version-pinned way to load `interscript` in a browser
with no bundler — written down with the evidence of what fails and
why, the kotoshu pattern.

## Why
kotoshu's engine worker documents that esm.sh and esm.run transforms
broke their wasm delivery and that raw jsDelivr files + local
instantiation was the only working path. Our package (ESM, fflate +
js-yaml deps, dynamic onnxruntime path for `/ml`) has the same class
of trap. The playground client agent should consume a proven recipe,
not rediscover it.

## Spec

Probe, then document:

1. **Probe (evidence, not assumption)**: in a real browser
   (Playwright, run from the site repo's installed tooling):
   - `import("https://esm.sh/interscript@5.3.0")` — does it load, and
     does a map conversion complete?
   - the raw-jsDelivr alternative if esm.sh fails any step;
   - for `/ml`: whether `interscript/ml` imports without
     onnxruntime-web present, and how ORT + its wasm files resolve
     from CDN when it is imported from esm.sh's ORT pin.
2. **Artifact**: `docs/CDN.md` — the working recipe(s), exact-version
   pin style, the failure modes found with their causes, and the
   ORT/wasm note for the `/ml` path. Follows the kotoshu
   engine-worker comment tradition: the *why* is the deliverable.
3. **Light regression**: `test/cdn-urls.test.ts` — asserts the pinned
   CDN entry URLs respond 200 with a JS content-type (network test,
   same allowance as the examples suite).

## Acceptance
- The probe ran; CDN.md states only what was observed.
- The recipe in CDN.md is the exact one exercised by item 03's worker
  test (no drift between doc and proof).
