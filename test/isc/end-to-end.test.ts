/**
 * End-to-end parity spec: load all .isc maps via the ISC loader strategy
 * and run their test vectors through the runtime. Skips maps that
 * declare dependencies on libraries that haven't been migrated yet
 * (unicode, posix, var-Cyrl, var-kor).
 *
 * Baseline: 99.9% pass rate on no-deps maps.
 */

import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, existsSync } from "fs"
import { join } from "path"
import { parseIsc } from "../../src/isc/parser.ts"
import { iscBundledStrategy } from "../../src/isc/loader.ts"
import { configure, reset, transliterate } from "../../src/index.js"

const MAPS_DIR = join(__dirname, "..", "..", "..", "maps", "maps")

interface TestCase {
  readonly code: string
  readonly input: string
  readonly expected: string
}

const SKIP_DEPS = new Set(["unicode", "posix", "var-Cyrl", "var-kor"])

function loadCases(): TestCase[] {
  if (!existsSync(MAPS_DIR)) return []
  const files = readdirSync(MAPS_DIR).filter((f) => f.endsWith(".isc"))
  const sources: Record<string, string> = {}
  const cases: TestCase[] = []
  const parsedByCode = new Map<string, ReturnType<typeof parseIsc>>()
  for (const f of files) {
    const code = f.replace(/\.isc$/, "")
    const src = readFileSync(join(MAPS_DIR, f), "utf8")
    sources[code] = src
    parsedByCode.set(code, parseIsc(src, f))
  }
  configure({ strategies: [iscBundledStrategy(sources)] })

  // A map is skippable if it transitively depends on a library that
  // hasn't been migrated to .isc (either a known SKIP_DEPS target, or
  // any dep not present in the loaded sources).
  const skipCache = new Map<string, boolean>()
  const shouldSkip = (code: string, seen: Set<string>): boolean => {
    if (skipCache.has(code)) return skipCache.get(code)!
    if (seen.has(code)) return false
    seen.add(code)
    const doc = parsedByCode.get(code)
    if (!doc) return true
    for (const d of doc.dependencies) {
      if (SKIP_DEPS.has(d.target)) {
        skipCache.set(code, true)
        return true
      }
      if (!parsedByCode.has(d.target)) {
        skipCache.set(code, true)
        return true
      }
      if (shouldSkip(d.target, seen)) {
        skipCache.set(code, true)
        return true
      }
    }
    skipCache.set(code, false)
    return false
  }

  for (const f of files.sort()) {
    const code = f.replace(/\.isc$/, "")
    if (shouldSkip(code, new Set())) continue
    const doc = parsedByCode.get(code)!
    for (const t of doc.tests) {
      if (!t.input) continue
      cases.push({ code, input: t.input, expected: t.expected })
    }
  }
  return cases
}

const cases = loadCases()

describe.skipIf(cases.length === 0)("ISC end-to-end transliteration parity", () => {
  it("test-vector pass rate is at least 99.5%", () => {
    let passed = 0
    let failed = 0
    const sampleFailures: string[] = []
    for (const c of cases) {
      try {
        const actual = transliterate(c.code, c.input)
        if (actual === c.expected) passed++
        else {
          failed++
          if (sampleFailures.length < 5) {
            sampleFailures.push(`${c.code}: "${c.input.slice(0, 20)}" → "${actual.slice(0, 20)}" (expected "${c.expected.slice(0, 20)}")`)
          }
        }
      } catch {
        failed++
      }
    }
    const rate = (passed / cases.length) * 100
    if (rate < 99.5) {
      console.log("Sample failures:\n" + sampleFailures.join("\n"))
    }
    expect(rate).toBeGreaterThanOrEqual(99.5)
  }, 120000)
})
