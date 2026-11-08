#!/usr/bin/env node
// ISC-WF-1 additivity gate (spec §7) — golden capture + zero-delta check.
//
// Runs every row of the frozen golden capture (produced by interscript-rs
// tests/golden/isc-wf0.jsonl: {map, src, out}) through THIS runtime and
// verifies byte-identical output on maps that use none of the WF-1
// constructs (ruleset / use / override / languages / when).
//
// Usage:
//   node scripts/wf1-gate.mjs capture <out.jsonl>   # write computed outputs
//   node scripts/wf1-gate.mjs check <baseline.jsonl> # zero-delta vs a prior capture
//   node scripts/wf1-gate.mjs parity                # delta count vs the rs golden
//   node scripts/wf1-gate.mjs parse                 # parse the whole corpus
//
// Environment:
//   GOLDEN_JSONL   path to isc-wf0.jsonl (default: ../interscript-rs/tests/golden/)
//   MAPS_CORPUS    maps dir (default: ../maps/maps)
//   MAPS_LIBS      libs dir (default: ../maps/libs)

import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const mapsDir = process.env.MAPS_CORPUS ?? resolve(repoRoot, "..", "maps", "maps")
const libsDir = process.env.MAPS_LIBS ?? resolve(repoRoot, "..", "maps", "libs")
const goldenPath =
  process.env.GOLDEN_JSONL ?? resolve(repoRoot, "..", "interscript-rs", "tests", "golden", "isc-wf0.jsonl")

const [, , mode, arg] = process.argv
if (!mode || (mode !== "parse" && mode !== "parity" && !arg)) {
  console.error("usage: wf1-gate.mjs capture|check <file.jsonl> | parity | parse")
  process.exit(2)
}

function loadSources() {
  const sources = {}
  let count = 0
  for (const dir of [mapsDir, libsDir]) {
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".isc"))) {
      const code = basename(f, ".isc")
      sources[code] = readFileSync(join(dir, f), "utf8")
      count++
    }
  }
  return { sources, count }
}

// The WF-1 construct tokens — the adopting set is any corpus file whose
// source contains them OUTSIDE metadata prose. The gate treats a map as
// adopting if the raw source mentions them at line start (prose lines in
// metadata are consumed as raw text by the parser and never dispatch).
const WF1_TOKENS = /^\s*(ruleset\s|use\s|override\s|languages\s|when\s)/m

function goldenRows() {
  if (!existsSync(goldenPath)) {
    console.error(`golden not found: ${goldenPath}`)
    process.exit(1)
  }
  return readFileSync(goldenPath, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l))
}

async function run() {
  const { parseIsc } = await import(new URL("../src/isc/parser.ts", import.meta.url))
  const { iscBundledStrategy } = await import(new URL("../src/isc/loader.ts", import.meta.url))
  const { configure, transliterate } = await import(new URL("../src/index.ts", import.meta.url))

  const { sources, count } = loadSources()

  if (mode === "parse") {
    let ok = 0
    const failures = []
    for (const [code, src] of Object.entries(sources)) {
      try {
        parseIsc(src, `${code}.isc`)
        ok++
      } catch (e) {
        failures.push(`${code}: ${e.message}`)
      }
    }
    console.log(`parsed ${ok}/${count} corpus files`)
    if (failures.length > 0) {
      console.log("FAILURES:\n" + failures.join("\n"))
      process.exit(1)
    }
    return
  }

  configure({ strategies: [iscBundledStrategy(sources)] })
  const rows = goldenRows()
  const computed = []
  let errors = 0
  for (const row of rows) {
    let out
    try {
      out = transliterate(row.map, row.src)
    } catch (e) {
      out = `__ERROR__:${e.message}`
      errors++
    }
    computed.push({ map: row.map, src: row.src, out })
  }

  if (mode === "parity") {
    // Cross-runtime audit against the rs-produced golden (informational:
    // pre-existing divergences on origin/main are not gate failures).
    let delta = 0
    const mismatched = new Set()
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].out !== computed[i].out) {
        delta++
        mismatched.add(computed[i].map)
      }
    }
    console.log(
      `cross-runtime parity vs rust golden: ${rows.length - delta}/${rows.length} rows match ` +
        `(${delta} delta on ${mismatched.size} maps, ${errors} errors)`,
    )
    if (mismatched.size > 0) console.log(`divergent maps: ${[...mismatched].sort().join(", ")}`)
    return
  }

  if (mode === "capture") {
    writeFileSync(
      arg,
      computed.map((r) => JSON.stringify(r)).join("\n") + "\n",
    )
    const digest = createHash("sha256")
      .update(computed.map((r) => JSON.stringify(r)).join("\n"))
      .digest("hex")
    console.log(
      `captured ${computed.length} rows (${errors} errors) -> ${arg}\ndigest: ${digest}`,
    )
    return
  }

  // check mode: compare a fresh capture against a previously captured
  // baseline of THIS runtime (the additivity gate — zero delta required).
  // Use `capture` + `diff` against interscript-rs' golden to audit
  // cross-runtime parity separately.
  let baseline
  try {
    baseline = readFileSync(arg, "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l))
  } catch {
    console.error(`cannot read baseline capture: ${arg}`)
    process.exit(1)
  }
  if (baseline.length !== computed.length) {
    console.error(`row count mismatch: baseline ${baseline.length} vs computed ${computed.length}`)
    process.exit(1)
  }
  let delta = 0
  const samples = []
  for (let i = 0; i < computed.length; i++) {
    const b = baseline[i]
    const c = computed[i]
    if (b.map !== c.map || b.src !== c.src) {
      console.error(`row ${i}: map/src mismatch against baseline`)
      process.exit(1)
    }
    if (b.out !== c.out) {
      delta++
      if (samples.length < 10) {
        samples.push(
          `${c.map} "${c.src.slice(0, 24)}": baseline "${b.out.slice(0, 40)}" vs got "${c.out.slice(0, 40)}"`,
        )
      }
    }
  }
  const digest = createHash("sha256")
    .update(computed.map((r) => JSON.stringify(r)).join("\n"))
    .digest("hex")
  console.log(
    `checked ${computed.length} rows against baseline: ${delta} delta, ${errors} errors\ndigest: ${digest}`,
  )
  if (samples.length > 0) console.log("sample deltas:\n" + samples.join("\n"))
  process.exit(delta === 0 ? 0 : 1)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
