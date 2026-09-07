# TODO.impl — playground support lane

Audience-facing scripting is the direction: people want to write a TS
script that uses Interscript directly, the way kotoshu's website
playground runs its engine. The playground CLIENT is another agent's
lane. Status: ALL 5 ITEMS COMPLETE (2026-09-07). This register was OUR side: everything the playground runs on,
delivered so their agent never has to rediscover it.

Priorities: P1 = unblocks the client agent immediately; P2 = hardens
the guarantee; P3 = completes the surface. All items are independently
shippable PRs against `main` of interscript-ts (one touches the site
repo, one verifies the API).

| # | Item | Priority | Repo |
|---|------|----------|------|
| 01 | [Examples corpus](01-examples-corpus.md) | P1 | interscript-ts |
| 02 | [CDN delivery recipe](02-cdn-delivery-recipe.md) | P1 | interscript-ts |
| 03 | [Worker-mode guarantee](03-worker-mode-guarantee.md) | P2 | interscript.github.io |
| 04 | [Playground ambient types](04-playground-ambient-types.md) | P2 | interscript-ts |
| 05 | [API server-mode CORS](05-api-server-mode-cors.md) | P3 | verify live; fix in api if broken |

Standing rules (unchanged from the campaign): every claim measured
before it ships; staged sets verified before every commit; no
attribution trailers; PR bodies via `--body-file`; the register closes
only when every item is COMPLETE — new items require the owner.
