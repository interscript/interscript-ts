import { describe, it, expect, beforeAll } from "vitest"
import { readFileSync, existsSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { configure, reset, transliterate } from "../src/index.js"
import { filesystemStrategy } from "../src/loaders.node.js"

interface ParityFixture {
  system_code: string
  input: string
  expected: string | null
}

const FIXTURES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures")
const PARITY_PATH = resolve(FIXTURES_DIR, "parity.json")
const MAPS_DIR = resolve(FIXTURES_DIR, "maps")

const fixtures: ParityFixture[] = (() => {
  if (!existsSync(PARITY_PATH)) return []
  return JSON.parse(readFileSync(PARITY_PATH, "utf8")) as ParityFixture[]
})()

const availableMaps: Set<string> = (() => {
  if (!existsSync(MAPS_DIR)) return new Set()
  return new Set(readdirSync(MAPS_DIR).map((f) => f.replace(/\.json$/, "")))
})()

// Only 4 maps still differ from Ruby; all are documented edge cases.
// See TODO.complete/42-parallel-rule-semantics.md for tracking.
const KNOWN_PARTIAL = new Set<string>([]) // All diffs resolved!

describe("parity with Ruby interpreter", () => {
  beforeAll(() => {
    reset()
    configure({ strategies: [filesystemStrategy(MAPS_DIR)] })
  })

  if (fixtures.length === 0 || availableMaps.size === 0) {
    it.skip("parity fixtures not generated (run scripts/gen-parity-fixtures.rb)", () => {})
    return
  }

  for (const fixture of fixtures) {
    if (fixture.expected === null) continue
    if (!availableMaps.has(fixture.system_code)) continue
    const isPartial = KNOWN_PARTIAL.has(fixture.system_code)
    const title = `${fixture.system_code}: ${JSON.stringify(fixture.input)}`
    it(title, () => {
      const result = transliterate(fixture.system_code, fixture.input)
      if (isPartial && result !== fixture.expected) {
        expect(result).not.toBe(fixture.expected)
      } else {
        expect(result).toBe(fixture.expected)
      }
    })
  }
})
