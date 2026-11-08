/**
 * Contextual (before/after-constrained) rule regression specs.
 *
 * Root cause regression (2026-11): an IMPORTED charset alias (a
 * dependency map's alias resolving to a plain string, e.g. unicode's
 * `greek`) used in a class position — a constraint (before/not_before/
 * after/not_after) or an any() argument — compiled as a literal
 * SEQUENCE of the whole charset instead of a per-character SET. The
 * resulting lookbehind/lookahead could never match, silently disabling
 * every constrained rule built on it (alalc-ell-Grek-Latn-2010's
 * medial γκ → nk rules never fired).
 *
 * RS parity (interscript-rs builder.rs):
 *   - convert_class_alias: imported Item::Str charsets expand one entry
 *     per char in class context; LOCAL string aliases stay sequences;
 *   - convert_any_arg: alias entries class-resolve everywhere (from,
 *     constraints); concatenation entries stay sequence-resolved;
 *   - constraints materialize in class context (materialize_class);
 *     from/to materialize in sequence context.
 *
 * The five alalc-ell-Grek-Latn-2010 golden divergences this fixes:
 *   Λαγκαδάς → Lankadas, Παγκράτι → Pankrati, Νταγκεστάν → Ḏankestan,
 *   Κονγκό → Konnko, γκέγκε → gkenke (and Χονγκ Κονγκ → Chongk Kongk,
 *   which must keep its word-final γκ → "gk").
 */

import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, existsSync } from "fs"
import { join } from "path"
import { iscBundledStrategy } from "../../src/isc/loader.ts"
import { configure, transliterate } from "../../src/index.ts"

// -- Shared fixture: a charset library map (mirrors maps/libs/unicode.isc) --

const LIB_CODE = "ts-constraint-lib"
const LIB_SRC = `system "${LIB_CODE}" {
aliases {
  vowels = "aeiou"
  upper = "KQV"
}
}`

function configureWith(lib: boolean, sources: Record<string, string>): void {
  const all = lib ? { ...sources, [LIB_CODE]: LIB_SRC } : sources
  configure({ strategies: [iscBundledStrategy(all)] })
}

describe("constraints — imported charset alias in class position", () => {
  it("before any(charset) matches a single set char (root-cause shape)", () => {
    configureWith(true, {
      "ts-constraint-class-ctx": `system "ts-constraint-class-ctx" {
dependency "${LIB_CODE}"
stage main {
  sub {
    from "x"
    to "X"
    before any(vowels)
  }
}
}`,
    })
    // before = lookbehind: the set char must PRECEDE the match.
    expect(transliterate("ts-constraint-class-ctx", "ax")).toBe("aX")
    expect(transliterate("ts-constraint-class-ctx", "ux")).toBe("uX")
    // "q" is not in the set — with the sequence bug this rule could
    // NEVER fire at all; here it must fire on set membership only.
    expect(transliterate("ts-constraint-class-ctx", "qx")).toBe("qx")
  })

  it("from any(charset) matches a single set char", () => {
    configureWith(true, {
      "ts-constraint-from-any": `system "ts-constraint-from-any" {
dependency "${LIB_CODE}"
stage main {
  sub {
    from any(vowels)
    to "-"
  }
}
}`,
    })
    expect(transliterate("ts-constraint-from-any", "abc")).toBe("-bc")
  })

  it("to any(charset) replaces with the first set char (nth_string)", () => {
    configureWith(true, {
      "ts-constraint-to-any": `system "ts-constraint-to-any" {
dependency "${LIB_CODE}"
stage main {
  sub {
    from "q"
    to any(upper)
  }
}
}`,
    })
    expect(transliterate("ts-constraint-to-any", "qq")).toBe("KK")
  })

  it("a sum constraint keeps per-char semantics for its charset part", () => {
    // Mirrors alalc-ell-Grek-Latn-2010's after any("κΚ") + any(greek).
    configureWith(true, {
      "ts-constraint-sum": `system "ts-constraint-sum" {
dependency "${LIB_CODE}"
stage main {
  sub {
    from "g"
    to "n"
    after any("kK") + any(upper)
  }
}
}`,
    })
    expect(transliterate("ts-constraint-sum", "agKQ")).toBe("anKQ")
    // a is not in the upper set — no fire
    expect(transliterate("ts-constraint-sum", "agKa")).toBe("agKa")
    // k (small) is in any("kK") but Q is needed after it
    expect(transliterate("ts-constraint-sum", "agkQ")).toBe("ankQ")
  })

  it("a sum with boundary protects word-final positions (ell Χονγκ shape)", () => {
    configureWith(true, {
      "ts-constraint-boundary-sum": `system "ts-constraint-boundary-sum" {
dependency "${LIB_CODE}"
stage main {
  sub {
    from "g"
    to "n"
    before any(upper)
    after any("kK") + boundary
  }
}
}`,
    })
    // g followed by word-final k — the after-sum blocks: g stays
    expect(transliterate("ts-constraint-boundary-sum", "xgk x")).toBe("xgk x")
    // g preceded by a capital and followed by word-final k — both
    // constraints hold: fires
    expect(transliterate("ts-constraint-boundary-sum", "Qgk x")).toBe("Qnk x")
    // k not word-final — the after-sum fails: no fire
    expect(transliterate("ts-constraint-boundary-sum", "Qgka")).toBe("Qgka")
    // lowercase predecessor — before any(upper) fails: no fire
    expect(transliterate("ts-constraint-boundary-sum", "qgk x")).toBe("qgk x")
  })
})

describe("constraints — before + after combined, capital variants", () => {
  it("applies both lookarounds and discriminates case-variant rules", () => {
    configureWith(false, {
      "ts-constraint-combined": `system "ts-constraint-combined" {
stage main {
  sub {
    from "s"
    to "1"
    before "k"
    after "a"
  }
  sub {
    from "s"
    to "2"
    before "K"
    after "a"
  }
}
}`,
    })
    expect(transliterate("ts-constraint-combined", "ksa")).toBe("k1a")
    expect(transliterate("ts-constraint-combined", "Ksa")).toBe("K2a")
    expect(transliterate("ts-constraint-combined", "ksb")).toBe("ksb")
    expect(transliterate("ts-constraint-combined", "asa")).toBe("asa")
  })
})

describe("constraints — sequence context preserved (RS parity)", () => {
  it("a LOCAL string alias in class position stays a sequence", () => {
    // RS convert_class_alias: only IMPORTED charsets expand per-char;
    // a local alias keeps its materialized shape (Str = sequence).
    configureWith(false, {
      "ts-constraint-local-alias": `system "ts-constraint-local-alias" {
aliases { loc = "ab" }
stage main {
  sub {
    from "s"
    to "S"
    before loc
  }
}
}`,
    })
    expect(transliterate("ts-constraint-local-alias", "abs")).toBe("abS")
    expect(transliterate("ts-constraint-local-alias", "as")).toBe("as")
  })
})

// -- Full-path regression: the real alalc-ell-Grek-Latn-2010 map --

// MAPS_ROOT overrides the sibling-checkout root — used by scratch
// baselines that run this spec from a worktree outside the monorepo.
const MONOREPO_ROOT = process.env.MAPS_ROOT ?? join(__dirname, "..", "..", "..")
const MAPS_DIR = join(MONOREPO_ROOT, "maps", "maps")
const LIBS_DIR = join(MONOREPO_ROOT, "maps", "libs")

describe("constraints — alalc-ell-Grek-Latn-2010 full path", () => {
  const ELL = "alalc-ell-Grek-Latn-2010"

  function configureEll(): boolean {
    if (!existsSync(MAPS_DIR) || !existsSync(LIBS_DIR)) return false
    const sources: Record<string, string> = {}
    for (const dir of [MAPS_DIR, LIBS_DIR]) {
      for (const f of readdirSync(dir).filter((f) => f.endsWith(".isc"))) {
        sources[f.replace(/\.isc$/, "")] = readFileSync(join(dir, f), "utf8")
      }
    }
    configure({ strategies: [iscBundledStrategy(sources)] })
    return true
  }

  it("renders medial γκ as nk through the constrained rules", () => {
    if (!configureEll()) {
      console.warn("skip: no sibling maps checkout")
      return
    }
    // The five golden divergences fixed by class-context compilation.
    expect(transliterate(ELL, "Λαγκαδάς")).toBe("Lankadas")
    expect(transliterate(ELL, "Παγκράτι")).toBe("Pankrati")
    expect(transliterate(ELL, "Νταγκεστάν")).toBe("Ḏankestan")
    expect(transliterate(ELL, "Κονγκό")).toBe("Konnko")
    expect(transliterate(ELL, "γκέγκε")).toBe("gkenke")
    // Word-final γκ keeps "gk" — the not_after-boundary sum blocks.
    expect(transliterate(ELL, "Χονγκ Κονγκ")).toBe("Chongk Kongk")
    // Capital Γ at word start has no lookbehind — unconstrained "G".
    expect(transliterate(ELL, "Γκαμπόν")).toBe("Gkampon")
  })
})
