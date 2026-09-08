# [COMPLETE 2026-09-08 (PR #68 merged)] 10 — README quickstart wiring (P3)

## Goal
The new surfaces discoverable: interscript-ts README links the
example gallery and the CDN recipe.

## Why
`examples/` and `docs/CDN.md` exist but nothing in the README points
at them; a script-first visitor (the audience this lane serves) lands
on the README first.

## Spec

README gains a short "Try it" section: the CDN one-liner from
docs/CDN.md, a pointer to `examples/` ("runnable, CI-verified"), and
the ambient-types note for editors. No other edits.

## Acceptance
- The section's code block matches the CDN.md recipe verbatim (DRY by
  reference, not duplication — keep the snippet minimal and say "see
  docs/CDN.md").
