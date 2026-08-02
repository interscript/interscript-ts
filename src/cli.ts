#!/usr/bin/env node
/**
 * interscript-ts CLI — transliteration power tool.
 *
 * Subcommands:
 *   interscript-ts transliterate <systemCode> [options]   (alias: t)
 *   interscript-ts batch <systemCode> <inputFile>         (alias: b)
 *   interscript-ts list                                    (alias: l)
 *   interscript-ts detect <input> <output>                 (alias: d)
 *
 * Global options:
 *   --maps-dir <dir>     Directory containing <systemCode>.json IR files
 *   --http <url>         Load maps from HTTP base URL (default /maps)
 *   --no-cache           Skip persistent cache (HTTP loader)
 *   -h, --help           Show this help
 *
 * Examples:
 *   echo "Антон" | interscript-ts t bgnpcgn-ukr-Cyrl-Latn-2019
 *   interscript-ts t bgnpcgn-ukr-Cyrl-Latn-2019 -i input.txt -o output.txt
 *   interscript-ts batch bgnpcgn-ukr-Cyrl-Latn-2019 names.txt --csv
 *   interscript-ts list --authority bgnpcgn --source-script Cyrl
 *   interscript-ts detect "Антон" "Anton" --maps-dir ./ir
 */

import { parseArgs } from "node:util"
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import {
  configure,
  reset,
  transliterate,
  transliterateAsync,
  detect,
  httpStrategy,
  type LoadStrategy,
} from "./index.js"
import { filesystemStrategy, normaliseMap } from "./loaders.node.js"

interface GlobalOpts {
  mapsDir?: string | undefined
  http?: string | undefined
  noCache: boolean
}

function buildStrategies(opts: GlobalOpts): LoadStrategy[] {
  if (opts.http) {
    const httpOpts: { baseUrl: string; cacheKeyPrefix?: string } = { baseUrl: opts.http }
    if (!opts.noCache) httpOpts.cacheKeyPrefix = "isx-cli:"
    return [httpStrategy(httpOpts)]
  }
  if (opts.mapsDir) {
    return [filesystemStrategy(opts.mapsDir)]
  }
  // Default: try filesystem in CWD, fall back to HTTP from interscript.org.
  const httpOpts: { baseUrl: string; cacheKeyPrefix?: string } = {
    baseUrl: "https://interscript.org/maps",
  }
  if (!opts.noCache) httpOpts.cacheKeyPrefix = "isx-cli:"
  return [
    filesystemStrategy(resolve(process.cwd(), "maps")),
    filesystemStrategy(resolve(process.cwd(), "public/maps")),
    httpStrategy(httpOpts),
  ]
}

function readStdin(): string {
  try {
    return readFileSync(0, "utf8")
  } catch {
    return ""
  }
}

function parseGlobalOpts(args: string[]): { opts: GlobalOpts; rest: string[] } {
  const opts: GlobalOpts = { noCache: false }
  const rest: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === "--maps-dir") {
      opts.mapsDir = args[++i]
    } else if (a === "--http") {
      opts.http = args[++i]
    } else if (a === "--no-cache") {
      opts.noCache = true
    } else {
      rest.push(a)
    }
  }
  return { opts, rest }
}

function loadCatalogue(mapsDir: string): Array<{ code: string; metadata?: Record<string, unknown> }> {
  const out: Array<{ code: string; metadata?: Record<string, unknown> }> = []
  for (const f of readdirSync(mapsDir)) {
    if (!f.endsWith(".json")) continue
    const code = f.replace(/\.json$/, "")
    try {
      const json = JSON.parse(readFileSync(resolve(mapsDir, f), "utf8"))
      out.push({ code, metadata: json.metadata })
    } catch {
      out.push({ code })
    }
  }
  return out
}

async function cmdTransliterate(args: string[], opts: GlobalOpts): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      input: { type: "string", short: "i" },
      output: { type: "string", short: "o" },
    },
    allowPositionals: true,
    strict: true,
  })
  const systemCode = positionals[0]
  if (!systemCode) {
    process.stderr.write("Error: systemCode is required as the first positional arg\n")
    return 1
  }

  reset()
  configure({ strategies: buildStrategies(opts) })

  const inputText = values.input
    ? readFileSync(resolve(process.cwd(), values.input), "utf8")
    : readStdin()

  try {
    const useAsync = !!opts.http || (!opts.mapsDir && !existsSync(resolve(process.cwd(), "maps")) && !existsSync(resolve(process.cwd(), "public/maps")))
    const result = useAsync
      ? await transliterateAsync(systemCode, inputText)
      : transliterate(systemCode, inputText)
    if (values.output) {
      writeFileSync(resolve(process.cwd(), values.output), result + "\n")
    } else {
      process.stdout.write(result + "\n")
    }
    return 0
  } catch (e) {
    process.stderr.write(`Error: ${(e as Error).message}\n`)
    return 1
  }
}

async function cmdBatch(args: string[], opts: GlobalOpts): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      output: { type: "string", short: "o" },
      csv: { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: true,
  })
  const [systemCode, inputFile] = positionals
  if (!systemCode || !inputFile) {
    process.stderr.write("Usage: interscript-ts batch <systemCode> <inputFile> [--csv]\n")
    return 1
  }
  if (!existsSync(resolve(process.cwd(), inputFile))) {
    process.stderr.write(`Error: input file not found: ${inputFile}\n`)
    return 2
  }

  reset()
  configure({ strategies: buildStrategies(opts) })

  const lines = readFileSync(resolve(process.cwd(), inputFile), "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  const rows: Array<{ input: string; output: string; error?: string }> = []
  for (const input of lines) {
    try {
      const output = await transliterateAsync(systemCode, input)
      rows.push({ input, output })
    } catch (e) {
      rows.push({ input, output: "", error: (e as Error).message })
    }
  }

  const fmtRow = (r: (typeof rows)[number]) =>
    values.csv
      ? `"${r.input}","${r.output}","${r.error ?? ""}"`
      : `${r.input}\t${r.output}${r.error ? `\t⚠ ${r.error}` : ""}`

  const text = rows.map(fmtRow).join("\n") + "\n"
  if (values.output) {
    writeFileSync(resolve(process.cwd(), values.output), text)
  } else {
    process.stdout.write(text)
  }
  process.stderr.write(`Processed ${rows.length} lines\n`)
  return 0
}

function cmdList(args: string[], opts: GlobalOpts): number {
  const { values } = parseArgs({
    args,
    options: {
      authority: { type: "string" },
      "source-script": { type: "string" },
      "destination-script": { type: "string" },
    },
    allowPositionals: true,
    strict: true,
  })
  // List requires a local maps dir — HTTP can't enumerate.
  const mapsDir = opts.mapsDir ?? resolve(process.cwd(), "maps")
  if (!existsSync(mapsDir)) {
    process.stderr.write(
      `Error: --maps-dir required (or run from a directory containing ./maps).\n`,
    )
    return 2
  }
  const entries = loadCatalogue(mapsDir)
  const filtered = entries.filter((e) => {
    if (!e.metadata) return true
    if (values.authority && e.metadata.authority_id !== values.authority) return false
    if (values["source-script"] && e.metadata.source_script !== values["source-script"]) return false
    if (values["destination-script"] && e.metadata.destination_script !== values["destination-script"]) return false
    return true
  })
  for (const e of filtered) {
    const meta = e.metadata as { authority_id?: string; source_script?: string; destination_script?: string; name?: string } | undefined
    const auth = meta?.authority_id ?? "?"
    const pair = meta ? `${meta.source_script}→${meta.destination_script}` : ""
    const name = meta?.name ?? ""
    process.stdout.write(`${e.code}\t${auth}\t${pair}\t${name}\n`)
  }
  process.stderr.write(`${filtered.length} systems\n`)
  return 0
}

async function cmdDetect(args: string[], opts: GlobalOpts): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      "max-results": { type: "string", default: "10" },
    },
    allowPositionals: true,
    strict: true,
  })
  const [input, output] = positionals
  if (!input || !output) {
    process.stderr.write("Usage: interscript-ts detect <input> <output>\n")
    return 1
  }

  reset()
  configure({ strategies: buildStrategies(opts) })

  const mapsDir = opts.mapsDir ?? resolve(process.cwd(), "maps")
  if (!existsSync(mapsDir)) {
    process.stderr.write(`Error: detect needs a local maps directory (--maps-dir).\n`)
    return 2
  }

  // Detect only works against pre-loaded maps; load them all.
  const codes = readdirSync(mapsDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
  process.stderr.write(`Loading ${codes.length} maps…\n`)

  const results = detect(input, output, {})
  const max = parseInt(values["max-results"]!, 10)
  for (const r of results.slice(0, max)) {
    process.stdout.write(`${r.distance}\t${r.mapName}\n`)
  }
  return 0
}

function showHelp(): void {
  process.stdout.write(`interscript-ts — transliteration CLI

Usage:
  interscript-ts <command> [options]

Commands:
  transliterate <systemCode> [-i FILE] [-o FILE]   Transliterate text (alias: t)
  batch <systemCode> <inputFile> [--csv] [-o FILE] Bulk process many lines (alias: b)
  list [--authority X] [--source-script X]         List available systems (alias: l)
  detect <input> <output>                          Find best-matching system (alias: d)

Global options:
  --maps-dir <dir>    Directory of <systemCode>.json IR files
  --http <url>        Load maps from HTTP base URL
  --no-cache          Skip persistent cache (HTTP loader)
  -h, --help          Show this help

Map source resolution (first match wins):
  1. --maps-dir <dir>
  2. --http <url>
  3. ./maps/ in the current directory
  4. ./public/maps/ in the current directory
  5. https://interscript.org/maps/ (with cache)

Examples:
  echo "Антон" | interscript-ts t bgnpcgn-ukr-Cyrl-Latn-2019
  interscript-ts t bgnpcgn-ukr-Cyrl-Latn-2019 -i in.txt -o out.txt
  interscript-ts b bgnpcgn-ukr-Cyrl-Latn-2019 names.txt --csv > out.csv
  interscript-ts l --authority bgnpcgn --source-script Cyrl
  interscript-ts d "Антон" "Anton" --maps-dir ./ir
`)
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
    showHelp()
    process.exit(argv.length === 0 ? 1 : 0)
  }

  const command = argv[0]!
  const { opts, rest } = parseGlobalOpts(argv.slice(1))

  const aliasMap: Record<string, string> = {
    t: "transliterate",
    b: "batch",
    l: "list",
    d: "detect",
  }
  const cmd = aliasMap[command] ?? command

  let exit = 0
  switch (cmd) {
    case "transliterate":
      exit = await cmdTransliterate(rest, opts)
      break
    case "batch":
      exit = await cmdBatch(rest, opts)
      break
    case "list":
      exit = cmdList(rest, opts)
      break
    case "detect":
      exit = await cmdDetect(rest, opts)
      break
    default:
      process.stderr.write(`Unknown command: ${command}\n\n`)
      showHelp()
      exit = 1
  }
  process.exit(exit)
}

await main()
