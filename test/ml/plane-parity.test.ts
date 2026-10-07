/**
 * Neural-parity ts leg (WO14): the same golden sets the ruby and py
 * legs run, same tolerance tiers. Env-gated — CI sets:
 *   INTERSCRIPT_PLANE_ZIP=/tmp/model.zip
 *   INTERSCRIPT_PLANE_GOLDEN=/tmp/golden/set.jsonl
 *   INTERSCRIPT_PARITY_SMOKE=1   (corpus 2%; tight = per-row 2% + 0.5%)
 */

import { existsSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { createPlaneModel } from "../../src/ml/index.js"

const zipPath = process.env["INTERSCRIPT_PLANE_ZIP"]
const goldenPath = process.env["INTERSCRIPT_PLANE_GOLDEN"]
const smoke = process.env["INTERSCRIPT_PARITY_SMOKE"] === "1"

const gated = zipPath && goldenPath && existsSync(zipPath) && existsSync(goldenPath)
  ? describe
  : describe.skip

function lev(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] !== b[j - 1] ? 1 : 0))
    }
    prev.splice(0, prev.length, ...cur)
  }
  return prev[b.length]!
}

gated("neural parity (ts plane leg)", () => {
  it("matches the py-reference golden within the quantized tolerance", { timeout: 900_000 }, async () => {
    const model = await createPlaneModel(new Uint8Array(readFileSync(zipPath!)))
    const rows = readFileSync(goldenPath!, "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as { input: string; output: string })

    let corpusErrors = 0
    let corpusChars = 0
    let worstRowRate = 0
    for (const row of rows) {
      const out = await model.transform(row.input)
      const dist = lev(out, row.output)
      corpusErrors += dist
      corpusChars += row.output.length
      worstRowRate = Math.max(worstRowRate, dist / Math.max(1, row.output.length))
    }
    const corpusRate = corpusErrors / Math.max(1, corpusChars)
    if (smoke) {
      expect(corpusRate).toBeLessThan(0.02)
    } else {
      expect(worstRowRate).toBeLessThan(0.02)
      expect(corpusRate).toBeLessThan(0.005)
    }
    await model.dispose()
  })
})
