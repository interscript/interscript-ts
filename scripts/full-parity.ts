/**
 * Full-parity runner: loads all Ruby-generated fixtures and runs them
 * through interscript-ts, comparing against Ruby's output.
 *
 * Run: npx tsx scripts/full-parity.ts
 */
import { readFileSync, readdirSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { configure, reset, transliterate } from "../src/index.js"
import { filesystemStrategy } from "../src/loaders.node.js"

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = resolve(HERE, "../test/fixtures/full-parity.json")
const IR_DIR = resolve(HERE, "../../interscript.org/public/maps")

interface Fixture {
  system_code: string
  input: string
  expected: string
  ruby_actual: string
}
interface Payload {
  samples: Fixture[]
  skipped: { system_code: string; input: string; error: string }[]
}

const payload = JSON.parse(readFileSync(FIXTURES, "utf8")) as Payload

const irMaps = new Set(
  readdirSync(IR_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, "")),
)

reset()
configure({ strategies: [filesystemStrategy(IR_DIR)] })

const tested: { system_code: string; input: string; expected: string; actual: string }[] = []
const skippedFixtures: { system_code: string; input: string; reason: string }[] = []

for (const fx of payload.samples) {
  if (!irMaps.has(fx.system_code)) {
    skippedFixtures.push({ system_code: fx.system_code, input: fx.input, reason: "no IR" })
    continue
  }
  let actual: string
  try {
    actual = transliterate(fx.system_code, fx.input)
  } catch (e) {
    skippedFixtures.push({
      system_code: fx.system_code,
      input: fx.input,
      reason: (e as Error).message,
    })
    continue
  }
  if (actual !== fx.ruby_actual) {
    tested.push({
      system_code: fx.system_code,
      input: fx.input,
      expected: fx.ruby_actual,
      actual,
    })
  }
}

const grouped = new Map<string, { count: number; first: typeof tested[number] }>()
for (const t of tested) {
  const existing = grouped.get(t.system_code)
  if (existing) existing.count++
  else grouped.set(t.system_code, { count: 1, first: t })
}

console.log("=== Full Parity Report ===")
console.log(`Total samples tested: ${payload.samples.length - skippedFixtures.length}`)
console.log(`Diffs: ${tested.length} across ${grouped.size} maps`)
console.log()
console.log("Maps with diffs:")
for (const [code, info] of [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`  ${code} (${info.count} diffs)`)
  console.log(`    input:    ${JSON.stringify(info.first.input)}`)
  console.log(`    expected: ${JSON.stringify(info.first.expected)}`)
  console.log(`    actual:   ${JSON.stringify(info.first.actual)}`)
}

const skippedByReason = new Map<string, number>()
for (const s of skippedFixtures) {
  skippedByReason.set(s.reason, (skippedByReason.get(s.reason) ?? 0) + 1)
}
console.log()
console.log("Skipped (top reasons):")
for (const [reason, count] of [...skippedByReason.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`  ${count} — ${reason.slice(0, 100)}`)
}

console.log()
const passRate = (
  ((payload.samples.length - skippedFixtures.length - tested.length) /
    (payload.samples.length - skippedFixtures.length)) *
  100
).toFixed(1)
console.log(`Pass rate: ${passRate}%`)
