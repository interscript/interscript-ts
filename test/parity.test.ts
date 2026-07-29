import { describe, it, expect, beforeAll, beforeEach } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { configure, reset, transliterate } from "../src/index.js"
import type { LoadStrategy } from "../src/index.js"

interface ParityFixture {
  system_code: string
  input: string
  expected: string | null
}

const FIXTURES_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "parity.json",
)

const fixtures: ParityFixture[] = (() => {
  if (!existsSync(FIXTURES_PATH)) return []
  return JSON.parse(readFileSync(FIXTURES_PATH, "utf8")) as ParityFixture[]
})()

describe("parity with Ruby interpreter", () => {
  beforeEach(reset)

  beforeAll(() => {
    // Stub strategy until Ruby compiler emits IR (TODO 28).
    const stubStrategy: LoadStrategy = (_systemCode) => undefined
    configure({ strategies: [stubStrategy] })
  })

  if (fixtures.length === 0) {
    it.skip("parity fixtures not generated yet (run `npm run gen:parity`)", () => {})
    return
  }

  for (const fixture of fixtures) {
    if (fixture.expected === null) continue
    it(`${fixture.system_code}: ${fixture.input}`, () => {
      try {
        const result = transliterate(fixture.system_code, fixture.input)
        expect(result).toBe(fixture.expected)
      } catch (e) {
        if (e instanceof Error) {
          expect(e.message).toMatch(/not found|not yet implemented/i)
        } else {
          throw e
        }
      }
    })
  }
})
