/**
 * Mutable execution context — passed through interpreter invocations.
 *
 * Holds the in-flight string, the active compiled map, and the alias
 * resolution cache. Pure data; mutation happens only via well-defined
 * helpers so behaviour stays predictable.
 */

import type { CompiledMap, Item } from "../types.js"

export class ExecutionContext {
  /** Current working string the interpreter is transforming. */
  current: string

  /** Map currently being executed. */
  readonly map: CompiledMap

  /** Lazily-resolved aliases. */
  private readonly aliasCache = new Map<string, Item>()

  /** Function cache so repeated function calls don't re-resolve. */
  readonly functions: CompiledMap["functions"]

  constructor(map: CompiledMap, initial: string) {
    this.map = map
    this.current = initial
    this.functions = map.functions
  }

  resolveAlias(name: string): Item | undefined {
    if (this.aliasCache.has(name)) return this.aliasCache.get(name)
    const resolved = this.map.aliases.get(name)
    if (resolved) this.aliasCache.set(name, resolved)
    return resolved
  }

  withString(s: string): ExecutionContext {
    const next = new ExecutionContext(this.map, s)
    next.aliasCache.clear()
    return next
  }
}
