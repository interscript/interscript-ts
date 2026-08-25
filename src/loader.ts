/**
 * Map loader — resolves a system code to a compiled map.
 *
 * Strategy pattern: maps can be loaded from different sources. Each
 * strategy is a function `(systemCode) => CompiledMap | undefined`
 * (sync) or `Promise<CompiledMap | undefined>` (async). Loader
 * composes strategies in priority order.
 *
 * Async strategies (e.g. HTTP fetch) are tried after sync ones. If an
 * async strategy is needed, callers must use `loadAsync()` /
 * `transliterate()` will throw a `MapNotInCacheError` so the caller
 * can preload and retry.
 *
 * Adding a new source: add a function to the strategies list.
 * Existing strategies don't change (OCP).
 */

import type { CompiledMap, SystemCode } from "./types.js"
import { MapNotFoundError } from "./errors.js"

export type LoadStrategy = ((
  systemCode: SystemCode,
) => CompiledMap | undefined | Promise<CompiledMap | undefined>)

interface MapLoaderOptions {
  /** Called when a map is first loaded so the loader can track it. */
  readonly onLoaded?: (systemCode: SystemCode, map: CompiledMap) => void
}

export class MapLoader {
  private readonly strategies: LoadStrategy[]
  private readonly cache = new Map<SystemCode, CompiledMap>()
  /** Tracks everything we've EVER loaded (even after cache clear). */
  private readonly known = new Map<SystemCode, CompiledMap>()
  private readonly options: MapLoaderOptions

  constructor(strategies: LoadStrategy[], options: MapLoaderOptions = {}) {
    this.strategies = strategies
    this.options = options
  }

  /**
   * Synchronous load. Returns the cached map or attempts sync
   * strategies. Throws MapNotFoundError if no sync strategy resolves
   * the code (use loadAsync for async strategies like HTTP).
   */
  load(systemCode: SystemCode): CompiledMap {
    const cached = this.cache.get(systemCode)
    if (cached) return cached
    const known = this.known.get(systemCode)
    if (known) {
      this.cache.set(systemCode, known)
      return known
    }

    for (const strategy of this.strategies) {
      const result = strategy(systemCode)
      // Promise results can't be handled synchronously — skip.
      if (result && typeof (result as Promise<CompiledMap>).then !== "function") {
        const map = result as CompiledMap
        this.cache.set(systemCode, map)
        this.known.set(systemCode, map)
        this.options.onLoaded?.(systemCode, map)
        return map
      }
    }
    throw new MapNotFoundError(systemCode)
  }

  /**
   * Async load. Tries every strategy in order, awaiting async ones.
   * Use this when the strategy set includes HTTP or other async loaders.
   */
  async loadAsync(systemCode: SystemCode): Promise<CompiledMap> {
    const cached = this.cache.get(systemCode)
    if (cached) return cached
    const known = this.known.get(systemCode)
    if (known) {
      this.cache.set(systemCode, known)
      return known
    }

    for (const strategy of this.strategies) {
      const result = await strategy(systemCode)
      if (result) {
        this.cache.set(systemCode, result)
        this.known.set(systemCode, result)
        this.options.onLoaded?.(systemCode, result)
        return result
      }
    }
    throw new MapNotFoundError(systemCode)
  }

  /** Force-clear the in-memory cache (keeps `known` registry). */
  clear(): void {
    this.cache.clear()
  }

  /** All system codes ever loaded. */
  loadedMaps(): readonly SystemCode[] {
    return Array.from(this.known.keys())
  }

  /** Register a map directly (bypasses strategies). */
  register(systemCode: SystemCode, map: CompiledMap): void {
    this.known.set(systemCode, map)
    this.cache.set(systemCode, map)
  }
}
