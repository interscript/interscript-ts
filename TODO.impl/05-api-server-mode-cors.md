# [COMPLETE 2026-09-07] 05 — API server-mode CORS (P3)

## Goal
The playground's "no 300 MB download" path — calling
`api.interscript.org` from browser scripts — verified end to end.

## Why
`examples/server-mode.ts` (item 01) documents the fetch path; if the
API does not send `Access-Control-Allow-Origin`, the example is a lie
in the exact context it exists for.

## Spec

- Live probe: OPTIONS preflight + POST `/v1/infer` from an `Origin:
  https://interscript.org` request; assert ACAO present and the infer
  round-trips.
- If broken: fix in the api worker (CORS middleware) via its normal
  release chain (this escalates the item to a release — flag to the
  owner rather than shipping a production change unannounced if the
  fix is anything beyond additive middleware).

## Acceptance
- Probe documented in the example's docblock (or the fix shipped).
- No API behavior change beyond CORS headers if a fix was needed.
