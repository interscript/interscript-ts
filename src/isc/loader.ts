/**
 * ISC loader strategy — fetches .isc source files and feeds them to the
 * ISC parser + converter, producing CompiledMap objects for the runtime.
 *
 *   configure({ strategies: [iscStrategy({ baseUrl: "/maps" })] })
 */

import type { CompiledMap, SystemCode } from "../types.js"
import type { LoadStrategy } from "../loader.js"
import { parseIsc } from "./parser.js"
import { iscToCompiledMap } from "./converter.js"
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

  return async (code: SystemCode): Promise<CompiledMap | undefined> => {
    let source: string | undefined

    if (opts.bundled && opts.bundled[code]) {
      source = opts.bundled[code]
    }

    if (!source) {
      try {
        const res = await fetchFn(`${opts.baseUrl}/${code}.isc`)
        if (!res.ok) return undefined
        source = await res.text()
      } catch {
        return undefined
      }
    }

    const doc = parseIsc(source, `${code}.isc`)
    const json = iscToCompiledMap(doc)
    return normaliseMap(json)
  }
}

/**
 * Synchronous strategy for pre-loaded ISC sources.
 * Use in Node.js (read files from disk) or with bundled sources.
 */
export function iscBundledStrategy(sources: Record<string, string>): LoadStrategy {
  return (code: SystemCode): CompiledMap | undefined => {
    const source = sources[code]
    if (!source) return undefined
    const doc = parseIsc(source, `${code}.isc`)
    const json = iscToCompiledMap(doc)
    return normaliseMap(json)
  }
}
