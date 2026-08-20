/**
 * Map loader — resolves a system code to a compiled map.
 *
 * Strategy pattern: maps can be loaded from different sources. Each
 * strategy is a pure function `(systemCode) => CompiledMap | undefined`.
 * Loader composes them in priority order.
 *
 * Adding a new source (e.g. URL fetch, custom bundle): add a function
 * to the strategies list. Existing strategies don't change (OCP).
 */

import type { CompiledMap, SystemCode } from "./types.js"
import { MapNotFoundError } from "./errors.js"

export type LoadStrategy = (systemCode: SystemCode) => CompiledMap | undefined

/**
 * Registry of pre-loaded maps. Strategies can push into this so the
 * detector can enumerate known maps without re-reading source data.
 */
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
      if (result) {
        this.cache.set(systemCode, result)
        this.known.set(systemCode, result)
        this.options.onLoaded?.(systemCode, result)
        return result
      }
    }
    throw new MapNotFoundError(systemCode)
  }

  /** Force-clear the in-memory cache (keeps `known` registry). Useful in tests. */
  clear(): void {
    this.cache.clear()
  }

  /** All system codes ever loaded. Available even after cache clear. */
  loadedMaps(): readonly SystemCode[] {
    return Array.from(this.known.keys())
  }

  /** Register a map directly (bypasses strategies). Used by bundled-map consumers. */
  register(systemCode: SystemCode, map: CompiledMap): void {
    this.known.set(systemCode, map)
    this.cache.set(systemCode, map)
  }
}
