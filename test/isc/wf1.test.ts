/**
 * Specs for ISC-WF-1 — the workflow extension (docs/isc-wf-1.md).
 *
 * W1 named rulesets (§3), W2 use-with-override (§4), W3 language
 * conditioning (§5). Parse-level specs live next to runtime-level
 * specs: W1/W2 resolve at parse/compile time (expansion), W3 resolves
 * at run time (guard filtering in the executor).
 */

import { describe, it, expect } from "vitest"
import { parseIsc } from "../../src/isc/parser.ts"
import { iscToCompiledMap } from "../../src/isc/converter.ts"
import { expandDocument } from "../../src/isc/expand.ts"
import { IscLoadError, IscParseError } from "../../src/isc/types.ts"
import { normaliseMap } from "../../src/loaders.ts"
import { executeStage } from "../../src/runtime/interpreter.ts"
import type { IscDocument, IscStageItem } from "../../src/isc/types.ts"

function minimalWrap(body: string): string {
  return `system "TEST:test:Latn:Latn:2026" {\n${body}\n}`
}

/** Compile + run a stage through the real executor. */
function run(source: string, input: string, stage = "main", language?: string): string {
  const json = iscToCompiledMap(parseIsc(source))
  const map = normaliseMap(json)
  return executeStage(map, stage, input, undefined, language)
}

/** Flatten a stage body to a compact trace: kind + from→to for rules. */
function trace(body: readonly IscStageItem[]): string[] {
  const out: string[] = []
  for (const item of body) {
    if (item.kind === "bare_rule") {
      const from = item.rule.from.type === "string" ? item.rule.from.value : "?"
      const to = item.rule.to.type === "string" ? item.rule.to.value : "?"
      out.push(`sub ${from}->${to}${item.rule.when ? ` when ${item.rule.when.join(",")}` : ""}`)
    } else if (item.kind === "parallel" || item.kind === "sequence") {
      out.push(
        `${item.kind}[${item.rules
          .map(
            (r) => `${(r.from as { value: string }).value}->${(r.to as { value: string }).value}`,
          )
          .join(", ")}]`,
      )
    } else if (item.kind === "use") {
      out.push(`USE ${item.dependency ? `${item.dependency}.` : ""}${item.name}`)
    } else {
      out.push(item.kind)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// W1/W2 — parsing
// ---------------------------------------------------------------------------

describe("parseIsc — ruleset (W1)", () => {
  it("parses a ruleset with bare subs", () => {
    const doc = parseIsc(
      minimalWrap(`
ruleset vowels {
  sub "a" "x"
  sub "e" "y"
}
stage main {
  parallel {
    sub "b" "b"
  }
}`),
    )
    expect(doc.rulesets).toHaveLength(1)
    expect(doc.rulesets![0]!.name).toBe("vowels")
    expect(doc.rulesets![0]!.body).toHaveLength(2)
    expect(doc.stages).toHaveLength(1)
  })

  it("parses rulesets containing parallel blocks and nested uses", () => {
    const doc = parseIsc(
      minimalWrap(`
ruleset base {
  sub "a" "x"
}
ruleset composite {
  use base
  parallel {
    sub "b" "y"
  }
  sub "c" "z"
}`),
    )
    expect(doc.rulesets).toHaveLength(2)
    const composite = doc.rulesets![1]!
    expect(trace(composite.body)).toEqual(["USE base", "parallel[b->y]", "sub c->z"])
  })

  it("omits rulesets/languages fields when absent (legacy shape)", () => {
    const doc = parseIsc(minimalWrap(`stage main { parallel { sub "a" "a" } }`))
    expect(doc.rulesets).toBeUndefined()
    expect(doc.languages).toBeUndefined()
  })
})

describe("parseIsc — use directive (W1/W2)", () => {
  it("parses same-map use", () => {
    const doc = parseIsc(minimalWrap(`stage main { use vowels }`))
    expect(doc.stages[0]!.body).toEqual([{ kind: "use", name: "vowels" }])
  })

  it("parses dependency-qualified use", () => {
    const doc = parseIsc(minimalWrap(`dependency "some-lib" as lib\nstage main { use lib.vowels }`))
    expect(doc.stages[0]!.body[0]).toEqual({ kind: "use", name: "vowels", dependency: "lib" })
  })

  it("parses an override block with full sub rules", () => {
    const doc = parseIsc(
      minimalWrap(`
stage main {
  use vowels override {
    sub "a" "A"
    sub "q" "k" when kur
    sub { from "b" to "B" before "c" }
  }
}`),
    )
    const item = doc.stages[0]!.body[0] as Extract<IscStageItem, { kind: "use" }>
    expect(item.override).toHaveLength(3)
    expect(item.override![0]).toMatchObject({ from: { value: "a" }, to: { value: "A" } })
    expect(item.override![1]!.when).toEqual(["kur"])
    // block-form row keeps its constraint
    expect(item.override![2]!.constraints).toHaveLength(1)
  })

  it("rejects malformed use", () => {
    expect(() => parseIsc(minimalWrap(`stage main { use }`))).toThrow(IscParseError)
  })
})

describe("parseIsc — languages declaration (W3)", () => {
  it("parses a space-separated list", () => {
    const doc = parseIsc(minimalWrap(`languages rus bel ukr`))
    expect(doc.languages).toEqual(["rus", "bel", "ukr"])
  })

  it("parses comma-separated lists and multiple declarations merge", () => {
    const doc = parseIsc(minimalWrap(`languages rus, bel\nlanguages ukr`))
    expect(doc.languages).toEqual(["rus", "bel", "ukr"])
  })

  it("terminates at the next block keyword", () => {
    const doc = parseIsc(minimalWrap(`languages kur chv\nstage main {}`))
    expect(doc.languages).toEqual(["kur", "chv"])
    expect(doc.stages).toHaveLength(1)
  })
})

describe("parseIsc — when guard suffix (W3)", () => {
  it("parses the suffix on a compact rule", () => {
    const doc = parseIsc(minimalWrap(`stage main { parallel { sub "a" "x" when kur } }`))
    const rules = doc.stages[0]!.body[0] as Extract<IscStageItem, { kind: "parallel" }>
    expect(rules.rules[0]!.when).toEqual(["kur"])
  })

  it("parses comma-separated guard lists", () => {
    const doc = parseIsc(minimalWrap(`stage main { sub "a" "x" when kur, chv }`))
    const rule = doc.stages[0]!.body[0] as Extract<IscStageItem, { kind: "bare_rule" }>
    expect(rule.rule.when).toEqual(["kur", "chv"])
  })

  it("parses the suffix after constraints", () => {
    const doc = parseIsc(minimalWrap(`stage main { sub "a" "x" before "b" when kur }`))
    const rule = doc.stages[0]!.body[0] as Extract<IscStageItem, { kind: "bare_rule" }>
    expect(rule.rule.constraints).toHaveLength(1)
    expect(rule.rule.when).toEqual(["kur"])
  })

  it("parses the suffix on a block-form rule", () => {
    const doc = parseIsc(minimalWrap(`stage main { sub { from "a" to "x" } when kur }`))
    const rule = doc.stages[0]!.body[0] as Extract<IscStageItem, { kind: "bare_rule" }>
    expect(rule.rule.when).toEqual(["kur"])
  })

  it("leaves unguarded rules untouched", () => {
    const doc = parseIsc(minimalWrap(`stage main { parallel { sub "a" "x" } }`))
    const rules = doc.stages[0]!.body[0] as Extract<IscStageItem, { kind: "parallel" }>
    expect(rules.rules[0]!.when).toBeUndefined()
  })

  it("rejects an empty guard list", () => {
    expect(() => parseIsc(minimalWrap(`stage main { sub "a" "x" when }`))).toThrow(IscParseError)
  })
})

// ---------------------------------------------------------------------------
// W1 — expansion semantics (§3.2)
// ---------------------------------------------------------------------------

describe("expandDocument — W1 expansion", () => {
  it("expands a same-map ruleset in place, in document order", () => {
    const doc = parseIsc(
      minimalWrap(`
ruleset rs {
  sub "a" "x"
  sub "b" "y"
}
stage main {
  sub "0" "0"
  use rs
  sub "1" "1"
}`),
    )
    const expanded = expandDocument(doc)
    expect(trace(expanded.stages[0]!.body)).toEqual([
      "sub 0->0",
      "sub a->x",
      "sub b->y",
      "sub 1->1",
    ])
  })

  it("expands recursively and keeps a nested parallel block as one pass", () => {
    const doc = parseIsc(
      minimalWrap(`
ruleset base {
  sub "a" "x"
}
ruleset composite {
  use base
  parallel {
    sub "b" "y"
    sub "c" "z"
  }
  sub "d" "w"
}
stage main {
  use composite
}`),
    )
    const expanded = expandDocument(doc)
    expect(trace(expanded.stages[0]!.body)).toEqual([
      "sub a->x",
      "parallel[b->y, c->z]",
      "sub d->w",
    ])
  })

  it("expands a ruleset across a dependency via the resolver", () => {
    const libDoc = parseIsc(`system "lib:shared:Latn:2026" {\nruleset rs {\n  sub "a" "x"\n}\n}`)
    const doc = parseIsc(
      minimalWrap(`dependency "lib:shared:Latn:2026" as lib\nstage main { use lib.rs }`),
    )
    const expanded = expandDocument(doc, {
      resolveDependency: (target) => (target === "lib:shared:Latn:2026" ? libDoc : undefined),
    })
    expect(trace(expanded.stages[0]!.body)).toEqual(["sub a->x"])
  })

  it("resolves nested uses against the OWNING dependency's rulesets and aliases", () => {
    const libDoc = parseIsc(
      `system "lib:shared:Latn:2026" {\nruleset inner {\n  sub "a" "x"\n}\nruleset outer {\n  use inner\n  sub "b" "y"\n}\n}`,
    )
    const doc = parseIsc(
      minimalWrap(`dependency "lib:shared:Latn:2026" as lib\nstage main { use lib.outer }`),
    )
    const expanded = expandDocument(doc, {
      resolveDependency: (target) => (target === "lib:shared:Latn:2026" ? libDoc : undefined),
    })
    expect(trace(expanded.stages[0]!.body)).toEqual(["sub a->x", "sub b->y"])
  })

  it("a ruleset never executes on its own — library maps have no stages", () => {
    const doc = parseIsc(minimalWrap(`ruleset rs {\n  sub "a" "x"\n}`))
    expect(doc.stages).toHaveLength(0)
  })

  it("is a no-op for documents without use directives", () => {
    const doc = parseIsc(minimalWrap(`stage main { parallel { sub "a" "a" } }`))
    const expanded = expandDocument(doc)
    expect(expanded.stages).toEqual(doc.stages)
  })
})

describe("expandDocument — cycle and resolution errors (§3.2, §6.4)", () => {
  it("rejects a self-cycle", () => {
    const doc = parseIsc(minimalWrap(`ruleset rs {\n  use rs\n}\nstage main { use rs }`))
    expect(() => expandDocument(doc)).toThrow(IscLoadError)
    expect(() => expandDocument(doc)).toThrow(/use cycle/)
  })

  it("rejects a duplicate ruleset definition (py canon - keep-first hides map bugs)", () => {
    const doc = parseIsc(
      minimalWrap(`ruleset a { sub "x" "1" }\nruleset a { sub "x" "2" }\nstage main { use a }`),
    )
    expect(() => expandDocument(doc)).toThrow(IscLoadError)
    expect(() => expandDocument(doc)).toThrow(/declared more than once/)
  })

  it("rejects a mutual cycle", () => {
    const doc = parseIsc(
      minimalWrap(`ruleset a { use b }\nruleset b { use a }\nstage main { use a }`),
    )
    expect(() => expandDocument(doc)).toThrow(/use cycle/)
  })

  it("allows reusing the same ruleset twice (chain, not visited-set)", () => {
    const doc = parseIsc(minimalWrap(`ruleset rs { sub "a" "x" }\nstage main { use rs\n  use rs }`))
    const expanded = expandDocument(doc)
    expect(trace(expanded.stages[0]!.body)).toEqual(["sub a->x", "sub a->x"])
  })

  it("rejects an unknown ruleset", () => {
    const doc = parseIsc(minimalWrap(`stage main { use nope }`))
    expect(() => expandDocument(doc)).toThrow(/unknown ruleset "nope"/)
  })

  it("rejects an unknown dependency alias", () => {
    const doc = parseIsc(minimalWrap(`stage main { use ghost.rs }`))
    expect(() => expandDocument(doc)).toThrow(/unknown dependency alias "ghost"/)
  })

  it("rejects an unresolvable dependency document", () => {
    const doc = parseIsc(
      minimalWrap(`dependency "lib:missing:Latn:2026" as lib\nstage main { use lib.rs }`),
    )
    expect(() => expandDocument(doc)).toThrow(/cannot resolve dependency/)
  })
})

// ---------------------------------------------------------------------------
// WO18 G5 — use inside parallel/sequence blocks (§3.2): the expansion
// inherits the enclosing pass structure — the target's rule content
// flattens into the enclosing collection; non-rule items (funcalls,
// stage runs) cannot join a pass — named load error.
// ---------------------------------------------------------------------------

describe("use inside parallel/sequence blocks (§3.2)", () => {
  const inSeq = minimalWrap(
    `ruleset r1 { parallel { sub "a" "1" } }\n` +
      `stage main { sequence { use r1\n  sub "b" "2" } }`,
  )
  const inPar = minimalWrap(
    `ruleset r1 { parallel { sub "a" "1" } }\n` +
      `stage main { parallel { use r1\n  sub "b" "2" } }`,
  )
  const inParOvr = minimalWrap(
    `ruleset tbl { parallel { sub "a" "A1"\n  sub "b" "B" } }\n` +
      `stage main { parallel { use tbl override { sub "a" "A2" } } }`,
  )
  const flatSeq = minimalWrap(
    `ruleset tbl { parallel { sub "a" "b"\n  sub "c" "d" } }\n` +
      `stage main { sequence { use tbl\n  sub "e" "E" } }`,
  )

  it("splices the used ruleset's rules into a sequence block, in position", () => {
    // mirrors maps probe tst-use-inseq (rs expects "12")
    expect(run(inSeq, "ab")).toBe("12")
  })

  it("joins the pass: rules from a used ruleset flatten into the enclosing parallel", () => {
    // one simultaneous pass: a→1 and b→2 together
    expect(run(inPar, "ab")).toBe("12")
  })

  it("flattens a used ruleset's parallel block into the sequence's rule list", () => {
    const expanded = expandDocument(parseIsc(flatSeq))
    const seq = expanded.stages[0]!.body[0] as Extract<IscStageItem, { kind: "sequence" }>
    expect(trace([seq])).toEqual(["sequence[a->b, c->d, e->E]"])
  })

  it("merges an override block per-rule on the flat list (child-wins)", () => {
    // replaced row joins the same single pass, after the kept rows
    expect(run(inParOvr, "xa xb")).toBe("xA2 xB")
  })

  it("rejects a non-rule target (funcall in the used ruleset) with a named error", () => {
    const doc = parseIsc(
      minimalWrap(`ruleset tbl { sub "a" "A"\n  upcase }\nstage main { parallel { use tbl } }`),
    )
    expect(() => expandDocument(doc)).toThrow(IscLoadError)
    expect(() => expandDocument(doc)).toThrow(/cannot join the pass/)
  })

  it("rejects a non-rule target reached through nested use", () => {
    const doc = parseIsc(
      minimalWrap(
        `ruleset tbl { sub "a" "A"\n  upcase }\n` +
          `ruleset wrap { use tbl }\nstage main { sequence { use wrap } }`,
      ),
    )
    expect(() => expandDocument(doc)).toThrow(/cannot join the pass/)
  })
})

// ---------------------------------------------------------------------------
// W2 — override merge semantics (§4.2)
// ---------------------------------------------------------------------------

describe("expandDocument — W2 override merge", () => {
  const wrapWithRs = (rsBody: string, useBody: string) =>
    parseIsc(minimalWrap(`ruleset rs {\n${rsBody}\n}\nstage main {\n${useBody}\n}`))

  it("replaces the matching row exactly (child-wins on from-equality)", () => {
    const doc = wrapWithRs(`sub "a" "x"\nsub "b" "y"`, `use rs override {\n  sub "a" "A"\n}`)
    const expanded = expandDocument(doc)
    // kept-in-order then overrides
    expect(trace(expanded.stages[0]!.body)).toEqual(["sub b->y", "sub a->A"])
  })

  it("replaces ALL rows sharing the from-string", () => {
    const doc = wrapWithRs(
      `sub "a" "x"\nsub "a" "x2"\nsub "b" "y"`,
      `use rs override {\n  sub "a" "A"\n}`,
    )
    const expanded = expandDocument(doc)
    expect(trace(expanded.stages[0]!.body)).toEqual(["sub b->y", "sub a->A"])
  })

  it("matches from-equality inside parallel blocks too, keeping block structure", () => {
    const doc = wrapWithRs(
      `parallel {\n  sub "a" "x"\n  sub "b" "y"\n}\nsub "c" "z"`,
      `use rs override {\n  sub "a" "A"\n}`,
    )
    const expanded = expandDocument(doc)
    // the expansion does not END with a parallel block here, so the
    // override rows append after it (fallback path, §4.2.2)
    expect(trace(expanded.stages[0]!.body)).toEqual(["parallel[b->y]", "sub c->z", "sub a->A"])
  })

  it("override rows share the expansion's trailing parallel pass — replacement acts on the source pass (§4.3)", () => {
    // ruleset: generic table ends with a parallel block; the override
    // replaces one of its rows. With the join, the replacement happens
    // in the SAME pass — a row whose longer form exists in the block
    // cannot be preempted by the generic shorter row.
    const src = minimalWrap(
      `ruleset rs {\nparallel {\n  sub "เก" "ke"\n  sub "เกะ" "ke"\n}\n}\nstage main {\nuse rs override {\n  sub "เก" "kē"\n}\n}`,
    )
    const expanded = expandDocument(
      wrapWithRs(
        `parallel {\n  sub "เก" "ke"\n  sub "เกะ" "ke"\n}`,
        `use rs override {\n  sub "เก" "kē"\n}`,
      ),
    )
    // kept row keeps its order; the override joins the same block after it
    expect(trace(expanded.stages[0]!.body)).toEqual(["parallel[เกะ->ke, เก->kē]"])
    // "เกะ" must take its own row in the same pass, not the generic row
    expect(run(src, "เกะ")).toBe("ke")
    expect(run(src, "เก")).toBe("kē")
  })

  it("override rows append as bare rules only when the expansion does not end in parallel", () => {
    const doc = wrapWithRs(`sub "a" "x"`, `use rs override {\n  sub "q" "Q"\n}`)
    const expanded = expandDocument(doc)
    expect(trace(expanded.stages[0]!.body)).toEqual(["sub a->x", "sub q->Q"])
  })

  it("an override row is complete: replaces constraints and may carry its own when", () => {
    const doc = wrapWithRs(`sub "a" "x" before "b"`, `use rs override {\n  sub "a" "A" when kur\n}`)
    const expanded = expandDocument(doc)
    const [rule] = expanded.stages[0]!.body
    expect(rule!.kind).toBe("bare_rule")
    const imported = rule as Extract<IscStageItem, { kind: "bare_rule" }>
    expect(imported.rule.constraints).toHaveLength(0)
    expect(imported.rule.when).toEqual(["kur"])
  })

  it("from-equality is byte-exact — no normalization, constraints do not participate", () => {
    const doc = wrapWithRs(
      `sub "a" "x" before "b"\nsub "e" "y"`,
      `use rs override {\n  sub "a" "A"\n}`,
    )
    const expanded = expandDocument(doc)
    // the constrained a-row is replaced anyway: matching is on from only
    expect(trace(expanded.stages[0]!.body)).toEqual(["sub e->y", "sub a->A"])
  })
})

// ---------------------------------------------------------------------------
// W3 — runtime guard semantics (§5)
// ---------------------------------------------------------------------------

describe("runtime — language guards", () => {
  const LANG_SRC = minimalWrap(`
languages kur chv
stage main {
  parallel {
    sub "қ" "ķ"
    sub "қ" "k̦" when kur
    sub "ҫ" "ş"
    sub "ҫ" "ș" when chv
  }
  sub "ж" "ž" when kur
}`)

  it("no language selected — every guarded rule is inert (§5.4)", () => {
    expect(run(LANG_SRC, "қҫж")).toBe("ķşж")
  })

  it("declared language selected — guard-applicable rows win over same-from generic rows", () => {
    expect(run(LANG_SRC, "қҫж", "main", "kur")).toBe("k̦şž")
    expect(run(LANG_SRC, "қҫж", "main", "chv")).toBe("ķșж")
  })

  it("undeclared language selected — all guarded rules are inert", () => {
    expect(run(LANG_SRC, "қҫж", "main", "xyz")).toBe("ķşж")
  })

  it("sequence blocks skip inert guarded rules in order", () => {
    const src = minimalWrap(`
languages kur
stage main {
  sequence {
    sub "a" "b"
    sub "b" "c" when kur
    sub "c" "d"
  }
}`)
    // kur:     a→b, then b→c (guard applies), then c→d  =>  "d"
    // no lang: a→b, guarded rule inert, no c present    =>  "b"
    expect(run(src, "a", "main", "kur")).toBe("d")
    expect(run(src, "a")).toBe("b")
  })

  it("guard precedence holds regardless of declaration order (guarded AFTER generic)", () => {
    const srcGuardedFirst = minimalWrap(`
languages kur
stage main {
  parallel {
    sub "x" "X" when kur
    sub "x" "G"
  }
}`)
    const srcGuardedLast = minimalWrap(`
languages kur
stage main {
  parallel {
    sub "x" "G"
    sub "x" "X" when kur
  }
}`)
    expect(run(srcGuardedFirst, "x", "main", "kur")).toBe("X")
    expect(run(srcGuardedLast, "x", "main", "kur")).toBe("X")
    expect(run(srcGuardedFirst, "x")).toBe("G")
    expect(run(srcGuardedLast, "x")).toBe("G")
  })

  it("guarded rules apply inside sequences for the selected language", () => {
    const src = minimalWrap(`
languages kur
stage main {
  sequence {
    sub "s" "S" when kur
    sub "t" "T"
  }
}`)
    // kur:      s→S (guard applies), t→T          =>  "ST"
    // no lang:  guarded rule inert, t→T (unguarded) =>  "sT"
    expect(run(src, "st", "main", "kur")).toBe("ST")
    expect(run(src, "st")).toBe("sT")
  })

  it("an override row's when guard applies to that row alone (§5.3)", () => {
    const doc = parseIsc(
      minimalWrap(
        `languages kur\nruleset rs { sub "a" "x" }\nstage main { use rs override { sub "a" "A" when kur } }`,
      ),
    )
    const json = iscToCompiledMap(doc)
    const map = normaliseMap(json)
    // The override REPLACES the imported row wholesale (§4.2 rule 3), so
    // with the guard inert no row for "a" applies at all.
    expect(executeStage(map, "main", "a")).toBe("a")
    expect(executeStage(map, "main", "a", undefined, "kur")).toBe("A")
  })

  it("guards compose across a run into a dependency map", () => {
    const libSrc = `system "lib:guarded:Latn:2026" {\nlanguages kur\nstage main {\n  parallel {\n    sub "x" "X" when kur\n    sub "x" "G"\n  }\n}\n}`
    const doc = parseIsc(
      minimalWrap(
        `dependency "lib:guarded:Latn:2026" as lib\nstage main { run map.lib.stage.main }`,
      ),
    )
    const libJson = iscToCompiledMap(parseIsc(libSrc))
    const json = iscToCompiledMap(doc)
    const libMap = normaliseMap(libJson)
    const loader = {
      load: (code: string) => (code === "lib:guarded:Latn:2026" ? libMap : undefined),
    }
    const map = normaliseMap(json)
    expect(executeStage(map, "main", "x", loader)).toBe("G")
    expect(executeStage(map, "main", "x", loader, "kur")).toBe("X")
  })
})

// ---------------------------------------------------------------------------
// IR shape — additive only (interscript.maps.ir.v1)
// ---------------------------------------------------------------------------

describe("iscToCompiledMap — IR extensions", () => {
  it("carries languages and when into the IR", () => {
    const src = minimalWrap(`
languages kur chv
stage main {
  parallel {
    sub "a" "x" when kur
    sub "b" "y"
  }
}`)
    const json = iscToCompiledMap(parseIsc(src))
    expect(json.languages).toEqual(["kur", "chv"])
    const stage = json.stages[0]!
    const parallel = stage.rules[0] as {
      kind: "parallel"
      rules: ReadonlyArray<{ kind: string; when?: readonly string[] }>
    }
    expect(parallel.rules[0]!.when).toEqual(["kur"])
    expect(parallel.rules[1]!.when).toBeUndefined()
  })

  it("emits NO new keys for a legacy map (byte-identical JSON shape)", () => {
    const legacy = minimalWrap(`
metadata {
  name Legacy
}
stage main {
  parallel {
    sub "a" "x" before "b"
  }
  run map.some-dep.stage.main
}`)
    const json = iscToCompiledMap(parseIsc(legacy))
    const s = JSON.stringify(json)
    expect(s).not.toContain('"languages"')
    expect(s).not.toContain('"when"')
    // key order preserved
    expect(Object.keys(json)).toEqual([
      "schemaVersion",
      "systemCode",
      "dependencies",
      "metadata",
      "stages",
      "aliases",
      "functions",
    ])
  })

  it("keeps the IR flat — no ruleset or use nodes survive", () => {
    const src = minimalWrap(`
ruleset rs { sub "a" "x" }
stage main { use rs }`)
    const json = iscToCompiledMap(parseIsc(src))
    const s = JSON.stringify(json)
    expect(s).not.toContain('"use"')
    expect(s).not.toContain('"ruleset"')
    expect(json.stages[0]!.rules[0]).toMatchObject({
      kind: "sub",
      from: { kind: "string", value: "a" },
    })
  })
})

// ---------------------------------------------------------------------------
// Cross-checks
// ---------------------------------------------------------------------------

describe("expandDocument — toResolved helper parity", () => {
  it("expandDocument output converts to the same IR the converter produces internally", () => {
    const src = minimalWrap(`ruleset rs { sub "a" "x" }\nstage main { use rs }`)
    const doc: IscDocument = parseIsc(src)
    const direct = iscToCompiledMap(doc)
    const viaExpand = iscToCompiledMap(expandDocument(doc))
    expect(JSON.stringify(viaExpand)).toBe(JSON.stringify(direct))
  })
})
