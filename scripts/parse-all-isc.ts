/**
 * Parse every .isc map in ../maps/maps — CI gate for the ISC parser.
 *
 * Run: npx tsx scripts/parse-all-isc.ts
 */
import { readFileSync, readdirSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { parseIsc } from "../src/isc/parser.js"

const HERE = dirname(fileURLToPath(import.meta.url))
const dir = resolve(HERE, "../../maps/maps")
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".isc"))
  .sort()

let ok = 0
for (const f of files) {
  try {
    parseIsc(readFileSync(resolve(dir, f), "utf8"), f)
    ok++
  } catch (e) {
    console.error(`${f}: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  }
}
console.log(`Parsed ${ok}/${files.length} .isc files`)
if (ok !== files.length) process.exit(1)
