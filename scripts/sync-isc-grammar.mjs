#!/usr/bin/env node
// Sync the vendored ISC grammar (src/isc/grammar/grammar-source.ts) from a
// canonical interscript-ruby checkout:
//
//   node scripts/sync-isc-grammar.mjs [path-to-interscript-ruby]
//
// Defaults to the sibling checkout ../interscript-ruby. Rewrites the
// embedded source and the sha256 pin together, so the pin test always
// describes the text that ships.

import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const arg = process.argv[2]
const rubyRoot = resolve(arg ?? "../interscript-ruby")
const pargPath = resolve(rubyRoot, "lib/interscript/isc/grammar/isc.parg")
const outPath = resolve(import.meta.dirname, "../src/isc/grammar/grammar-source.ts")

let src
try {
  src = readFileSync(pargPath, "utf8")
} catch (e) {
  console.error(`sync-isc-grammar: cannot read ${pargPath}: ${e.message}`)
  console.error("sync-isc-grammar: pass the path to an interscript-ruby checkout as argv[1]")
  process.exit(2)
}

const sha = createHash("sha256").update(src).digest("hex")

const out = `/**
 * Vendored copy of the canonical ISC grammar:
 *   interscript-ruby lib/interscript/isc/grammar/isc.parg
 *
 * The .parg file is the single semantic source of the ISC syntax; this
 * module embeds it verbatim (sha256 ${sha}) so the TypeScript parser
 * compiles the same grammar text the Ruby runtime ships. Update procedure:
 *
 *   node scripts/sync-isc-grammar.mjs <path-to-interscript-ruby-checkout>
 *
 * The sync script rewrites this file and the sha256 pin; the pin test
 * (test/isc/grammar-source.test.ts) fails when the embedded text and the
 * recorded hash disagree, so drift is never silent.
 */

/** sha256 of the grammar text embedded below (pin for drift detection). */
export const ISC_PARG_SHA256 = "${sha}"

/** The grammar text itself, byte-identical to the ruby checkout copy. */
export const ISC_PARG_SOURCE = ${JSON.stringify(src)} as string
`

writeFileSync(outPath, out)
console.log(`sync-isc-grammar: wrote ${outPath} (sha256 ${sha})`)
