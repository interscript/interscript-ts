/**
 * models.yaml resolution (the dynamic-fetch contract shared with the
 * Python and Ruby runtimes): resolve id -> channel URL, verify a cached
 * copy against the index sha256, or download -> verify -> install.
 *
 * The index itself is a GitHub Release asset (never raw.githubusercontent):
 * DEFAULT_INDEX_URL points at models-index.yaml on an index-vN tag, and
 * HTTP fetches always verify the sibling .sha256 sidecar before parsing.
 *
 * Node persists to ~/.cache/interscript/models/<id>/ (fs, atomic
 * rename); browsers keep the verified bytes in memory (the Cache API
 * integration is future work). Overrides: SECRYST_INDEX,
 * SECRYST_CACHE.
 */

import { load as loadYaml } from "js-yaml"

export const DEFAULT_INDEX_URL =
  "https://github.com/interscript/interscript-ml/releases/download/index-v2/models-index.yaml"

export interface Part {
  url: string
  sha256: string
  size: number
}

export interface IndexEntry {
  filename: string
  url: string
  sha256: string
  parts?: Part[]
}

export class RegistryError extends Error {}

interface NodeFs {
  readFileSync(path: string): Uint8Array
  writeFileSync(path: string, data: Uint8Array): void
  appendFileSync(path: string, data: Uint8Array): void
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
  return process.env["SECRYST_CACHE"] ?? `${home}/.cache/interscript`
}

async function fetchHttpBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url)
  if (!res.ok) throw new RegistryError(`fetch failed: ${url} -> ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

async function fetchIndex(source: string): Promise<Record<string, IndexEntry>> {
  if (source.startsWith("http://") || source.startsWith("https://")) {
    const bytes = await fetchHttpBytes(source)
    const sidecarRes = await fetch(`${corsAssetUrl(source)}.sha256`)
    if (!sidecarRes.ok) {
      throw new RegistryError(
        `index sha256 sidecar missing: ${source}.sha256 -> ${sidecarRes.status}`,
      )
    }
    const expected = (await sidecarRes.text()).trim().split(/\s+/)[0]
    if (!expected || !/^[0-9a-f]{64}$/i.test(expected)) {
      throw new RegistryError(`index sha256 sidecar malformed: ${source}.sha256`)
    }
    const actual = await sha256Hex(bytes)
    if (actual !== expected.toLowerCase()) {
      throw new RegistryError(
        `index sha256 mismatch: got ${actual}, sidecar says ${expected.toLowerCase()}`,
      )
    }
    return fetchIndexFromText(new TextDecoder().decode(bytes))
  }
  const local = new TextDecoder().decode((await nodeFs())!.readFileSync(source))
  return fetchIndexFromText(local)
}

function fetchIndexFromText(text: string): Record<string, IndexEntry> {
  const raw = loadYaml(text) as {
    version?: number
    models?: Record<string, Record<string, string | Part[]>>
  }
  if (raw.version !== 1) throw new RegistryError("index must have version: 1")
  const entries: Record<string, IndexEntry> = {}
  for (const [id, spec] of Object.entries(raw.models ?? {})) {
    const entry: IndexEntry = {
      filename: spec["filename"] as string,
      url: (spec["url"] as string) ?? "",
      sha256: spec["sha256"] as string,
    }
    const parts = spec["parts"] as Part[] | undefined
    if (parts) entry.parts = parts
    entries[id] = entry
  }
  return entries
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(data).buffer as ArrayBuffer)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

async function partBytes(fs: NodeFs | undefined, url: string): Promise<Uint8Array> {
  if (url.startsWith("file://")) {
    if (!fs) throw new RegistryError("file:// parts require a Node host")
    return fs.readFileSync(url.replace(/^file:\/\//, ""))
  }
  return new Uint8Array(await (await fetch(url)).arrayBuffer())
}

async function fetchParts(
  entry: IndexEntry,
  fs: NodeFs | undefined,
  onPart: (bytes: Uint8Array) => void,
): Promise<void> {
  const parts = entry.parts!
  for (let i = 0; i < parts.length; i++) {
    const bytes = await partBytes(fs, parts[i]!.url)
    const actual = await sha256Hex(bytes)
    if (actual !== parts[i]!.sha256) {
      throw new RegistryError(
        `part ${i} of ${entry.filename} sha256 mismatch: got ${actual}, index says ${parts[i]!.sha256}`,
      )
    }
    onPart(bytes)
  }
}

function indexCacheKey(source: string): string {
  return source
}

async function cacheIndexForOffline(source: string): Promise<void> {
  if (typeof caches === "undefined") return
  try {
    const res = await fetch(corsAssetUrl(source))
    if (res.ok) await (await caches.open(CACHE_NAME)).put(indexCacheKey(source), res.clone())
  } catch {
    /* best-effort */
  }
}

async function readCachedIndex(source: string): Promise<Record<string, IndexEntry> | undefined> {
  const cache = await browserCache()
  if (!cache) return undefined
  const hit = await cache.match(indexCacheKey(source))
  if (!hit) return undefined
  try {
    return await fetchIndexFromText(
      new TextDecoder().decode(new Uint8Array(await hit.arrayBuffer())),
    )
  } catch {
    return undefined
  }
}

/** Drop cached zip entries whose (id, filename) no longer matches the
 * current index — sha changes leave orphans otherwise (05). */
async function evictStaleEntries(
  cache: BrowserCache,
  entries: Record<string, IndexEntry>,
): Promise<void> {
  try {
    const keys = await (cache as unknown as { keys(): Promise<readonly unknown[]> }).keys()
    const valid = new Set(Object.entries(entries).map(([id, e]) => cacheKey(id, e.filename)))
    for (const key of keys) {
      const url = String((key as { url?: string }).url ?? key)
      if (url.startsWith("https://imf.interscript.org/cache/") && !valid.has(url)) {
        await cache.delete(url)
      }
    }
  } catch {
    /* best-effort */
  }
}

/** Fetch with progress via a streamed body, resuming across dropped
 * connections with Range requests (TODO.client-work 03/09): a flaky
 * network continues from the received byte offset instead of
 * restarting a 250MB artifact. */
async function fetchWithProgress(
  url: string,
  onProgress?: (fraction: number, bytes: number) => void,
): Promise<Uint8Array> {
  if (!onProgress) return new Uint8Array(await (await fetch(url)).arrayBuffer())
  const chunks: Uint8Array[] = []
  let received = 0
  let total = 0
  for (let attempt = 0; attempt < 5; attempt++) {
    let res: Response
    try {
      res = await fetch(url, received > 0 ? { headers: { range: `bytes=${received}-` } } : {})
    } catch {
      continue
    }
    if (!res.ok && res.status !== 206)
      throw new RegistryError(`fetch failed: ${url} -> ${res.status}`)
    if (received === 0) total = Number(res.headers.get("content-length") ?? 0)
    else if (res.status !== 206) {
      // server ignored Range: restart cleanly rather than corrupt
      chunks.length = 0
      received = 0
      total = Number(res.headers.get("content-length") ?? 0)
    }
    const reader = res.body?.getReader()
    if (!reader) continue
    let dropped = false
    for (;;) {
      try {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        received += value.length
        onProgress(total > 0 ? Math.min(1, received / total) : 0, received)
      } catch {
        dropped = true
        break
      }
    }
    if (!dropped) break
  }
  if (received === 0) {
    throw new RegistryError(`fetch produced zero bytes (5 attempts): ${url}`)
  }
  const out = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

export interface ResolvedZip {
  bytes: Uint8Array
  path?: string
}

/** Browser Cache API persistence: verified model bytes survive page
 * reloads, so a model downloads once per browser. Node hosts persist
 * to the filesystem instead; both paths re-verify against the index
 * sha256 on every use — the cache is never trusted blindly. */

const RELEASE_ORIGIN = "https://github.com/interscript/interscript-ml/releases/download/"
const CORS_FRONT_DOOR = "https://api.interscript.org/v1/assets/"

/** In browsers, GH Releases are not CORS-fetchable (the github.com
 * redirect hop lacks ACAO); rewrite release URLs to the API's
 * streaming front door. Content authenticity is unaffected: the
 * sha256 verification proves whatever channel delivered the bytes. */
export function corsAssetUrl(url: string): string {
  return url.startsWith(RELEASE_ORIGIN) ? CORS_FRONT_DOOR + url.slice(RELEASE_ORIGIN.length) : url
}

const CACHE_NAME = "interscript-imf-models-v1"

// Minimal structural types — the DOM lib isn't in this package's tsconfig
interface BrowserCache {
  match(request: string): Promise<Response | undefined>
  put(request: string, response: Response): Promise<void>
  delete(request: string): Promise<boolean>
}

declare const caches: { open(name: string): Promise<BrowserCache> } | undefined

function cacheKey(modelId: string, filename: string): string {
  return `https://imf.interscript.org/cache/${modelId}/${filename}`
}

async function browserCache(): Promise<BrowserCache | undefined> {
  if (typeof caches === "undefined") return undefined
  return await caches.open(CACHE_NAME)
}

export interface ResolveOptions {
  /** 0..1 download progress (TODO.client-work 03) */
  readonly onProgress?: (fraction: number, bytes: number) => void
}

export async function resolve(
  modelId: string,
  indexUrl?: string,
  opts: ResolveOptions = {},
): Promise<ResolvedZip> {
  const source = indexUrl ?? process.env["SECRYST_INDEX"] ?? DEFAULT_INDEX_URL
  let entries: Record<string, IndexEntry>
  try {
    entries = await fetchIndex(source)
    await cacheIndexForOffline(source)
  } catch (err) {
    // offline-first (05): fall back to the cached index copy
    const cached = await readCachedIndex(source)
    if (!cached) throw err
    entries = cached
  }
  const entry = entries[modelId]
  if (!entry) {
    throw new RegistryError(
      `unknown model id '${modelId}' (known: ${Object.keys(entries).sort().join(", ")})`,
    )
  }

  const fs = await nodeFs()
  const target = `${cacheDir()}/models/${modelId}/${entry.filename}`
  if (fs?.existsSync(target)) {
    const cached = fs.readFileSync(target)
    if ((await sha256Hex(cached)) === entry.sha256) return { bytes: cached, path: target }
  }

  const cache = await browserCache()
  if (cache) {
    const hit = await cache.match(cacheKey(modelId, entry.filename))
    if (hit) {
      const cached = new Uint8Array(await hit.arrayBuffer())
      if ((await sha256Hex(cached)) === entry.sha256) return { bytes: cached }
      await cache.delete(cacheKey(modelId, entry.filename))
    }
    await evictStaleEntries(cache, entries)
  }

  if (entry.parts?.length) {
    if (fs) {
      const { createHash } = await import("node:crypto")
      const whole = createHash("sha256")
      const dir = target.substring(0, target.lastIndexOf("/"))
      fs.mkdirSync(dir, { recursive: true })
      const tmp = `${target}.part.${process.pid}`
      fs.writeFileSync(tmp, new Uint8Array(0))
      await fetchParts(entry, fs, (bytes) => {
        whole.update(bytes)
        fs.appendFileSync(tmp, bytes)
      })
      const actual = whole.digest("hex")
      if (actual !== entry.sha256) {
        throw new RegistryError(
          `assembled ${entry.filename} sha256 mismatch: got ${actual}, index says ${entry.sha256}`,
        )
      }
      fs.renameSync(tmp, target)
      return { bytes: fs.readFileSync(target), path: target }
    }
    // browser: parts are all small (client-tier models); concat in memory
    const chunks: Uint8Array[] = []
    let total = 0
    await fetchParts(entry, fs, (bytes) => {
      chunks.push(bytes)
      total += bytes.length
    })
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.length
    }
    const actual = await sha256Hex(bytes)
    if (actual !== entry.sha256) {
      throw new RegistryError(
        `assembled ${entry.filename} sha256 mismatch: got ${actual}, index says ${entry.sha256}`,
      )
    }
    if (cache) await cache.put(cacheKey(modelId, entry.filename), new Response(bytes))
    return { bytes }
  }

  const bytes = entry.url.startsWith("file://")
    ? fs!.readFileSync(entry.url.replace(/^file:\/\//, ""))
    : await fetchWithProgress(corsAssetUrl(entry.url), opts.onProgress)
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
  if (cache) await cache.put(cacheKey(modelId, entry.filename), new Response(bytes))
  return { bytes }
}
