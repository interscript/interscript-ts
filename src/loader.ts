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

export class MapLoader {
  private readonly strategies: LoadStrategy[]
  private readonly cache = new Map<SystemCode, CompiledMap>()

  constructor(strategies: LoadStrategy[]) {
    this.strategies = strategies
  }

  load(systemCode: SystemCode): CompiledMap {
    const cached = this.cache.get(systemCode)
    if (cached) return cached

    for (const strategy of this.strategies) {
      const result = strategy(systemCode)
      if (result) {
        this.cache.set(systemCode, result)
        return result
      }
    }
    throw new MapNotFoundError(systemCode)
  }

  /** Force-clear the cache. Useful in tests. */
  clear(): void {
    this.cache.clear()
  }
}
