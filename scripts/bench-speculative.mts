/**
 * Speculative-decode latency benchmark (TODO.impl/01, lane 1).
 *
 * Wall-clock for the three decode paths on the same paragraphs, warm
 * models, CPU (arm64 / ORT-native): plain 2.1 int8, lite int4, and
 * the speculative pair (lite drafts, 2.1 verifies). Reports per-path
 * totals, tokens/sec, and the speculative acceptance stats.
 *
 *   node scripts/bench-speculative.mts [rows]
 */

import { homedir } from "node:os"
import { join } from "node:path"
import { readFileSync } from "node:fs"
import { IMFModel, SpeculativeModel } from "../src/ml/imf/index.js"

const cache = join(homedir(), ".cache", "secryst", "models")
const zips = {
  lite: join(cache, "ara-diac-layerdrop-1.0-int4", "ara-diac-layerdrop-1.0-int4.zip"),
  full: join(cache, "ara-diac-small-2.1-int8", "ara-diac-small-2.1-int8.zip"),
}
const golden = join(homedir(), "ml-logs", "golden", "ara-diac-layerdrop-1.0-int4.jsonl")

const rowCount = Number(process.argv[2] ?? 10)
const rows = readFileSync(golden, "utf8")
  .split("\n")
  .filter((l) => l.trim())
  .slice(0, rowCount)
  .map((l) => JSON.parse(l) as { input: string })

function stats(times: number[], tokens: number) {
  const total = times.reduce((a, b) => a + b, 0)
  return {
    totalS: +total.toFixed(1),
    meanS: +(total / times.length).toFixed(2),
    tokensPerSec: +(tokens / total).toFixed(0),
  }
}

const lite = await IMFModel.load(zips.lite!)
const full = await IMFModel.load(zips.full!)
const spec = new SpeculativeModel(lite, full)

// warm every path once (session init, first-run allocs)
await lite.translate(rows[0]!.input, 256)
await full.translate(rows[0]!.input, 256)
await spec.translate(rows[0]!.input, 256)

const out: Record<string, ReturnType<typeof stats>> = {}
let specTokens = 0
let accepted = 0
let drafted = 0

{
  const times: number[] = []
  let tokens = 0
  for (const row of rows) {
    const t0 = performance.now()
    const text = await full.translate(row.input, 2048)
    times.push((performance.now() - t0) / 1000)
    tokens += text.length
  }
  out["2.1 int8 (plain)"] = stats(times, tokens)
}
{
  const times: number[] = []
  let tokens = 0
  for (const row of rows) {
    const t0 = performance.now()
    const text = await lite.translate(row.input, 2048)
    times.push((performance.now() - t0) / 1000)
    tokens += text.length
  }
  out["lite int4 (plain)"] = stats(times, tokens)
}
{
  const times: number[] = []
  for (const row of rows) {
    const t0 = performance.now()
    const text = await spec.translate(row.input, 2048)
    times.push((performance.now() - t0) / 1000)
    specTokens += text.length
    const s = spec.stats()!
    accepted += s.accepted
    drafted += s.drafted
  }
  out["2.1 via speculative"] = stats(times, specTokens)
}

console.table(out)
console.log(
  `acceptance ${(accepted / drafted).toFixed(4)} (${accepted}/${drafted}), ` +
    `speedup vs plain 2.1: ${(
      out["2.1 int8 (plain)"]!.totalS / out["2.1 via speculative"]!.totalS
    ).toFixed(2)}x, vs lite: ${(
      out["lite int4 (plain)"]!.totalS / out["2.1 via speculative"]!.totalS
    ).toFixed(2)}x`,
)

await lite.dispose()
await full.dispose()
