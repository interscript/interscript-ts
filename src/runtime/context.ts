/**
 * Mutable execution context — passed through interpreter invocations.
 *
 * Holds the in-flight string, the active compiled map, and the alias
 * resolution cache. Pure data; mutation happens only via well-defined
 * helpers so behaviour stays predictable.
 */

import type { CompiledMap, Item } from "../types.js"
import type { MapLoader } from "../loader.js"

export class ExecutionContext {
  /** Current working string the interpreter is transforming. */
  current: string

  /** Map currently being executed. */
  readonly map: CompiledMap

  /** Optional loader — used to resolve run-rule dependencies. */
  private readonly loader: MapLoader | undefined

  /** Lazily-resolved aliases. */
  private readonly aliasCache = new Map<string, Item>()

  /** Function cache so repeated function calls don't re-resolve. */
  readonly functions: CompiledMap["functions"]

  constructor(map: CompiledMap, initial: string, loader?: MapLoader) {
    this.map = map
    this.current = initial
    this.functions = map.functions
    this.loader = loader
  }

  resolveAlias(name: string): Item | undefined {
    if (this.aliasCache.has(name)) return this.aliasCache.get(name)
    // Try the current map's aliases first
    let resolved = this.map.aliases.get(name)
    // If not found, try dependency maps' aliases (transitive resolution)
    if (!resolved && this.loader) {
      for (const dep of this.map.dependencies) {
        try {
          const depMap = this.loader.load(dep)
          const depAlias = depMap.aliases.get(name)
          if (depAlias) {
            resolved = depAlias
            break
          }
        } catch {
          // dependency not loadable; skip
        }
      }
    }
    if (resolved) this.aliasCache.set(name, resolved)
    return resolved
  }

  /**
   * Spawn a new context for a different map (used by `run` rule with docName).
   * Reuses the same loader; fresh alias cache.
   */
  withMap(map: CompiledMap): ExecutionContext {
    return new ExecutionContext(map, this.current, this.loader)
  }

  /**
   * Load a dependency map via the configured loader. Throws if no loader.
   */
  loadDependency(systemCode: string): CompiledMap {
    if (!this.loader) {
      throw new Error(`Cannot resolve dependency ${systemCode}: no loader configured`)
    }
    return this.loader.load(systemCode)
  }
}
