/**
 * Specs for the TS ISC parser.
 *
 * Each construct gets coverage: parsing success, structural shape,
 * and error cases. Uses inline ISC source fixtures so the tests are
 * self-contained and grep-able.
 */

import { describe, it, expect } from "vitest"
import { parseIsc } from "../../src/isc/parser.ts"
import { iscToCompiledMap } from "../../src/isc/converter.ts"
import { IscParseError } from "../../src/isc/types.ts"

function minimalWrap(body: string): string {
  return `system "TEST:test:Latn:Latn:2026" {\n${body}\n}`
}

describe("parseIsc — system block", () => {
  it("parses a system code", () => {
    const src = `system "ALA-LC:mkd-Cyrl:Latn:1997" {\n}`
    const doc = parseIsc(src, "test.isc")
    expect(doc.systemCode).toBe("ALA-LC:mkd-Cyrl:Latn:1997")
  })

  it("throws on missing system keyword", () => {
    expect(() => parseIsc(`foo "x" {}`, "t.isc")).toThrow(IscParseError)
  })

  it("throws on unterminated system code", () => {
    expect(() => parseIsc(`system "x {}`, "t.isc")).toThrow(IscParseError)
  })
})

describe("parseIsc — metadata", () => {
  it("parses generic key-value fields", () => {
    const doc = parseIsc(minimalWrap(`
metadata {
  authority_id foo
  id 2026
  language iso-639-2:eng
  source_script Latn
  destination_script Latn
  name Test Map
  url https://example.com/test
}`))
    expect(doc.metadata.authority_id).toBe("foo")
    expect(doc.metadata.id).toBe("2026")
    expect(doc.metadata.language).toBe("iso-639-2:eng")
    expect(doc.metadata.name).toBe("Test Map")
    expect(doc.metadata.url).toBe("https://example.com/test")
  })

  it("parses description block with escaped braces", () => {
    const src = `system "x" {
metadata {
  description { Example with \\{braces\\} inside. }
}
}`
    const doc = parseIsc(src)
    expect(doc.metadata.description).toBe("Example with {braces} inside.")
  })

  it("parses notes block in note-list form", () => {
    const doc = parseIsc(minimalWrap(`
metadata {
  notes {
    note "First note"
    note "Second note"
  }
}`))
    expect(doc.metadata.notes).toEqual(["First note", "Second note"])
  })

  it("parses notes block in raw-text form", () => {
    const doc = parseIsc(minimalWrap(`
metadata {
  notes {
    First line of free text.
    Second line.
  }
}`))
    expect(doc.metadata.notes).toContain("First line of free text.")
    expect(doc.metadata.notes).toContain("Second line.")
  })

  it("parses empty notes block", () => {
    const doc = parseIsc(minimalWrap(`
metadata {
  notes { }
}`))
    expect(doc.metadata.notes).toBe("")
  })
})

describe("parseIsc — tests", () => {
  it("parses double-quoted tests with ->", () => {
    const doc = parseIsc(minimalWrap(`
tests {
  "hello" ->  "HELLO"
  "world" ->  "WORLD"
}`))
    expect(doc.tests).toEqual([
      { input: "hello", expected: "HELLO" },
      { input: "world", expected: "WORLD" },
    ])
  })

  it("parses single-quoted tests", () => {
    const doc = parseIsc(minimalWrap(`
tests {
  'hello' ->  'HELLO'
}`))
    expect(doc.tests[0]?.input).toBe("hello")
    expect(doc.tests[0]?.expected).toBe("HELLO")
  })

  it("parses test with note", () => {
    const doc = parseIsc(minimalWrap(`
tests {
  "a" ->  "A" note "uppercase a"
}`))
    expect(doc.tests[0]?.note).toBe("uppercase a")
  })

  it("skips comment lines in tests", () => {
    const doc = parseIsc(minimalWrap(`
tests {
  # comment
  "a" ->  "A"
}`))
    expect(doc.tests.length).toBe(1)
  })
})

describe("parseIsc — aliases", () => {
  it("parses alias with string value", () => {
    const doc = parseIsc(minimalWrap(`
aliases {
  foo = "bar"
}`))
    expect(doc.aliases[0]?.name).toBe("foo")
    expect(doc.aliases[0]?.value).toEqual({ type: "string", value: "bar" })
  })

  it("parses alias with any-of-chars value", () => {
    const doc = parseIsc(minimalWrap(`
aliases {
  vowels = any("aeiou")
}`))
    expect(doc.aliases[0]?.value).toMatchObject({
      type: "set",
      items: [
        { type: "string", value: "a" },
        { type: "string", value: "e" },
        { type: "string", value: "i" },
        { type: "string", value: "o" },
        { type: "string", value: "u" },
      ],
    })
  })

  it("parses alias with range value", () => {
    const doc = parseIsc(minimalWrap(`
aliases {
  lower = any("a".."z")
}`))
    expect(doc.aliases[0]?.value).toMatchObject({ type: "range", lo: "a", hi: "z" })
  })

  it("parses alias with array of multi-char strings", () => {
    const doc = parseIsc(minimalWrap(`
aliases {
  multi = any(["Lj", "Nj", "Dž"])
}`))
    const v = doc.aliases[0]?.value
    expect(v?.type).toBe("set")
    if (v?.type === "set") {
      expect(v.items.length).toBe(3)
      expect(v.items[0]).toEqual({ type: "string", value: "Lj" })
    }
  })

  it("parses alias with nested any expressions", () => {
    const doc = parseIsc(minimalWrap(`
aliases {
  combo = any([any("A".."Z"), any("Ë")])
}`))
    const v = doc.aliases[0]?.value
    expect(v?.type).toBe("set")
    if (v?.type === "set") {
      expect(v.items.length).toBe(2)
      expect(v.items[0]).toMatchObject({ type: "range", lo: "A", hi: "Z" })
    }
  })

  it("parses alias with identifier references", () => {
    const doc = parseIsc(minimalWrap(`
aliases {
  combo = any([digit, space])
}`))
    const v = doc.aliases[0]?.value
    expect(v?.type).toBe("set")
    if (v?.type === "set") {
      expect(v.items[0]).toMatchObject({ type: "alias_ref", name: "digit" })
      expect(v.items[1]).toMatchObject({ type: "primitive", name: "space" })
    }
  })
})

describe("parseIsc — dependencies", () => {
  it("parses bare dependency", () => {
    const doc = parseIsc(minimalWrap(`dependency "posix"`))
    expect(doc.dependencies[0]).toEqual({ target: "posix" })
  })

  it("parses dependency with alias", () => {
    const doc = parseIsc(minimalWrap(`dependency "var-Cyrl" as cyrllatn`))
    expect(doc.dependencies[0]).toEqual({ target: "var-Cyrl", aliasName: "cyrllatn" })
  })
})

describe("parseIsc — stages", () => {
  it("parses a bare sub rule", () => {
    const doc = parseIsc(minimalWrap(`
stage main {
  sub "a" "b"
}`))
    expect(doc.stages[0]?.name).toBe("main")
    expect(doc.stages[0]?.body[0]).toMatchObject({
      kind: "bare_rule",
      rule: { from: { type: "string", value: "a" }, to: { type: "string", value: "b" } },
    })
  })

  it("parses a parallel block", () => {
    const doc = parseIsc(minimalWrap(`
stage main {
  parallel {
    sub "a" "A"
    sub "b" "B"
  }
}`))
    const body = doc.stages[0]?.body[0]
    expect(body?.kind).toBe("parallel")
    if (body?.kind === "parallel") {
      expect(body.rules.length).toBe(2)
    }
  })

  it("parses a sequence block", () => {
    const doc = parseIsc(minimalWrap(`
stage main {
  sequence {
    sub "a" "A"
  }
}`))
    expect(doc.stages[0]?.body[0]?.kind).toBe("sequence")
  })

  it("parses block-form sub with constraints", () => {
    const doc = parseIsc(minimalWrap(`
stage main {
  sub {
    from "a"
    to "A"
    before any("z")
    after boundary
  }
}`))
    const body = doc.stages[0]?.body[0]
    expect(body?.kind).toBe("bare_rule")
    if (body?.kind === "bare_rule") {
      expect(body.rule.constraints.length).toBe(2)
      expect(body.rule.constraints[0]).toMatchObject({ kind: "before" })
      expect(body.rule.constraints[1]).toMatchObject({ kind: "after" })
    }
  })

  it("parses compact sub with constraints", () => {
    const doc = parseIsc(minimalWrap(`
stage main {
  sub "a" "A" before boundary
}`))
    const body = doc.stages[0]?.body[0]
    if (body?.kind === "bare_rule") {
      expect(body.rule.constraints[0]?.kind).toBe("before")
    }
  })

  it("parses run map.X.stage.Y", () => {
    const doc = parseIsc(minimalWrap(`
stage main {
  run map.foo.stage.main
}`))
    expect(doc.stages[0]?.body[0]).toMatchObject({
      kind: "run",
      dependency: "foo",
      stage: "main",
    })
  })

  it("parses run stage.X", () => {
    const doc = parseIsc(minimalWrap(`
stage main {
  run stage.sub
}`))
    expect(doc.stages[0]?.body[0]).toMatchObject({
      kind: "run",
      stage: "sub",
    })
  })

  it("parses separate with separator", () => {
    const doc = parseIsc(minimalWrap(`
stage main {
  separate separator "-"
}`))
    const body = doc.stages[0]?.body[0]
    expect(body?.kind).toBe("separate")
    if (body?.kind === "separate") {
      expect(body.separator).toEqual({ type: "string", value: "-" })
    }
  })

  it("parses bare separate", () => {
    const doc = parseIsc(minimalWrap(`
stage main {
  separate
}`))
    expect(doc.stages[0]?.body[0]?.kind).toBe("separate")
  })

  it("parses compose / decompose", () => {
    const doc = parseIsc(minimalWrap(`
stage main {
  compose
  decompose
}`))
    expect(doc.stages[0]?.body[0]?.kind).toBe("compose")
    expect(doc.stages[0]?.body[1]?.kind).toBe("decompose")
  })

  it("parses string_case ops (upcase, downcase)", () => {
    const doc = parseIsc(minimalWrap(`
stage main {
  upcase
  downcase
}`))
    expect(doc.stages[0]?.body[0]).toMatchObject({ kind: "string_case", op: "upcase" })
    expect(doc.stages[0]?.body[1]).toMatchObject({ kind: "string_case", op: "downcase" })
  })

  it("silently drops stray identifiers in stage body for Ruby parity", () => {
    const doc = parseIsc(minimalWrap(`
stage main {
  parallel {
s
    sub "a" "A"
  }
}`))
    const parallel = doc.stages[0]?.body[0]
    if (parallel?.kind === "parallel") {
      expect(parallel.rules.length).toBe(1)
    }
  })
})

describe("parseIsc — items", () => {
  it("parses string items (double-quoted)", () => {
    const doc = parseIsc(minimalWrap(`aliases { x = "hello" }`))
    expect(doc.aliases[0]?.value).toEqual({ type: "string", value: "hello" })
  })

  it("parses string items (single-quoted)", () => {
    const doc = parseIsc(minimalWrap(`aliases { x = 'hello' }`))
    expect(doc.aliases[0]?.value).toEqual({ type: "string", value: "hello" })
  })

  it("parses escape sequences in strings", () => {
    const doc = parseIsc(minimalWrap(`aliases { x = "tab\\tend" }`))
    expect(doc.aliases[0]?.value).toEqual({ type: "string", value: "tab\tend" })
  })

  it("parses unicode escapes", () => {
    const doc = parseIsc(minimalWrap(`aliases { x = "\\u00e9" }`))
    expect(doc.aliases[0]?.value).toEqual({ type: "string", value: "é" })
  })

  it("parses none", () => {
    const doc = parseIsc(minimalWrap(`aliases { x = none }`))
    expect(doc.aliases[0]?.value).toEqual({ type: "none" })
  })

  it("parses primitives (boundary, space, line_start, line_end)", () => {
    const doc = parseIsc(minimalWrap(`
aliases {
  b = boundary
  s = space
  ls = line_start
  le = line_end
}`))
    expect(doc.aliases[0]?.value).toEqual({ type: "primitive", name: "boundary" })
    expect(doc.aliases[1]?.value).toEqual({ type: "primitive", name: "space" })
    expect(doc.aliases[2]?.value).toEqual({ type: "primitive", name: "line_start" })
    expect(doc.aliases[3]?.value).toEqual({ type: "primitive", name: "line_end" })
  })

  it("parses functions (upcase, downcase)", () => {
    const doc = parseIsc(minimalWrap(`aliases { x = upcase }`))
    expect(doc.aliases[0]?.value).toEqual({ type: "function", name: "upcase" })
  })

  it("parses capture groups", () => {
    const doc = parseIsc(minimalWrap(`aliases { x = capture(any("abc")) }`))
    expect(doc.aliases[0]?.value).toMatchObject({
      type: "capture_group",
      inner: { type: "set" },
    })
  })

  it("parses ref(N)", () => {
    const doc = parseIsc(minimalWrap(`aliases { x = ref(1) }`))
    expect(doc.aliases[0]?.value).toEqual({ type: "capture", index: 1 })
  })

  it("parses maybe(X)", () => {
    const doc = parseIsc(minimalWrap(`aliases { x = maybe("a") }`))
    expect(doc.aliases[0]?.value).toMatchObject({
      type: "maybe",
      inner: { type: "string", value: "a" },
    })
  })

  it("parses some(X)", () => {
    const doc = parseIsc(minimalWrap(`aliases { x = some("a") }`))
    expect(doc.aliases[0]?.value).toMatchObject({
      type: "some",
      inner: { type: "string", value: "a" },
    })
  })

  it("parses concat with +", () => {
    const doc = parseIsc(minimalWrap(`aliases { x = "a" + "b" }`))
    expect(doc.aliases[0]?.value).toMatchObject({
      type: "concat",
      parts: [
        { type: "string", value: "a" },
        { type: "string", value: "b" },
      ],
    })
  })

  it("parses concat by juxtaposition (no +)", () => {
    const doc = parseIsc(minimalWrap(`aliases { x = "a" "b" }`))
    expect(doc.aliases[0]?.value).toMatchObject({ type: "concat" })
  })

  it("parses alias reference", () => {
    const doc = parseIsc(minimalWrap(`aliases { x = other_alias }`))
    expect(doc.aliases[0]?.value).toEqual({ type: "alias_ref", name: "other_alias" })
  })

  it("parses any(single_item) as 1-element set", () => {
    const doc = parseIsc(minimalWrap(`aliases { x = any(space) }`))
    expect(doc.aliases[0]?.value).toMatchObject({
      type: "set",
      items: [{ type: "primitive", name: "space" }],
    })
  })

  it("parses any(item + item) as 1-element set with concat", () => {
    const doc = parseIsc(minimalWrap(`aliases { x = any(space + line_end) }`))
    const v = doc.aliases[0]?.value
    expect(v?.type).toBe("set")
    if (v?.type === "set") {
      expect(v.items[0]?.type).toBe("concat")
    }
  })
})

describe("parseIsc — comments and whitespace", () => {
  it("skips line comments", () => {
    const doc = parseIsc(minimalWrap(`
# top-level comment
stage main {
  # inner comment
  sub "a" "A"
}`))
    expect(doc.stages[0]?.body[0]).toMatchObject({ kind: "bare_rule" })
  })

  it("handles blank lines between constructs", () => {
    const doc = parseIsc(minimalWrap(`

stage main {

  sub "a" "A"

}`))
    expect(doc.stages[0]?.body[0]).toMatchObject({ kind: "bare_rule" })
  })
})

describe("parseIsc — error reporting", () => {
  it("reports line and column", () => {
    expect(() => parseIsc(`system "x" {\nstage main {\n  sub\n}\n}`, "t.isc")).toThrow(IscParseError)
    try {
      parseIsc(`system "x" {\nstage main {\n  sub\n}\n}`, "t.isc")
    } catch (e) {
      expect(e).toBeInstanceOf(IscParseError)
      const err = e as IscParseError
      expect(err.line).toBeGreaterThanOrEqual(3)
    }
  })

  it("includes filename in message", () => {
    expect(() => parseIsc(`garbage`, "my-map.isc")).toThrow(IscParseError)
    expect(() => parseIsc(`garbage`, "my-map.isc")).toThrow(/my-map\.isc/)
  })
})

describe("iscToCompiledMap — runtime conversion", () => {
  it("converts a minimal document", () => {
    const doc = parseIsc(minimalWrap(`
aliases { v = any("aeiou") }
stage main {
  parallel {
    sub "a" "A"
  }
}`))
    const json = iscToCompiledMap(doc)
    expect(json.schemaVersion).toBe(1)
    expect(json.systemCode).toBe("TEST:test:Latn:Latn:2026")
    expect(json.stages.length).toBe(1)
    expect(json.stages[0]?.kind).toBe("stage")
    expect(json.aliases.v).toMatchObject({ kind: "any" })
  })

  it("resolves dependency aliases in run rules", () => {
    const doc = parseIsc(minimalWrap(`
dependency "alalc-amh-Ethi-Latn-1997" as ethilatn
stage main {
  run map.ethilatn.stage.main
}`))
    const json = iscToCompiledMap(doc)
    expect(json.dependencies).toEqual(["alalc-amh-Ethi-Latn-1997"])
    const rule = json.stages[0]?.rules[0]
    expect(rule).toMatchObject({
      kind: "run",
      stage: "main",
      docName: "alalc-amh-Ethi-Latn-1997",
    })
  })

  it("emits FuncallInline for `to upcase`", () => {
    const doc = parseIsc(minimalWrap(`
stage main {
  sub {
    from "a"
    to upcase
  }
}`))
    const json = iscToCompiledMap(doc)
    const rule = json.stages[0]?.rules[0]
    expect(rule).toMatchObject({
      kind: "sub",
      to: { kind: "funcall_inline", name: "upcase" },
    })
  })

  it("emits FuncallRule for separate", () => {
    const doc = parseIsc(minimalWrap(`
stage main {
  separate separator "-"
}`))
    const json = iscToCompiledMap(doc)
    const rule = json.stages[0]?.rules[0]
    expect(rule).toMatchObject({
      kind: "funcall",
      name: "separate",
      kwargs: { separator: "-" },
    })
  })

  it("drops metadata when empty", () => {
    const doc = parseIsc(minimalWrap(`stage main { sub "a" "A" }`))
    const json = iscToCompiledMap(doc)
    expect(json.metadata).toBeUndefined()
  })
})

describe("parseIsc — fixtures from real maps", () => {
  it("parses a Cyrillic map (bgnpcgn-rus)", () => {
    const src = `
system "BGNPCGN:rus-Cyrl:Latn:1947" {
metadata {
  authority_id bgnpcgn
  id 1947
  language iso-639-2:rus
  source_script Cyrl
  destination_script Latn
  name Romanization of Russian (1947)
}
tests {
   "ШЧ шч Шч шЧ" ->  "SH·CH sh·ch Sh·ch sh·Ch"
}
aliases {
  rus_extvowel = any("АаЕеЁёИиОоУуЫыЭэЮюЯяЙйЪъЬь")
  rus_latupper = any([any("A".."Z"), any("Ë")])
}
stage main {
  parallel {
    sub "Ё" "Yë" before rus_extvowel
  }
}
}`
    const doc = parseIsc(src, "bgnpcgn-rus.isc")
    expect(doc.systemCode).toBe("BGNPCGN:rus-Cyrl:Latn:1947")
    expect(doc.aliases.length).toBe(2)
    expect(doc.tests.length).toBe(1)
    expect(doc.stages.length).toBe(1)
  })
})
