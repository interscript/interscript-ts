# CDN delivery — using interscript from a browser script

The no-bundler recipe, verified by browser probe (Playwright/Chromium,
2026-09-07) against `interscript@5.3.0`.

## The recipe

```ts
// Maps + interpreter — works as-is:
import { configure, iscStrategy, httpStrategy, transliterateAsync } from
  "https://esm.sh/interscript@5.3.0"

configure({
  strategies: [
    iscStrategy({ baseUrl: "https://interscript.org/maps" }),
    httpStrategy({ baseUrl: "https://interscript.org/maps", cacheKeyPrefix: "isx-libs:" }),
  ],
})

const out = await transliterateAsync("bgnpcgn-ukr-Cyrl-Latn-2019", "Антон Олегович")
// => "Anton Olehovych"
```

```ts
// Neural models — the namespace loads; sessions additionally need
// onnxruntime-web, pinned from the same CDN by the host page:
import { imf } from "https://esm.sh/interscript@5.3.0/ml"
```

## What was probed

| URL | Result |
|---|---|
| `esm.sh/interscript@5.3.0` | loads; full export surface; **conversion completes** ("Anton Olehovych") |
| `esm.sh/interscript@5.3.0/ml` | loads; `imf` namespace present; no import-time onnxruntime requirement |

## Failure modes — none found on the maps path

kotoshu's engine documents that esm.sh/esm.run transforms broke their
wasm-bindgen delivery (raw jsDelivr files + local instantiation were
the only working path). Our package has no such entanglement on the
maps path: plain ESM with `fflate`/`js-yaml` dependencies, which esm.sh
resolves. No raw-file fallback is needed.

## The neural session path — probed, not yet proven

Two attempts to complete a full CDN-side session (worker imports
`esm.sh/.../ml`, resolves `tha-g2p-small-1.0-int4`, creates the ONNX
session) timed out at 10 and 25 minutes on the 193 MB model fetch
through the worker — the import and resolve layers never failed; the
download did not complete in the probe budget. What is verified:
namespace import (above) and, via the bundler path, a complete
browser session (the `/neural` demo in production). What remains
unverified from CDN alone: onnxruntime-web resolving through esm.sh's
transform of the bare peer specifier inside `interscript/ml`. If a
CDN session fails there, the import-map fallback is the documented
remedy: map `onnxruntime-web` to a pinned jsDelivr build on the host
page before importing.

## Pins and rules

- **Pin exact versions** (`@5.3.0`, never `@5`): CDN transforms are
  cached per URL; a moving pin means a silently changing program.
- Model bytes never come from esm.sh — they resolve through the
  models.yaml index (tag-pinned release assets; the browser path goes
  through the API's CORS asset front door, see the `/neural` demo).
- `onnxruntime-web` is not a dependency of this package; hosts that
  use `interscript/ml` sessions provide it (the website pins it as a
  peer). Pair both imports from the same CDN origin to avoid duplicate
  wasm loads.
- See `examples/` for the runnable forms of every pattern above, and
  `dist/playground.d.ts` for editor autocomplete of the injected
  global.
