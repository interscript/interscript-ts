/**
 * WO18 G1 — capture/ref inside parallel blocks.
 *
 * The parity audit (maps docs/parity/README.md G1) found that ts/py
 * join a parallel block into one alternation wrapping each rule in a
 * named group, then handed the template resolver the GLOBAL group list
 * — so `$1` resolved to the wrapper's whole match instead of the
 * rule's first capture (`ax` → `axX` instead of `aX`).
 *
 * Canonical behavior is rs (`tst-capture-par2` pins it):
 * `$N` resolves against the matched rule's own capture list. The maps
 * here are the audit's probe maps (docs/parity/probes/maps), embedded
 * verbatim.
 *
 * A capture in `from` forces the block off the trie path (captures are
 * not literal-expandable) onto the megaregexp path, so these reach the
 * exact code the audit flagged.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { parseIsc } from "../../src/isc/parser.ts"
import { iscBundledStrategy } from "../../src/isc/loader.ts"
import { configure, reset, transliterate } from "../../src/index.js"

const PARALLEL_MAP = `# P10: capture/ref inside a parallel block (block-rule form).
system "T:tst-capture-parallel:1" {
  stage main {
    parallel {
      sub {
        from capture(any("a".."z")) + "x"
        to ref(1) + "X"
      }
      sub "b" "B"
    }
  }
}`

const PAR2_MAP = `# P10c: capture AFTER a plain rule in the same parallel block —
# group-numbering shift in the megaregexp join.
system "T:tst-capture-par2:1" {
  stage main {
    parallel {
      sub "k" "K"
      sub {
        from capture(any("a".."z")) + capture(any("0".."9"))
        to ref(2) + ref(1)
      }
    }
  }
}`

function loadMap(src: string): string {
  const code = parseIsc(src, "probe").systemCode
  configure({ strategies: [iscBundledStrategy({ [code]: src })] })
  return code
}

describe("WO18 G1 — capture/ref inside parallel blocks", () => {
  beforeEach(() => reset())

  it("capture-parallel-match: ax -> aX (not axX)", () => {
    expect(transliterate(loadMap(PARALLEL_MAP), "ax")).toBe("aX")
  })

  it("capture-parallel: axb -> aXB (the plain rule still applies)", () => {
    expect(transliterate(loadMap(PARALLEL_MAP), "axb")).toBe("aXB")
  })

  it("capture-par2-shift: k3a -> 3ka (capture offsets past the earlier rule)", () => {
    expect(transliterate(loadMap(PAR2_MAP), "k3a")).toBe("3ka")
  })
})
