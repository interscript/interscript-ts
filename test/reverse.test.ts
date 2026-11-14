/**
 * Reverse-mode parity — ported from interscript-rs `tests/reverse.rs`,
 * whose expectations are ruby ground truth (`Document#reverse` over
 * interscript-ruby origin/main, `spec/reversibility_spec.rb`).
 *
 * Fixtures: test/fixtures/reverse/*.isc (vendored from
 * interscript-rs tests/reverse_maps/, plus rev-upcase-repeat for the
 * repeat-item deviation).
 *
 * Documented ruby-crash deviations surface as named MapLogicErrors at
 * reverse time (mirroring rs `Error::Unsupported` messages):
 *   - a repeat (maybe/some) item under a `to upcase`/`to downcase` sub
 *   - a boundary hoist that consumes the whole from group
 *   - a funcall outside the reverse_function map (upcase has no entry)
 */

import { describe, it, expect, beforeAll } from "vitest"
import { readFileSync, readdirSync } from "fs"
import { join } from "path"
import { parseIsc } from "../src/isc/parser.ts"
import { iscToCompiledMap } from "../src/isc/converter.ts"
import { iscBundledStrategy } from "../src/isc/loader.ts"
import { normaliseMap } from "../src/loaders.js"
import { configure, reset, transliterate, reverse } from "../src/index.js"
import { reverseName, reverseMap } from "../src/reverse.js"
import type { CompiledMap, GroupItem, SubRule, AliasItem } from "../src/types.js"
import { MapLogicError } from "../src/errors.js"

const FIXTURES_DIR = join(__dirname, "fixtures", "reverse")

/** Load every fixture under both its file stem and its system code
 * (dependency targets are file stems; top-level loads use the code). */
function loadSources(): Record<string, string> {
  const sources: Record<string, string> = {}
  for (const f of readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".isc"))) {
    const src = readFileSync(join(FIXTURES_DIR, f), "utf8")
    const doc = parseIsc(src, f)
    sources[f.replace(/\.isc$/, "")] = src
    sources[doc.systemCode] = src
  }
  return sources
}

const sources = loadSources()

beforeAll(() => {
  reset()
  configure({ strategies: [iscBundledStrategy(sources)] })
})

function compile(code: string): CompiledMap {
  return normaliseMap(iscToCompiledMap(parseIsc(sources[code]!, code)))
}

/** Reverse a map and transliterate `input` through its main stage —
 * the mirror of the rs test's `reverse_run` helper (rt.load +
 * reverse_document + execute): the runtime path, so dependency
 * documents reverse with the parent exactly like rs. */
function reverseRun(mapId: string, input: string): string {
  return reverse(mapId, input)
}

describe("reverseName (Document.reverse_name)", () => {
  it("swaps source and target codes at 4+ dash segments", () => {
    expect(reverseName("alalc-bul-Cyrl-Latn-1997")).toBe("alalc-bul-Latn-Cyrl-1997")
    // the swap is an involution
    expect(reverseName("alalc-bul-Latn-Cyrl-1997")).toBe("alalc-bul-Cyrl-Latn-1997")
  })

  it("strips a -reverse suffix, else appends one", () => {
    expect(reverseName("some-map-reverse")).toBe("some-map")
    expect(reverseName("short-x")).toBe("short-x-reverse")
    expect(reverseName("a-b-c")).toBe("a-b-c-reverse")
  })
})

describe("reverseMap — rs reverse.rs parity slice", () => {
  it("parallel rules swap and reverse order", () => {
    expect(reverseRun("rev:parallel", "phth")).toBe("phthh")
    expect(reverseRun("rev:parallel", "x")).toBe("x")
    expect(reverseRun("rev:parallel", "fats")).toBe("phaths")
  })

  it("sequential children reverse order", () => {
    expect(reverseRun("rev:sequence", "Q")).toBe("ab")
    expect(reverseRun("rev:sequence", "X")).toBe("ab")
    expect(reverseRun("rev:sequence", "ab")).toBe("ab")
    expect(reverseRun("rev:sequence", "abq")).toBe("abq")
  })

  it("case swap downcases the from tree", () => {
    expect(reverseRun("rev:case", "abc")).toBe("Abc")
    expect(reverseRun("rev:case", "abc ABC")).toBe("Abc ABC")
  })

  it("boundary constraints pass through unchanged", () => {
    expect(reverseRun("rev:boundary", "r y")).toBe("r x")
    expect(reverseRun("rev:boundary", "yq")).toBe("yq")
    expect(reverseRun("rev:boundary", "qr")).toBe("qr")
  })

  it("capture and ref exchange sides", () => {
    expect(reverseRun("rev:capture", "Xbc")).toBe("abcd")
    expect(reverseRun("rev:capture", "Xd")).toBe("Xd")
    expect(reverseRun("rev:capture", "abcd")).toBe("abcd")
  })

  it("funcalls invert through the reverse function map", () => {
    expect(reverseRun("rev:funcall", "a-b-c")).toBe("abc")
    expect(reverseRun("rev:funcall", "abc")).toBe("abc")
  })

  it("dependency documents reverse with the parent", () => {
    expect(reverseRun("rev:dep-main", "men")).toBe("mem")
    expect(reverseRun("rev:dep-main", "pem")).toBe("mem")
  })

  it("real corpus map reverses like ruby (alalc-bul-Cyrl-Latn-1997)", () => {
    expect(reverseRun("ALA-LC:bul-Cyrl:Latn:1997", "Kirillicata")).toBe("Кириллиcата")
    expect(reverseRun("ALA-LC:bul-Cyrl:Latn:1997", "zapad")).toBe("запад")
    expect(reverseRun("ALA-LC:bul-Cyrl:Latn:1997", "Sofiya")).toBe("Софиyа")
  })

  it("empty reversed from disables the rule", () => {
    // sub "h" none reverses to a rule matching everywhere; ruby marks it
    // reverse_run: true (executor skips) — the compiled-IR form drops it.
    expect(reverseRun("rev:delete", "hh")).toBe("hh")
    expect(reverseRun("rev:delete", "hi")).toBe("hi")
  })

  it("reverses the document name and swaps metadata scripts", () => {
    const map = compile("ALA-LC:bul-Cyrl:Latn:1997")
    const reversed = reverseMap(map)
    // The system code has 3 dash-parts (colons separate the fields),
    // so Document.reverse_name appends the -reverse suffix.
    expect(reversed.systemCode).toBe("ALA-LC:bul-Cyrl:Latn:1997-reverse")
    const md = reversed.metadata as Record<string, unknown>
    expect(md["source_script"]).toBe("Latn")
    expect(md["destination_script"]).toBe("Cyrl")
    // aliases and languages pass through untouched (rs: rdoc.aliases = self.aliases)
    expect(reversed.aliases).toBe(map.aliases)
    expect(reversed.languages).toBe(map.languages)
    expect(reversed.dependencies).toEqual(map.dependencies)
  })
})

describe("runtime reverse + reverse-name load fallback", () => {
  it("transliterate resolves a missing map through its reverse name", () => {
    // no "rev:parallel-reverse" map exists — the fallback loads
    // rev:parallel and returns its reverse (ruby DSL.parse behavior).
    expect(transliterate("rev:parallel-reverse", "fats")).toBe("phaths")
  })

  it("runtime reverse executes dependency documents reversed", () => {
    expect(reverse("rev:dep-main", "men")).toBe("mem")
    expect(reverse("rev:dep-main", "pem")).toBe("mem")
  })
})

describe("documented ruby-crash deviations surface as named errors", () => {
  it("upcase funcall has no reverse (rs: Error::Unsupported)", () => {
    const map = compile("rev:upcase")
    expect(() => reverseMap(map)).toThrow(/upcase has no reverse/)
  })

  it("repeat item under to-upcase raises (ruby NoMethodError)", () => {
    const map = compile("rev:upcase-repeat")
    expect(() => reverseMap(map)).toThrow(/repeat item in a to-upcase\/downcase sub/)
  })

  it("boundary hoist consuming the whole from group raises (ruby NoMethodError)", () => {
    // Hand-built: a one-child group whose only child is boundary-like —
    // unreachable through the ISC converter (single-part concats
    // unwrap) but the same path rs guards with Error::Unsupported.
    const boundary = { kind: "alias", name: "boundary" } as AliasItem
    const from: GroupItem = { kind: "group", items: [boundary] }
    const rule: SubRule = { kind: "sub", from, to: { kind: "string", value: "x" } }
    const map: CompiledMap = {
      schemaVersion: 1,
      systemCode: "unit:hoist",
      dependencies: [],
      stages: [{ kind: "stage", name: "main", rules: [rule] }],
      aliases: new Map(),
      functions: new Map(),
    }
    let caught: unknown
    try {
      reverseMap(map)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(MapLogicError)
    expect((caught as Error).message).toMatch(/boundary hoist consumed the whole from group/)
  })

  it("unhandled item kind in the from tree raises (ruby 'Type ... unhandled!')", () => {
    const rule: SubRule = {
      kind: "sub",
      from: { kind: "stage_ref", name: "other" },
      to: { kind: "string", value: "x" },
    }
    const map: CompiledMap = {
      schemaVersion: 1,
      systemCode: "unit:unhandled",
      dependencies: [],
      stages: [{ kind: "stage", name: "main", rules: [rule] }],
      aliases: new Map(),
      functions: new Map(),
    }
    expect(() => reverseMap(map)).toThrow(/unhandled in reverse_transfer/)
  })
})
