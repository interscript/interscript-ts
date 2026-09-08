# [PYTHON COMPLETE 2026-09-08 (PR #5); RUBY SPEC SHIPPED, OPEN PR #769] 09 — Cross-runtime example parity (P2)

## Goal
The example gallery's core conversions expressed as secryst (Ruby)
and secryst-py (Python) specs — same inputs, same expected outputs.

## Why
"Same bytes from every runtime" is the project's core promise; the
gallery currently demonstrates it in TypeScript only. Parity specs
make the claim example-backed and regression-guarded in all three
runtimes. Model-driven: one shared conversion table per repo, specs
iterate it (adding a case = one line).

## Spec

1. `secryst` (Ruby): `spec/secryst/gallery_parity_spec.rb` — loads
   maps through the gem's map path, asserts the gallery cases
   (bgnpcgn-ukr name/column set). Cases as a frozen table constant.
2. `secryst-py`: `tests/test_gallery_parity.py` — same table, same
   assertions.
3. Only conversions the runtime genuinely supports (map layer; the
   neural + server-mode examples stay TS-only — they are
   playground-specific).

## Acceptance
- Python: green — the parity table is the ISC port's gate (PR #5 merged).
- Ruby: spec verified 3/3 locally against the live corpus; on the repo's
  monorepo harness it joins 79 pre-existing corpus-era failures — root
  cause named (reverse_run on nil for .isc documents, interpreter.rb:78);
  PR #769 held open for owner triage.
- Python: blocked on item 11 (the runtime cannot parse the corpus at
  all) — its half of the table lands with the ISC port.
- The conversion table matches `examples/` outputs exactly (Anton
  Olehovych et al.).
