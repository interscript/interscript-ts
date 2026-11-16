/**
 * WO20 reverse-mode golden capture additivity — the TypeScript mirror of
 * interscript-rs tests/golden_reverse_capture.rs and the ruby gate
 * (tools/isc_wf1_golden_gate.rb --reverse).
 *
 * Replays every row of the RS-captured reverse golden file
 * (interscript-rs/tests/golden/isc-reverse.jsonl) through THIS runtime —
 * load the map, reverse the document (dependencies reverse with it),
 * execute the reversed main stage on the row's src — and requires
 * byte-identical output on every row. The golden was captured once by
 * `iscrs capture --reverse`; a delta here is a reverse-parity
 * regression. No adopting-set exemption: the reverse golden has no
 * adoption flow. An execution error replays as `null`, the canonical
 * marker the rs capture records.
 *
 * The row set covers the corpus (sibling maps checkout) plus the rs
 * reverse fixtures (tests/reverse_maps, siblings of the golden file —
 * a corpus map shadows a same-named fixture exactly like the capture's
 * load path).
 *
 * Skips when the sibling interscript-rs / maps checkouts are missing.
 */

import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, existsSync } from "fs"
import { join } from "path"
import { configure, reverse } from "../src/index.ts"
import { iscBundledStrategy } from "../src/isc/loader.ts"

const REPO_ROOT = join(__dirname, "..", "..")
// GOLDEN_ROOT overrides the sibling-checkout root — used by scratch
// baselines that run this spec from a worktree outside the monorepo.
const SIBLING_ROOT = process.env.GOLDEN_ROOT ?? REPO_ROOT
const GOLDEN = join(SIBLING_ROOT, "interscript-rs", "tests", "golden", "isc-reverse.jsonl")
const MAPS_DIR = join(SIBLING_ROOT, "maps", "maps")
const LIBS_DIR = join(SIBLING_ROOT, "maps", "libs")
// The rs reverse fixtures, siblings of the golden file. Appended AFTER
// the corpus so a corpus map shadows a same-named fixture exactly like
// the capture's load path.
const FIXTURES_DIR = join(SIBLING_ROOT, "interscript-rs", "tests", "reverse_maps")

interface GoldenRow {
  readonly map: string
  readonly src: string
  readonly out: string
}

function loadGolden(): GoldenRow[] {
  if (!existsSync(GOLDEN) || !existsSync(MAPS_DIR)) return []
  return readFileSync(GOLDEN, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      const v = JSON.parse(l) as GoldenRow
      return { map: v.map, src: v.src, out: v.out }
    })
}

function configureRuntime(): void {
  const sources: Record<string, string> = {}
  // Corpus first, fixtures after — FIRST-WINS, so a corpus map shadows
  // a same-named fixture exactly like the capture's load path.
  for (const dir of [MAPS_DIR, LIBS_DIR, FIXTURES_DIR]) {
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".isc"))) {
      const id = f.replace(/\.isc$/, "")
      if (id in sources) continue
      sources[id] = readFileSync(join(dir, f), "utf8")
    }
  }
  configure({ strategies: [iscBundledStrategy(sources)] })
}

describe("reverse golden capture — interscript-rs isc-reverse additivity", () => {
  it("replays every reverse golden row byte-identically", () => {
    const rows = loadGolden()
    // Sibling checkouts absent (standalone checkout) — nothing to verify.
    if (rows.length === 0) {
      console.warn("skip: reverse golden capture or sibling maps checkout missing")
      return
    }
    configureRuntime()

    const deltas: string[] = []
    const failedMaps = new Set<string>()
    let checked = 0
    for (const row of rows) {
      let got: string
      try {
        got = reverse(row.map, row.src)
      } catch {
        got = "null"
      }
      checked++
      if (got === row.out) continue
      failedMaps.add(row.map)
      if (deltas.length < 10) {
        deltas.push(
          `${row.map}: ${JSON.stringify(row.src)} -> ${JSON.stringify(got)} (golden ${JSON.stringify(row.out)})`,
        )
      }
    }
    expect(
      [...failedMaps],
      `reverse golden divergence on ${failedMaps.size} map(s); first deltas:\n${deltas.join("\n")}`,
    ).toEqual([])
    expect(checked).toBe(rows.length)
  }, 300_000)
})
