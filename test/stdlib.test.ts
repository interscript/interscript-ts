import { describe, it, expect } from "vitest"
import {
  countCaptureGroups,
  parallelMegaregexp,
  parallelReplace,
  regexpEscape,
  titleCase,
  separate,
  downcase,
  upcase,
  compose,
  decompose,
  type MegaregexpRule,
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

  // WO18 G1 — the megaregexp join wraps each rule in a named group.
  // $N templates must resolve against the RULE's own capture list (rs
  // semantics), not the global group list that includes the wrappers.
  describe("parallelMegaregexp", () => {
    it("first alternative wins at each position", () => {
      const rules: MegaregexpRule[] = [
        { pattern: "ab", replace: () => "1" },
        { pattern: "a", replace: () => "2" },
      ]
      expect(parallelMegaregexp("ab", rules)).toBe("1")
    })

    it("gives the rule its own captures, not the wrapper's whole match", () => {
      const rules: MegaregexpRule[] = [
        {
          pattern: "([a-z])x",
          replace: (m, g) => (g[0] !== undefined ? g[0] + "X" : m),
        },
        { pattern: "b", replace: (m) => m.toUpperCase() },
      ]
      expect(parallelMegaregexp("axb", rules)).toBe("aXB")
    })

    it("offsets a later rule's captures past earlier rules' inner groups", () => {
      const rules: MegaregexpRule[] = [
        {
          pattern: "([a-z])x",
          replace: (_m, g) => (g[0] !== undefined ? g[0] + "X" : _m),
        },
        {
          pattern: "b([0-9])",
          replace: (_m, g) => g[0] ?? "?",
        },
      ]
      // "ax" hits rule 0; "b5" hits rule 1, whose only capture is "5" —
      // the wrapper of rule 0 (and of rule 1) must not shift it.
      expect(parallelMegaregexp("axb5", rules)).toBe("aX5")
    })

    it("keeps rule-local numbering when a single rule has two captures", () => {
      const rules: MegaregexpRule[] = [
        { pattern: "([a-z])([0-9])", replace: (_m, g) => g[1]! + g[0]! },
      ]
      expect(parallelMegaregexp("k3", rules)).toBe("3k")
    })
  })

  describe("countCaptureGroups", () => {
    it("counts bare capture groups", () => {
      expect(countCaptureGroups("([a-z])x")).toBe(1)
      expect(countCaptureGroups("([a-z])([0-9])")).toBe(2)
    })

    it("ignores non-capturing groups and lookarounds", () => {
      expect(countCaptureGroups("(?:ab)")).toBe(0)
      expect(countCaptureGroups("(?<=x)y(?=z)")).toBe(0)
      expect(countCaptureGroups("(?<!x)(?!y)")).toBe(0)
    })

    it("ignores escaped parens and parens inside char classes", () => {
      expect(countCaptureGroups("\\(x\\)")).toBe(0)
      expect(countCaptureGroups("[a(b]c")).toBe(0)
      expect(countCaptureGroups("[(\\(]")).toBe(0)
    })
  })
})
