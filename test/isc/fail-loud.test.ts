/**
 * WO18 G3/G4 — fail-loud fixes from the merged four-runtime parity
 * audit (maps docs/parity/README.md).
 *
 * G3: an alias that resolves to nothing compiled to the EMPTY matcher
 *     (`{ re: "", literal: "" }`), which matches everywhere — the `to`
 *     text was silently inserted at every string boundary
 *     ("a" -> "XaX", "zzz" -> "XzXzXzX"). Canon (ruby/rs): a named
 *     error; an empty matcher is never legitimate alias semantics.
 *
 * G4: requesting a stage the map doesn't have was a silent no-op
 *     returning the input, hiding map typos ("--stage mahn" silently
 *     "works"). Canon (rs, ruby post-fix): named MapLogicError for both
 *     the requested main stage and a run's target stage.
 *
 * API-visible change (G4): callers who relied on the missing-stage
 * no-op now get MapLogicError.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { parseIsc } from "../../src/isc/parser.ts"
import { iscBundledStrategy } from "../../src/isc/loader.ts"
import { configure, reset, transliterate, transliterateAsync } from "../../src/index.js"
import { MapLogicError } from "../../src/errors.js"

const UNKNOWN_ALIAS_MAP = `# G3: alias declared nowhere (nor in any dependency).
system "T:tst-unknown-alias:1" {
  stage main {
    parallel { sub unknown_alias "X" }
  }
}`

const STAGE_MAP = `# G4: only stage "main" exists.
system "T:tst-stage-missing:1" {
  stage main {
    sub "a" "b"
  }
}`

function loadMap(src: string): string {
  const code = parseIsc(src, "probe").systemCode
  configure({ strategies: [iscBundledStrategy({ [code]: src })] })
  return code
}

describe("WO18 G3 — unresolved alias fails loud", () => {
  beforeEach(() => reset())

  it("sub unknown_alias raises MapLogicError (not silent boundary insertion)", () => {
    const code = loadMap(UNKNOWN_ALIAS_MAP)
    expect(() => transliterate(code, "a")).toThrow(MapLogicError)
    expect(() => transliterate(code, "a")).toThrow(/Alias unknown_alias not found/)
  })
})

describe("WO18 G4 — missing stage fails loud", () => {
  beforeEach(() => reset())

  it("requesting an absent stage raises MapLogicError (was: silent no-op)", () => {
    const code = loadMap(STAGE_MAP)
    expect(() => transliterate(code, "a", "nope")).toThrow(MapLogicError)
    expect(() => transliterate(code, "a", "nope")).toThrow(/stage "nope" not found/)
  })

  it("the async path raises the same error", async () => {
    const code = loadMap(STAGE_MAP)
    await expect(transliterateAsync(code, "a", "nope")).rejects.toThrow(MapLogicError)
    await expect(transliterateAsync(code, "a", "nope")).rejects.toThrow(/stage "nope" not found/)
  })

  it("the present stage still executes", () => {
    const code = loadMap(STAGE_MAP)
    expect(transliterate(code, "a")).toBe("b")
  })
})
