/**
 * ISC-WF-1 end-to-end specs — synthetic .isc fixtures through the full
 * transliterate path (parser → converter/expansion → ISC loader strategy
 * → runtime executor), with and without language selection.
 *
 * Fixtures: test/fixtures/wf1/*.isc — a ruleset library, a dependent map
 * using it across a dependency (with override), a same-map recursive
 * composition, and a language-conditioned map.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { readFileSync, readdirSync } from "fs"
import { join } from "path"
import { parseIsc } from "../../src/isc/parser.ts"
import { iscBundledStrategy } from "../../src/isc/loader.ts"
import { configure, reset, transliterate } from "../../src/index.js"

const FIXTURES_DIR = join(__dirname, "..", "fixtures", "wf1")

function loadFixtureSources(): Record<string, string> {
  const sources: Record<string, string> = {}
  for (const f of readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".isc"))) {
    const src = readFileSync(join(FIXTURES_DIR, f), "utf8")
    const code = parseIsc(src, f).systemCode
    sources[code] = src
  }
  return sources
}

const sources = loadFixtureSources()

beforeAll(() => {
  reset()
  configure({ strategies: [iscBundledStrategy(sources)] })
})

describe("WF-1 fixtures — full transliterate path", () => {
  it("every fixture's embedded tests pass (no language selected)", () => {
    for (const [code, src] of Object.entries(sources)) {
      const doc = parseIsc(src, code)
      for (const t of doc.tests) {
        expect(transliterate(code, t.input)).toBe(t.expected)
      }
    }
  })

  it("W1+W2: ruleset use across a dependency with override", () => {
    const code = "wf1-dep:tha-Thai:Latn:2026"
    // kept row (ิ→i) + override row (ะ→o) + parallel ท→th + trailing use ก→k
    expect(transliterate(code, "ะทก")).toBe("othk")
    // the override replaced ะ→a — the imported generic row is gone
    expect(transliterate(code, "ะ")).toBe("o")
    expect(transliterate(code, "ิ")).toBe("i")
  })

  it("W1: recursive same-map expansion with a nested parallel pass", () => {
    expect(transliterate("wf1-same:rus-Cyrl:Latn:2026", "абвгде")).toBe("abvgde")
  })

  it("W3: language-conditioned rows (§5.4)", () => {
    const code = "wf1-langs:rus-Cyrl:Latn:2026"
    // no selection → guards inert, generic rows
    expect(transliterate(code, "қҫж")).toBe("ķşж")
    // kur → guard-applicable қ wins; chv guard + generic-only ж inert
    expect(transliterate(code, "қҫж", undefined, "kur")).toBe("k̦şž")
    // chv → guard-applicable ҫ wins; kur guards inert
    expect(transliterate(code, "қҫж", undefined, "chv")).toBe("ķșж")
    // undeclared selection → guards inert, generic rows
    expect(transliterate(code, "қҫж", undefined, "xyz")).toBe("ķşж")
  })

  it("language selection composes with dependency expansion (override rows carry when)", () => {
    const code = "wf1-dep:tha-Thai:Latn:2026"
    // sanity: language selection on a guard-free map changes nothing
    expect(transliterate(code, "ะทก", undefined, "kur")).toBe("othk")
  })
})
