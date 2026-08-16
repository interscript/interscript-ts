/**
 * models.yaml resolution (the dynamic-fetch contract shared with the
 * Python and Ruby runtimes): resolve id -> channel URL, verify a cached
 * copy against the index sha256, or download -> verify -> install.
 *
 * Node persists to ~/.cache/interscript/models/<id>/ (fs, atomic
 * rename); browsers keep the verified bytes in memory (the Cache API
 * integration is future work). Overrides: INTERSCRIPT_ML_INDEX,
 * INTERSCRIPT_ML_CACHE.
 */

import { load as loadYaml } from "js-yaml"

export const DEFAULT_INDEX_URL =
  "https://raw.githubusercontent.com/interscript/ml-models/main/models.yaml"

export interface IndexEntry {
  filename: string
  url: string
  sha256: string
}

export class RegistryError extends Error {}

interface NodeFs {
  readFileSync(path: string): Uint8Array
  writeFileSync(path: string, data: Uint8Array): void
  mkdirSync(path: string, opts: { recursive: boolean }): void
  renameSync(from: string, to: string): void
  existsSync(path: string): boolean
}

async function nodeFs(): Promise<NodeFs | undefined> {
  const g = globalThis as { process?: { versions?: { node?: string } } }
  if (!g.process?.versions?.node) return undefined
  return (await import("node:fs")) as unknown as NodeFs
}

function cacheDir(): string {
  const home = process.env["HOME"] ?? process.env["USERPROFILE"] ?? "."
  return process.env["INTERSCRIPT_ML_CACHE"] ?? `${home}/.cache/interscript`
}

async function fetchIndex(source: string): Promise<Record<string, IndexEntry>> {
  const text = source.startsWith("http://") || source.startsWith("https://")
    ? await (await fetch(source)).text()
    : new TextDecoder().decode((await nodeFs())!.readFileSync(source))
  const raw = loadYaml(text) as { version?: number; models?: Record<string, Record<string, string>> }
  if (raw.version !== 1) throw new RegistryError("index must have version: 1")
  const entries: Record<string, IndexEntry> = {}
  for (const [id, spec] of Object.entries(raw.models ?? {})) {
    entries[id] = { filename: spec["filename"]!, url: spec["url"]!, sha256: spec["sha256"]! }
  }
  return entries
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(data).buffer as ArrayBuffer)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("")
}

export interface ResolvedZip {
  bytes: Uint8Array
  path?: string
}

export async function resolve(
  modelId: string,
  indexUrl?: string,
): Promise<ResolvedZip> {
  const source = indexUrl ?? process.env["INTERSCRIPT_ML_INDEX"] ?? DEFAULT_INDEX_URL
  const entries = await fetchIndex(source)
  const entry = entries[modelId]
  if (!entry) {
    throw new RegistryError(`unknown model id '${modelId}' (known: ${Object.keys(entries).sort().join(", ")})`)
  }

  const fs = await nodeFs()
  const target = `${cacheDir()}/models/${modelId}/${entry.filename}`
  if (fs?.existsSync(target)) {
    const cached = fs.readFileSync(target)
    if ((await sha256Hex(cached)) === entry.sha256) return { bytes: cached, path: target }
  }

  const bytes = entry.url.startsWith("file://")
    ? fs!.readFileSync(entry.url.replace(/^file:\/\//, ""))
    : new Uint8Array(await (await fetch(entry.url)).arrayBuffer())
  const actual = await sha256Hex(bytes)
  if (actual !== entry.sha256) {
    throw new RegistryError(
      `downloaded ${entry.filename} sha256 mismatch: got ${actual}, index says ${entry.sha256}`,
    )
  }
  if (fs) {
    const dir = target.substring(0, target.lastIndexOf("/"))
    fs.mkdirSync(dir, { recursive: true })
    const tmp = `${target}.part.${process.pid}`
    fs.writeFileSync(tmp, bytes)
    fs.renameSync(tmp, target)
    return { bytes, path: target }
  }
  return { bytes }
}
