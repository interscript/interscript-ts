# [COMPLETE 2026-09-07] 03 — Worker-mode guarantee (P2)

## Goal
Proof, in a real browser, that the package runs inside a Web Worker —
the architecture the playground will use to keep every conversion off
the main thread (kotoshu runs its engine exclusively in a worker).

## Why
The 5.2.1 browser-safety fix guarded window/document access via
optional globalThis chains — verified in page context, never in worker
context. A worker also changes asset-loading conditions (no DOM, but
Cache API and fetch exist). One test pins all of it.

## Spec

`e2e/worker-engine.spec.ts` in the site repo (it owns Playwright +
the browser runtime peers):

- the page spawns `new Worker(blob-url)`;
- the worker imports the package via the CDN recipe from item 02;
- the worker transliterates a fixed string and `postMessage`s the
  result;
- the test asserts the expected output on the page side.

This simultaneously re-proves item 02's recipe per CI run.

## Acceptance
- Spec green in site CI.
- No change to the library itself (if the worker path fails, the fix
  lands in the library with its own test — the spec is the tripwire).
