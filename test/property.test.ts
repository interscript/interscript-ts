/**
 * Property-based tests for stdlib functions.
 *
 * These verify invariants that should hold for any input, not just
 * specific examples. Provides much stronger guarantees than unit tests.
 */

import { describe, it, expect } from "vitest"
import {
  parallelReplace,
  compileParallelTree,
  parallelReplaceTree,
  regexpEscape,
  downcase,
  upcase,
  titleCase,
  separate,
  compose,
  decompose,
} from "../src/stdlib.js"

// Deterministic PRNG so test runs are reproducible.
function makeRng(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xffffffff
  }
}

function randomString(
  rng: () => number,
  alphabet: string,
  minLen: number,
  maxLen: number,
): string {
  const len = minLen + Math.floor(rng() * (maxLen - minLen + 1))
  let out = ""
  for (let i = 0; i < len; i++) {
    out += alphabet[Math.floor(rng() * alphabet.length)]
  }
  return out
}

describe("parallelReplace — property tests", () => {
  const ALPHABET = "abc"

  it("identity: empty pairs returns input unchanged", () => {
    const rng = makeRng(42)
    for (let i = 0; i < 100; i++) {
      const input = randomString(rng, ALPHABET, 0, 20)
      expect(parallelReplace(input, [])).toBe(input)
    }
  })

  it("idempotent with self-replacement", () => {
    const rng = makeRng(7)
    for (let i = 0; i < 50; i++) {
      const input = randomString(rng, ALPHABET, 0, 20)
      const pairs: [string, string][] = [
        ["a", "a"],
        ["b", "b"],
        ["c", "c"],
      ]
      expect(parallelReplace(input, pairs)).toBe(input)
    }
  })

  it("output length is bounded by max to-length × input length", () => {
    const rng = makeRng(99)
    for (let i = 0; i < 50; i++) {
      const input = randomString(rng, ALPHABET, 1, 20)
      const pairs: [string, string][] = [
        ["a", "AAAA"],
        ["b", "BB"],
        ["c", "C"],
      ]
      const out = parallelReplace(input, pairs)
      const maxOut = input.length * 4
      expect(out.length).toBeLessThanOrEqual(maxOut)
    }
  })

  it("longest-from-first: longer matches beat shorter", () => {
    // 'ab' should win over 'a' even though 'a' comes first.
    const out = parallelReplace("ab", [
      ["a", "X"],
      ["ab", "Y"],
    ])
    expect(out).toBe("Y")
  })

  it("doesn't re-process replacement text", () => {
    // Replace 'a' with 'b'; the new 'b' should NOT be replaced again.
    const out = parallelReplace("a", [
      ["a", "b"],
      ["b", "c"],
    ])
    expect(out).toBe("b")
  })

  it("trie is reusable across calls", () => {
    const tree = compileParallelTree([
      ["a", "X"],
      ["b", "Y"],
    ])
    expect(parallelReplaceTree("ab", tree)).toBe("XY")
    expect(parallelReplaceTree("ba", tree)).toBe("YX")
    expect(parallelReplaceTree("aabb", tree)).toBe("XXYY")
  })

  it("unicode-safe: handles BMP and astral planes", () => {
    expect(
      parallelReplace("ኢትዮጵያ", [
        ["ኢ", "i"],
        ["ት", "t"],
      ])
    ).toBe("itዮጵያ")
    // Astral (emoji) — uses surrogate pairs in JS UTF-16.
    const tree = compileParallelTree([["😀", "X"]])
    expect(parallelReplaceTree("😀", tree)).toBe("X")
  })
})

describe("regexpEscape — property tests", () => {
  const SPECIAL = ".*+?^${}()|[]\\"

  it("escaping + unescaping roundtrips", () => {
    const rng = makeRng(13)
    for (let i = 0; i < 100; i++) {
      const input = randomString(rng, `abc${SPECIAL}`, 0, 15)
      const escaped = regexpEscape(input)
      // Re-create the original by removing the backslashes we added.
      const unescaped = escaped.replace(/\\(.)/g, "$1")
      expect(unescaped).toBe(input)
    }
  })

  it("escaped string matches literally", () => {
    for (const c of SPECIAL) {
      const re = new RegExp(regexpEscape(c), "g")
      expect("a" + c + "b").toMatch(re)
    }
  })
})

describe("case functions — property tests", () => {
  it("downcase(upcase(x)) === downcase(x)", () => {
    const rng = makeRng(21)
    for (let i = 0; i < 100; i++) {
      const input = randomString(rng, "abcXYZ", 0, 20)
      expect(downcase(upcase(input))).toBe(downcase(input))
    }
  })

  it("upcase(downcase(x)) === upcase(x)", () => {
    const rng = makeRng(33)
    for (let i = 0; i < 100; i++) {
      const input = randomString(rng, "abcXYZ", 0, 20)
      expect(upcase(downcase(input))).toBe(upcase(input))
    }
  })
})

describe("titleCase — property tests", () => {
  it("preserves word count", () => {
    const rng = makeRng(77)
    for (let i = 0; i < 50; i++) {
      const input = randomString(rng, "ab ", 1, 30)
      const words = input.split(" ").filter((w) => w.length > 0).length
      const titled = titleCase(input)
      const titledWords = titled.split(" ").filter((w) => w.length > 0).length
      expect(titledWords).toBe(words)
    }
  })

  it("each word starts with uppercase", () => {
    const input = "hello world foo bar"
    const out = titleCase(input)
    for (const word of out.split(" ")) {
      if (word.length > 0) {
        expect(word[0]).toBe(word[0]!.toUpperCase())
        expect(word[0]).not.toBe(word[0]!.toLowerCase())
      }
    }
  })
})

describe("separate — property tests", () => {
  it("output length is 2n-1 for non-empty input", () => {
    for (let len = 1; len <= 20; len++) {
      const input = "a".repeat(len)
      const out = separate(input)
      expect(out.length).toBe(2 * len - 1)
    }
  })

  it("empty separator returns input unchanged", () => {
    expect(separate("abc", { separator: "" })).toBe("abc")
  })
})

describe("compose / decompose — property tests", () => {
  it("decompose then compose is identity (NFC round-trip)", () => {
    const samples = ["café", "Ångström", "ኢትዮጵያ", "normal"]
    for (const s of samples) {
      expect(compose(decompose(s))).toBe(s.normalize("NFC"))
    }
  })
})
