import { describe, it, expect, beforeEach } from "vitest"
import type { CompiledMap } from "../src/types.js"
import { configure, reset, transliterate, MapNotFoundError } from "../src/index.js"

// A minimal hand-built map exercising every rule kind we support today.
// Used to validate the interpreter without depending on the Ruby compiler
// (which would create a chicken-and-egg problem in unit tests).
const HELLOWORLD_MAP: CompiledMap = {
  schemaVersion: 1,
  systemCode: "test-helloworld-Latn-Latn-1",
  dependencies: [],
  metadata: {
    systemCode: "test-helloworld-Latn-Latn-1",
  },
  stages: [
    {
      kind: "stage",
      name: "main",
      rules: [
        {
          kind: "sub",
          from: { kind: "string", value: "hello" },
          to: { kind: "string", value: "world" },
        },
        {
          kind: "sub",
          from: {
            kind: "any",
            of: [
              { kind: "string", value: "a" },
              { kind: "string", value: "e" },
            ],
          },
          to: { kind: "string", value: "_" },
        },
      ],
    },
  ],
  aliases: new Map(),
  functions: new Map(),
}

function makeStrategy(map: CompiledMap) {
  return (systemCode: string): CompiledMap | undefined =>
    systemCode === map.systemCode ? map : undefined
}

describe("interscript-ts", () => {
  beforeEach(reset)

  describe("transliterate", () => {
    it("substitutes literal strings", () => {
      configure({ strategies: [makeStrategy(HELLOWORLD_MAP)] })
      expect(transliterate("test-helloworld-Latn-Latn-1", "hello")).toBe("world")
    })

    it("applies all rules in order", () => {
      configure({ strategies: [makeStrategy(HELLOWORLD_MAP)] })
      expect(transliterate("test-helloworld-Latn-Latn-1", "hello there")).toBe("world th_r_")
    })

    it("throws MapNotFoundError for unknown system", () => {
      configure({ strategies: [] })
      expect(() => transliterate("does-not-exist", "x")).toThrow(MapNotFoundError)
    })
  })

  describe("executeRule", () => {
    it("handles stage references via run rule", () => {
      const mapWithStageRef: CompiledMap = {
        schemaVersion: 1,
        systemCode: "test-stage-ref",
        dependencies: [],
        stages: [
          {
            kind: "stage",
            name: "main",
            rules: [
              {
                kind: "run",
                stage: "prep",
              },
              {
                kind: "sub",
                from: { kind: "string", value: "X" },
                to: { kind: "string", value: "Y" },
              },
            ],
          },
          {
            kind: "stage",
            name: "prep",
            rules: [
              {
                kind: "sub",
                from: { kind: "string", value: "a" },
                to: { kind: "string", value: "X" },
              },
            ],
          },
        ],
        aliases: new Map(),
        functions: new Map(),
      }
      configure({ strategies: [makeStrategy(mapWithStageRef)] })
      expect(transliterate("test-stage-ref", "a")).toBe("Y")
    })

    it("handles funcall rule", () => {
      const mapWithFn: CompiledMap = {
        schemaVersion: 1,
        systemCode: "test-funcall",
        dependencies: [],
        stages: [
          {
            kind: "stage",
            name: "main",
            rules: [
              {
                kind: "funcall",
                name: "downcase",
              },
            ],
          },
        ],
        aliases: new Map(),
        functions: new Map([
          ["downcase", { name: "downcase", impl: (s: string) => s.toLowerCase() }],
        ]),
      }
      configure({ strategies: [makeStrategy(mapWithFn)] })
      expect(transliterate("test-funcall", "HELLO")).toBe("hello")
    })
  })

  describe("item compilation", () => {
    it("escapes regex metacharacters in string items", () => {
      const map: CompiledMap = {
        schemaVersion: 1,
        systemCode: "test-escape",
        dependencies: [],
        stages: [
          {
            kind: "stage",
            name: "main",
            rules: [
              {
                kind: "sub",
                from: { kind: "string", value: "." },
                to: { kind: "string", value: "_" },
              },
            ],
          },
        ],
        aliases: new Map(),
        functions: new Map(),
      }
      configure({ strategies: [makeStrategy(map)] })
      expect(transliterate("test-escape", "a.b.c")).toBe("a_b_c")
    })

    it("resolves aliases", () => {
      const map: CompiledMap = {
        schemaVersion: 1,
        systemCode: "test-alias",
        dependencies: [],
        stages: [
          {
            kind: "stage",
            name: "main",
            rules: [
              {
                kind: "sub",
                from: { kind: "alias", name: "vowel" },
                to: { kind: "string", value: "_" },
              },
            ],
          },
        ],
        aliases: new Map([
          [
            "vowel",
            {
              kind: "any",
              of: [
                { kind: "string", value: "a" },
                { kind: "string", value: "e" },
                { kind: "string", value: "i" },
                { kind: "string", value: "o" },
                { kind: "string", value: "u" },
              ],
            },
          ],
        ]),
        functions: new Map(),
      }
      configure({ strategies: [makeStrategy(map)] })
      expect(transliterate("test-alias", "hello world")).toBe("h_ll_ w_rld")
    })
  })
})
