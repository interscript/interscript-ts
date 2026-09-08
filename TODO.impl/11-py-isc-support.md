# 11 — interscript-py ISC support (P1)

## Goal
The Python map runtime reads the ISC corpus — the only map format the
maps repository still ships — instead of the legacy `.imp` DSL it was
built for.

## Why
Discovered completing item 09: `_find_map` accepts `.imp`/`.isc`, but
the parser is `.imp`-only, and the corpus has **zero** `.imp` files
left. Every map call raises `ValueError: line 1: cannot parse` — the
whole Python runtime has been dark against the current corpus, and its
CI last ran 2026-08-20 so nobody saw it. TypeScript and Ruby both
parse the current ISC (the TS examples convert it live; the Ruby gem
returns identical bytes).

## Spec

Port the reference TypeScript implementation (`interscript-ts
src/isc/`: parser 765 lines, types, converter) to Python:

1. `src/interscript/isc_parser.py` — the ISC grammar: `system
   "id" {` headers, metadata/tests/dependency/stage blocks, sub
   tables, escapes; produces the same plain-tree shape the existing
   engine consumes.
2. Dispatch by extension in the loader: `.isc` → the new parser,
   `.imp` → the legacy parser (both stay — OCP).
3. Tests: port the TS parser's unit fixtures; the gallery parity
   table (item 09) becomes the end-to-end gate — `bgnpcgn-ukr`
   returns the same three strings TS and Ruby return.

## Acceptance
- `INTERSCRIPT_MAPS_PATH=<corpus> pytest` green on the parity table
  plus the existing suite.
- The parity table passes in all three runtimes with identical bytes.
