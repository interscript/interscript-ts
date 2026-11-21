/**
 * maps#294 (WO20 fuzz) — a self-recursive `run stage.<self>` (or a
 * mutual run cycle across stages) recursed until `RangeError: Maximum
 * call stack size exceeded` — a crash-class death embedders cannot
 * meaningfully handle (rs aborted the process outright pre-0.3.3; ruby
 * overflowed its stack the same way).
 *
 * Cross-runtime contract: the run chain is threaded through stage
 * execution (shared across run-target maps) and a revisited RESOLVED
 * target is a named `MapLogicError` carrying the chain, in the
 * directive's own syntax — mirroring the W1 `use cycle:` named errors,
 * rs's shipped 0.3.3 guard, and py's conversion-time guard (which fires
 * earlier still). A NON-cyclic re-run stays legal: the diamond pin
 * below (two callers sharing one downstream run) must keep working.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { parseIsc } from "../../src/isc/parser.ts"
import { iscBundledStrategy } from "../../src/isc/loader.ts"
import { configure, reset, transliterate } from "../../src/index.js"
import { MapLogicError } from "../../src/errors.js"

const SELF_RUN_MAP = `system "T:fz-selfrun:1" {
  stage main {
    parallel {
      sub "a" "b"
    }
    run stage.main
  }
}`

const MUTUAL_RUN_MAP = `system "T:fz-mutrun:1" {
  stage main {
    run stage.a
  }
  stage a {
    sub "x" "y"
    run stage.b
  }
  stage b {
    sub "y" "x"
    run stage.a
  }
}`

const DIAMOND_RUN_MAP = `system "T:fz-diamondrun:1" {
  stage common {
    sub "1" "2"
  }
  stage a {
    sub "a" "A"
    run stage.common
  }
  stage b {
    sub "b" "B"
    run stage.common
  }
  stage main {
    run stage.a
    run stage.b
  }
}`

function loadMap(src: string): string {
  const code = parseIsc(src, "probe").systemCode
  configure({ strategies: [iscBundledStrategy({ [code]: src })] })
  return code
}

describe("maps#294 — run cycles are named errors, never stack overflows", () => {
  beforeEach(() => reset())

  it("a self-recursive run stage.<self> raises MapLogicError (was: RangeError crash)", () => {
    const code = loadMap(SELF_RUN_MAP)
    expect(() => transliterate(code, "aa")).toThrow(MapLogicError)
    expect(() => transliterate(code, "aa")).toThrow(/run cycle/)
  })

  it("a mutual run cycle across stages raises MapLogicError", () => {
    const code = loadMap(MUTUAL_RUN_MAP)
    expect(() => transliterate(code, "x")).toThrow(MapLogicError)
    expect(() => transliterate(code, "x")).toThrow(/run cycle/)
  })

  it("a non-cyclic diamond of shared runs still works", () => {
    const code = loadMap(DIAMOND_RUN_MAP)
    expect(transliterate(code, "ab1")).toBe("AB2")
  })
})
