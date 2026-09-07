# [COMPLETE 2026-09-07] 01 — Examples corpus (P1)

## Goal
A committed set of runnable TS scripts exercising the public API the
way a playground user would. They are the preset gallery (single
source of truth — the client agent renders the `.ts` sources) and a
CI guarantee (they run as tests, so they cannot rot when the API
moves).

## Why
The playground's value is the story its examples tell. Examples that
live only in a UI rot; examples that run in CI are a public-API
regression suite that pays for itself twice.

## Spec

`examples/` directory, each example a self-contained module with one
default-exported behavior and no side effects at import time:

1. `examples/convert.ts` — the hello world: load a map, transliterate
   one string. `interscript` top-level API.
2. `examples/detect-chain.ts` — `detect()` to rank candidate systems,
   then transliterate through the best hit (composition story).
3. `examples/neural-diacritize.ts` — `interscript/ml`: resolve a model
   by id, decode, with `onProgress` wired; runs against the int8 tier
   id but tolerates no-network environments (test asserts the module
   contract, live decode covered by the site e2e instead).
4. `examples/batch-columns.ts` — paste/CSV-shaped batch conversion
   (the cataloger pipeline: normalize a column of names).
5. `examples/server-mode.ts` — the no-download path: `fetch` against
   `https://api.interscript.org/v1/infer`, typed response.

Registry: `examples/index.ts` exports `EXAMPLES: readonly Example[]`
with `Example = { id, title, summary, file }` — `file` is the example
module path; the registry is data, not behavior (open/closed: adding
an example = adding a file + one registry line, no switch anywhere).

CI: `test/examples.test.ts` imports the registry, runs examples 1, 2,
4, 5 for real (network allowed for map fetch — same pattern the
existing suite already uses), and asserts each example's documented
expected output. Example 3 asserts its exported contract only.

## Acceptance
- `npx vitest run test/examples.test.ts` green locally.
- Adding a hypothetical 6th example requires no change outside
  `examples/` + one registry line (the test iterates the registry).
- No example imports anything outside the package's public exports
  (`interscript`, `interscript/ml`).
