# 07 — Actionable sync-miss error (P1)

## Goal
When a sync `load()`/`transliterate()` misses but the configured
strategy stack contains async-capable strategies, the error says what
to do next.

## Why
`MapNotFoundError` fires bare ("Map not found: X") even when
`loadMapAsync`/`transliterateAsync` would succeed — a real trap: this
exact confusion cost a debugging cycle during the examples work (sync
`loadMap` against the ISC strategy). The contract `/Map not found/`
is asserted by tests and matched by callers — the message prefix
stays; the guidance appends.

## Spec

1. `MapNotFoundError` gains an optional `hint` property; when present
   the message reads `Map not found: X (async loaders configured —
   use loadMapAsync/transliterateAsync)`.
2. `MapLoader.load` sets the hint when the sync loop resolved nothing
   AND the stack's strategies returned promises (or: any strategy is
   function-typed returning a thenable — detect via the actual miss,
   no strategy-type registry needed).
3. No behavior change otherwise; async path's MapNotFoundError stays
   hint-free (nothing to suggest there).

## Acceptance (TDD)
- Failing test first: sync load over an async-only strategy rejects
  with `/Map not found/` AND the hint; genuinely-unknown map on a
  sync-only stack keeps the bare message.
