/**
 * Specs for the Rababa ML module — haraqat constants, encoder, cleaner,
 * reconciler. Full inference is tested separately against the model file.
 */

import { describe, it, expect } from "vitest"
import {
  ALL_POSSIBLE_HARAQAT,
  BASIC_HARAQAT,
  HARAQAT,
  INPUT_VOCAB,
  INPUT_SYMBOL_TO_ID,
  ID_TO_HARAAQAT,
} from "../../src/ml/models/rababa/haraqat.js"
import { ArabicEncoder } from "../../src/ml/models/rababa/encoder.js"
import { cleanArabic, cleanBasic } from "../../src/ml/models/rababa/cleaner.js"
import { reconcileStrings } from "../../src/ml/models/rababa/reconciler.js"
import { rababaReverse } from "../../src/stdlib/ml.js"

describe("Rababa haraqat constants", () => {
  it("has 8 basic haraqat", () => {
    expect(HARAQAT.length).toBe(8)
  })

  it("has 15 output classes (including no-diacritic + shaddah combos)", () => {
    expect(Object.keys(ALL_POSSIBLE_HARAQAT).length).toBe(15)
  })

  it("ID_TO_HARAAQAT is pad + ALL_POSSIBLE_HARAQAT keys + unused slot", () => {
    const keys = Object.keys(ALL_POSSIBLE_HARAQAT)
    expect(ID_TO_HARAAQAT).toEqual(["P", ...keys, ""])
    expect(ID_TO_HARAAQAT.length).toBe(17)
  })

  it("INPUT_VOCAB starts with pad symbol 'P'", () => {
    expect(INPUT_VOCAB[0]).toBe("P")
    expect(INPUT_VOCAB.length).toBeGreaterThan(40)
  })

  it("every input vocab char has a unique ID", () => {
    const ids = Object.values(INPUT_SYMBOL_TO_ID)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("BASIC_HARAQAT is a subset of ALL_POSSIBLE_HARAQAT keys", () => {
    for (const k of Object.keys(BASIC_HARAQAT)) {
      expect(ALL_POSSIBLE_HARAQAT).toHaveProperty(k)
    }
  })
})

describe("Rababa cleaner", () => {
  it("collapses multiple spaces", () => {
    expect(cleanBasic("a   b  c")).toBe("a b c")
  })

  it("strips leading/trailing whitespace", () => {
    expect(cleanBasic("  hello  ")).toBe("hello")
  })

  it("Arabic cleaner keeps only valid Arabic + haraqat", () => {
    const out = cleanArabic("قطر hello 123")
    expect(out).not.toContain("h")
    expect(out).not.toContain("1")
    expect(out).toContain("ق")
    expect(out).toContain("ط")
    expect(out).toContain("ر")
  })

  it("Arabic cleaner preserves space between valid chars", () => {
    const out = cleanArabic("قطر قطر")
    expect(out).toContain(" ")
  })
})

describe("Rababa encoder", () => {
  it("converts each Arabic char to a unique ID", () => {
    const encoder = new ArabicEncoder()
    const seq = encoder.inputToSequence("بض")
    expect(seq.length).toBe(2)
    expect(seq[0]).not.toBe(seq[1])
  })

  it("skips characters not in the vocab", () => {
    const encoder = new ArabicEncoder()
    const seq = encoder.inputToSequence("بxض")
    expect(seq.length).toBe(2) // x is not in the vocab
  })

  it("pad symbol has ID 0", () => {
    expect(INPUT_SYMBOL_TO_ID["P"]).toBe(0)
  })

  it("reverses input when reverseInput is true", () => {
    const encoder = new ArabicEncoder({ reverseInput: true })
    const seq = encoder.inputToSequence("بض")
    const seqNormal = new ArabicEncoder().inputToSequence("بض")
    expect(seq).toEqual([...seqNormal].reverse())
  })
})

describe("Rababa reconciler", () => {
  it("preserves non-Arabic chars at their positions", () => {
    const original = "# قطر 34"
    const diacritized = "قِطْرَ"
    const out = reconcileStrings(original, diacritized)
    expect(out).toContain("#")
    expect(out).toContain("34")
    expect(out).toContain("قِطْرَ")
  })

  it("handles identical strings (no-op)", () => {
    const original = "abc"
    const diacritized = "abc"
    expect(reconcileStrings(original, diacritized)).toBe("abc")
  })

  it("handles empty diacritized", () => {
    expect(reconcileStrings("abc", "")).toBe("abc")
  })

  it("handles empty original", () => {
    expect(reconcileStrings("", "abc")).toBe("abc")
  })
})

describe("rababaReverse", () => {
  it("strips all haraqat", () => {
    expect(rababaReverse("قِطْرَ")).toBe("قطر")
  })

  it("strips shaddah + haraqat combos", () => {
    expect(rababaReverse("مَّرَّ")).toBe("مر")
  })

  it("leaves non-haraqat text unchanged", () => {
    expect(rababaReverse("hello")).toBe("hello")
    expect(rababaReverse("قطر")).toBe("قطر")
  })
})
