/**
 * HTTP map loading strategy — fetches map IR from a base URL on demand.
 *
 * Browser-safe: uses the global `fetch()`. Suitable for browser bundles,
 * Cloudflare Workers, Deno, Bun. Node 18+ also has global fetch.
 *
 * Two-tier caching: in-memory (instant) + optional persistent via
 * localStorage (survives reloads). Set `cacheKeyPrefix` to enable.
 */

import type { CompiledMap, CompiledMapJson, LoadStrategy, SystemCode } from "./index.js"
import { normaliseMap } from "./loaders.js"

export interface HttpStrategyOptions {
  /**
   * Base URL or function returning a URL for a given system code.
   * Defaults to `/maps/${code}.json` (works with the interscript.org
   * deployment).
   */
  readonly baseUrl?: string | ((code: SystemCode) => string)
  /**
   * Optional request init passed to fetch() (headers, mode, etc.).
   */
  readonly fetchInit?: RequestInit
  /**
   * Persistent cache prefix. When set, fetched maps are stored in
   * localStorage so they survive page reloads. Disabled by default.
   */
  readonly cacheKeyPrefix?: string
}

interface CacheEntry {
  readonly schemaVersion: 1
  readonly fetchedAt: number
  readonly json: CompiledMapJson
}

const MAX_CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

function resolveUrl(code: SystemCode, baseUrl: HttpStrategyOptions["baseUrl"]): string {
  if (typeof baseUrl === "function") return baseUrl(code)
  if (baseUrl) return baseUrl.replace(/\/$/, "") + "/" + code + ".json"
  return `/maps/${code}.json`
}

function readPersistent(prefix: string, code: SystemCode): CacheEntry | undefined {
  if (typeof localStorage === "undefined") return undefined
  try {
    const raw = localStorage.getItem(prefix + code)
    if (!raw) return undefined
    const entry = JSON.parse(raw) as CacheEntry
    if (Date.now() - entry.fetchedAt > MAX_CACHE_AGE_MS) return undefined
    return entry
  } catch {
    return undefined
  }
}

function writePersistent(prefix: string, code: SystemCode, json: CompiledMapJson): void {
  if (typeof localStorage === "undefined") return
  try {
    const entry: CacheEntry = {
      schemaVersion: 1,
      fetchedAt: Date.now(),
      json,
    }
    localStorage.setItem(prefix + code, JSON.stringify(entry))
  } catch {
    // Quota exceeded or serialization failure — silently drop.
  }
}

/**
 * Strategy that fetches map IR over HTTP on demand.
 *
 * Async: returns a Promise. Use `MapLoader.loadAsync()` or
 * `InterscriptRuntime.transliterate()` (which auto-awaits async
 * strategies when present).
 *
 * Caching:
 *   - In-memory: every fetched map stays in the loader's cache for
 *     the lifetime of the page/process.
 *   - Persistent: optional localStorage cache (set `cacheKeyPrefix`)
 *     so maps don't re-fetch on subsequent visits.
 */
export function httpStrategy(options: HttpStrategyOptions = {}): LoadStrategy {
  const inMemory = new Map<SystemCode, CompiledMap>()
  return async (systemCode: SystemCode): Promise<CompiledMap | undefined> => {
    const cached = inMemory.get(systemCode)
    if (cached) return cached

    if (options.cacheKeyPrefix) {
      const entry = readPersistent(options.cacheKeyPrefix, systemCode)
      if (entry) {
        const map = normaliseMap(entry.json)
        inMemory.set(systemCode, map)
        return map
      }
    }

    const url = resolveUrl(systemCode, options.baseUrl)
    let res: Response
    try {
      res = await fetch(url, options.fetchInit)
    } catch {
      return undefined
    }
    if (!res.ok) return undefined
    const json = (await res.json()) as CompiledMapJson
    if (options.cacheKeyPrefix) writePersistent(options.cacheKeyPrefix, systemCode, json)
    const map = normaliseMap(json)
    inMemory.set(systemCode, map)
    return map
  }
}
