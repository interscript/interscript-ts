/**
 * ISC loader strategy — fetches .isc source files and feeds them to the
 * ISC parser + converter, producing CompiledMap objects for the runtime.
 *
 *   configure({ strategies: [iscStrategy({ baseUrl: "/maps" })] })
 *
 * ISC-WF-1: ruleset uses across a dependency boundary (`use
 * <alias>.<ruleset>`) are resolved at compile time, so the strategies
 * pre-fetch and parse the needed dependency sources and hand the
 * converter a resolver (declared dependencies only, §3.3).
 */

import type { CompiledMap, SystemCode } from "../types.js"
import type { LoadStrategy } from "../loader.js"
import { parseIsc } from "./parser.js"
import { iscToCompiledMap } from "./converter.js"
import { requiredDependencyDocs, type DependencyDocResolver } from "./expand.js"
import type { IscDocument } from "./types.js"
import { normaliseMap } from "../loaders.js"

export interface IscStrategyOptions {
  /** Base URL for fetching .isc files, e.g. "/maps" */
  baseUrl: string
  /** Fetch function (defaults to global fetch) */
  readonly fetchFn?: typeof fetch
  /** Pre-loaded ISC sources: { "system-code": "isc source text" } */
  readonly bundled?: Record<string, string>
}

export function iscStrategy(opts: IscStrategyOptions): LoadStrategy {
  const fetchFn = opts.fetchFn ?? fetch.bind(globalThis)

  const fetchSource = async (code: SystemCode): Promise<string | undefined> => {
    if (opts.bundled && opts.bundled[code]) return opts.bundled[code]
    try {
      const res = await fetchFn(`${opts.baseUrl}/${code}.isc`)
      if (!res.ok) return undefined
      return await res.text()
    } catch {
      return undefined
    }
  }

  return async (code: SystemCode): Promise<CompiledMap | undefined> => {
    const source = await fetchSource(code)
    if (!source) return undefined

    const doc = parseIsc(source, `${code}.isc`)
    // WF-1: pre-fetch dependency docs the map's `use` directives need
    // (recursively — a dependency's ruleset may itself use another of
    // its dependencies' rulesets). Legacy maps need nothing here.
    const parsedDocs = new Map<string, IscDocument>()
    const queue = requiredDependencyDocs(doc)
    while (queue.length > 0) {
      const target = queue.shift()!
      if (parsedDocs.has(target)) continue
      const depSource = await fetchSource(target)
      if (!depSource) continue // unresolvable deps surface as IscLoadError if referenced
      const depDoc = parseIsc(depSource, `${target}.isc`)
      parsedDocs.set(target, depDoc)
      for (const t of requiredDependencyDocs(depDoc)) {
        if (!parsedDocs.has(t)) queue.push(t)
      }
    }
    const resolveDependency: DependencyDocResolver = (target) => parsedDocs.get(target)

    const json = iscToCompiledMap(doc, { resolveDependency })
    return normaliseMap(json)
  }
}

/**
 * Synchronous strategy for pre-loaded ISC sources.
 * Use in Node.js (read files from disk) or with bundled sources.
 */
export function iscBundledStrategy(sources: Record<string, string>): LoadStrategy {
  const parsedCache = new Map<string, IscDocument>()
  const resolveDependency: DependencyDocResolver = (target) => {
    if (parsedCache.has(target)) return parsedCache.get(target)
    const source = sources[target]
    if (!source) return undefined
    const doc = parseIsc(source, `${target}.isc`)
    parsedCache.set(target, doc)
    return doc
  }
  return (code: SystemCode): CompiledMap | undefined => {
    const source = sources[code]
    if (!source) return undefined
    const doc = parseIsc(source, `${code}.isc`)
    const json = iscToCompiledMap(doc, { resolveDependency })
    return normaliseMap(json)
  }
}
