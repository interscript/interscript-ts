#!/usr/bin/env node
/**
 * interscript-ts CLI — transliterate from the command line.
 *
 * Usage:
 *   interscript-ts -s <systemCode> [-i <input>] [-o <output>] [--maps-dir <dir>]
 *
 * If -i is omitted, reads from stdin.
 * If -o is omitted, writes to stdout.
 */

import { parseArgs } from "node:util"
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { configure, reset, transliterate } from "./index.js"
import { filesystemStrategy } from "./loaders.node.js"

const { values } = parseArgs({
  options: {
    "system-code": { type: "string", short: "s" },
    input: { type: "string", short: "i" },
    output: { type: "string", short: "o" },
    "maps-dir": { type: "string" },
    help: { type: "boolean", short: "h" },
  },
  strict: true,
})

if (values.help || !values["system-code"]) {
  process.stdout.write(
    `Usage: interscript-ts -s <systemCode> [-i <input>] [-o <output>] [--maps-dir <dir>]

Options:
  -s, --system-code   Transliteration system code (e.g. bgnpcgn-ukr-Cyrl-Latn-2019)
  -i, --input         Input file (reads from stdin if omitted)
  -o, --output        Output file (writes to stdout if omitted)
  --maps-dir          Directory containing <systemCode>.json IR files
  -h, --help          Show this help
`,
  )
  process.exit(values.help ? 0 : 1)
}

const mapsDir = values["maps-dir"]
  ? resolve(process.cwd(), values["maps-dir"])
  : undefined

if (mapsDir && !existsSync(mapsDir)) {
  process.stderr.write(`Error: maps directory not found: ${mapsDir}\n`)
  process.exit(2)
}

reset()
if (mapsDir) {
  configure({ strategies: [filesystemStrategy(mapsDir)] })
}

const inputText = values.input
  ? readFileSync(resolve(process.cwd(), values.input), "utf8")
  : readFileSync(0, "utf8")

try {
  const result = transliterate(values["system-code"]!, inputText)
  if (values.output) {
    writeFileSync(resolve(process.cwd(), values.output), result + "\n")
  } else {
    process.stdout.write(result + "\n")
  }
} catch (e) {
  process.stderr.write(`Error: ${(e as Error).message}\n`)
  process.exit(1)
}
