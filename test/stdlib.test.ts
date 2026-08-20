import { describe, it, expect } from "vitest"
import {
  parallelReplace,
  regexpEscape,
  titleCase,
  separate,
  downcase,
  upcase,
  compose,
  decompose,
} from "../src/stdlib.js"

describe("stdlib", () => {
  describe("parallelReplace", () => {
    it("replaces all pairs in one pass", () => {
      expect(
        parallelReplace("abc", [
          ["a", "x"],
          ["c", "z"],
        ]),
      ).toBe("xbz")
    })

    it("prefers longest match to avoid ambiguity", () => {
      expect(
        parallelReplace("the quick brown fox", [
          ["the", "1"],
          ["the quick", "2"],
        ]),
      ).toBe("2 brown fox")
    })

    it("returns input unchanged when pairs is empty", () => {
      expect(parallelReplace("abc", [])).toBe("abc")
    })

    it("handles overlapping pairs deterministically", () => {
      expect(
        parallelReplace("aaa", [
          ["aa", "X"],
          ["a", "Y"],
        ]),
      ).toBe("XY")
    })
  })

  describe("regexpEscape", () => {
    it("escapes regex metacharacters", () => {
      expect(regexpEscape("a.b*c+d")).toBe("a\\.b\\*c\\+d")
    })

    it("passes through non-meta characters", () => {
      expect(regexpEscape("hello")).toBe("hello")
    })
  })

  describe("titleCase", () => {
    it("capitalises each word with default separator", () => {
      expect(titleCase("hello world foo")).toBe("Hello World Foo")
    })

    it("handles custom separator", () => {
      expect(titleCase("hello_world_foo", { wordSeparator: "_" })).toBe("Hello_World_Foo")
    })

    it("handles empty separator as whole-string capitalisation", () => {
      expect(titleCase("helloworld", { wordSeparator: "" })).toBe("Helloworld")
    })
  })

  describe("separate", () => {
    it("inserts default separator between each character", () => {
      expect(separate("abc")).toBe("a b c")
    })

    it("honours custom separator", () => {
      expect(separate("abc", { separator: "-" })).toBe("a-b-c")
    })
  })

  describe("downcase/upcase", () => {
    it("lowercases", () => {
      expect(downcase("HeLLo")).toBe("hello")
    })
    it("uppercases", () => {
      expect(upcase("HeLLo")).toBe("HELLO")
    })
  })

  describe("compose/decompose", () => {
    it("NFC then NFD roundtrips lossy", () => {
      const s = "café"
      const d = decompose(s)
      const c = compose(d)
      expect(c).toBe(s)
    })
  })
})
