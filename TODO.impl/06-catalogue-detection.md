# 06 — Catalogue-driven detection (P1)

## Goal
Detection that can rank a supplied candidate catalogue instead of only
the already-loaded maps, including an async form that loads ISC
candidates on demand.

## Why
`DetectOptions` exposes only `mapPattern`; `detectInMaps`'s
`knownMaps` parameter is unreachable from the public API. Ranking a
289-system catalogue today requires preloading every map first. The
detector is the right place for the candidate-set semantics (it
already takes the iterable internally) — the public API just never
let callers reach them.

## Spec

1. `DetectOptions.systems?: readonly SystemCode[]` — constrains the
   candidate set (sync `detect()` ranks the intersection with
   loadable/loaded maps, unchanged ordering).
2. `detectAsync(input, output, opts?: DetectOptions): Promise<DetectionResult[]>`
   — same ranking, loads each candidate via `loadMapAsync` (skipping
   codes that fail to load, matching the existing detector semantics
   of skipping non-executable candidates).
3. Pure delegation: `runtime().detectAsync` mirrors `detect`;
   `detectInMaps` gains an async twin that awaits loads — no change to
   the sync path's behavior or signature (OCP: additive).

## Acceptance (TDD)
- Failing tests first: `test/detect.test.ts` — systems-constrained
  sync ranking, async ranking over an unloaded ISC-backed fixture
  strategy, skip-on-load-failure, mapPattern still composes.
- Existing detector/ruby-parity behavior untouched (full suite green).
