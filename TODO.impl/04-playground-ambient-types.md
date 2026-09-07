# [COMPLETE 2026-09-07] 04 — Playground ambient types (P2)

## Goal
A shipped `playground.d.ts` so playground users get autocomplete
against the real published types from the first keystroke.

## Why
The playground injects the package as a global (or via a pinned CDN
import); without ambient declarations the editor cannot offer
completion, and the published `.d.ts` alone doesn't declare the
injected binding.

## Spec

- `src/playground.d.ts`: ambient `declare const interscript: typeof
  import("interscript")` (+ the `ml` namespace import where the
  runtime exposes it), written so a playground can reference it via
  triple-slash or config include.
- Emitted with the build (already inside `dist` via `files`).
- Documented in `docs/CDN.md`'s recipe (one line: how to wire it into
  the editor's tsconfig).

## Acceptance
- `dist/playground.d.ts` present in the built output.
- Referencing it makes the injected global type-check (verified by a
  type-level test or tsc smoke in CI).
