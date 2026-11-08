/**
 * ISC-WF-0 golden capture additivity — the TypeScript mirror of
 * interscript-rs tests/golden_capture.rs.
 *
 * Replays every row of the RS-captured golden file
 * (interscript-rs/tests/golden/isc-wf0.jsonl) through THIS runtime and
 * requires byte-identical output on every row. The golden is the
 * cross-runtime contract: a delta here is a runtime regression (or a
 * newly-fixed divergence being adopted into the golden).
 *
 * Skips when the sibling interscript-rs / maps checkouts are missing.
 */

import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, existsSync } from "fs"
import { join } from "path"
import { configure, transliterate } from "../src/index.ts"
import { iscBundledStrategy } from "../src/isc/loader.ts"

const REPO_ROOT = join(__dirname, "..", "..")
// GOLDEN_ROOT overrides the sibling-checkout root — used by scratch
// baselines that run this spec from a worktree outside the monorepo.
const SIBLING_ROOT = process.env.GOLDEN_ROOT ?? REPO_ROOT
const GOLDEN = join(SIBLING_ROOT, "interscript-rs", "tests", "golden", "isc-wf0.jsonl")
const MAPS_DIR = join(SIBLING_ROOT, "maps", "maps")
const LIBS_DIR = join(SIBLING_ROOT, "maps", "libs")

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
  for (const dir of [MAPS_DIR, LIBS_DIR]) {
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".isc"))) {
      sources[f.replace(/\.isc$/, "")] = readFileSync(join(dir, f), "utf8")
    }
  }
  configure({ strategies: [iscBundledStrategy(sources)] })
}

describe("golden capture — interscript-rs isc-wf0 additivity", () => {
  it("replays every golden row byte-identically", () => {
    const rows = loadGolden()
    // Sibling checkouts absent (standalone checkout) — nothing to verify.
    if (rows.length === 0) {
      console.warn("skip: golden capture or sibling maps checkout missing")
      return
    }
    configureRuntime()

    const deltas: string[] = []
    const failedMaps = new Set<string>()
    let checked = 0
    for (const row of rows) {
      let got: string
      try {
        got = transliterate(row.map, row.src)
      } catch (e) {
        got = `\0error:${(e as Error).message}`
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
      `golden divergence on ${failedMaps.size} map(s); first deltas:\n${deltas.join("\n")}`,
    ).toEqual([])
    expect(checked).toBe(rows.length)
  }, 120_000)
})
