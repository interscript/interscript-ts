/**
 * Detector — finds which transliteration system best explains how
 * `input` became `output`.
 *
 * Mirrors `interscript-ruby/lib/interscript/detector.rb` semantics:
 * iterate every known map, transliterate `input` through it, compute
 * Levenshtein distance to `output`, return ranked candidates.
 */

import type { DetectionResult, DetectOptions, SystemCode } from "./types.js"
import type { MapLoader } from "./loader.js"
import { executeStage } from "./runtime/interpreter.js"
import { InterscriptError } from "./errors.js"

/**
 * Compute Levenshtein edit distance between two strings.
 * Classic dynamic programming, O(m·n) time and O(min(m,n)) space.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  let prev = new Array<number>(b.length + 1)
  let curr = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(
        prev[j]! + 1, // deletion
        curr[j - 1]! + 1, // insertion
        prev[j - 1]! + cost, // substitution
      )
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[b.length]!
}

/** Convert a glob (`*` wildcard) into a RegExp. */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")
  return new RegExp(`^${escaped}$`)
}

/**
 * Run detect against every map the loader knows. Caller may pass an
 * explicit `knownMaps` iterable to restrict the scan (e.g. a curated
 * shortlist for performance).
 */
export function detectInMaps(
  input: string,
  output: string,
  loader: MapLoader,
  opts: DetectOptions = {},
  knownMaps?: Iterable<SystemCode>,
): DetectionResult[] {
  const candidates: DetectionResult[] = []
  const filter = opts.mapPattern ? globToRegExp(opts.mapPattern) : null
  const systems = knownMaps ?? loader.loadedMaps()

  for (const systemCode of systems) {
    if (filter && !filter.test(systemCode)) continue

    let transliterated: string
    try {
      const map = loader.load(systemCode)
      transliterated = executeStage(map, "main", input, loader)
    } catch (e) {
      if (e instanceof InterscriptError) continue
      throw e
    }
    candidates.push({
      mapName: systemCode,
      distance: levenshtein(transliterated, output),
    })
  }

  return candidates.sort((a, b) => a.distance - b.distance)
}
