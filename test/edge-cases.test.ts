/**
 * Edge case tests for the interpreter — empty inputs, very long inputs,
 * unicode boundaries, malformed maps. Catches regressions that unit
 * tests with happy-path data won't surface.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { configure, reset, transliterate } from "../src/index.js"
import { filesystemStrategy } from "../src/loaders.node.js"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { dirname } from "node:path"

const MAPS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures", "maps")

describe("interpreter edge cases", () => {
  beforeAll(() => {
    reset()
    configure({ strategies: [filesystemStrategy(MAPS_DIR)] })
  })

  it("empty input returns empty", () => {
    expect(transliterate("bgnpcgn-ukr-Cyrl-Latn-2019", "")).toBe("")
  })

  it("single ASCII char passes through when no rule matches", () => {
    const out = transliterate("bgnpcgn-ukr-Cyrl-Latn-2019", "A")
    expect(out).toMatch(/A/) // Some maps normalise; allow A in output.
  })

  it("very long input (10000 chars) completes without stack overflow", () => {
    const input = "привет ".repeat(1500)
    const out = transliterate("bgnpcgn-ukr-Cyrl-Latn-2019", input)
    expect(out.length).toBeGreaterThan(0)
    expect(typeof out).toBe("string")
  })

  it("unicode astral plane (emoji) doesn't crash", () => {
    const out = transliterate("bgnpcgn-ukr-Cyrl-Latn-2019", "😀🚀")
    expect(typeof out).toBe("string")
  })

  it("repeated calls produce the same output (deterministic)", () => {
    const a = transliterate("bgnpcgn-ukr-Cyrl-Latn-2019", "Антон")
    const b = transliterate("bgnpcgn-ukr-Cyrl-Latn-2019", "Антон")
    expect(a).toBe(b)
  })

  it("throws MapNotFoundError for unknown system code", () => {
    expect(() => transliterate("does-not-exist", "x")).toThrow(/Map not found/)
  })

  it("handles inputs with whitespace, tabs, newlines", () => {
    const input = "Антон\nМихаил\t\tпривет"
    expect(() => transliterate("bgnpcgn-ukr-Cyrl-Latn-2019", input)).not.toThrow()
  })

  it("handles input that's all non-matching punctuation", () => {
    const out = transliterate("bgnpcgn-ukr-Cyrl-Latn-2019", "!@#$%^&*()")
    expect(typeof out).toBe("string")
  })
})
