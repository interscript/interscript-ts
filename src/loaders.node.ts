/**
 * Filesystem-based map loading strategies.
 *
 * SERVER-ONLY: requires `node:fs`, `node:url`, `node:path`. Don't import
 * this from browser bundles — use `bundledStrategy` from `./loaders.js`
 * instead, or pre-bundle the maps with Vite's `import.meta.glob`.
 *
 * The CLI and Node-side test helpers import from here. Browser-safe
 * helpers (`normaliseMap`, `bundledStrategy`) are re-exported so server
 * callers have a single import surface.
 */

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import type { CompiledMap, CompiledMapJson, LoadStrategy, SystemCode } from "./index.js"
import { normaliseMap, bundledStrategy } from "./loaders.js"

// Re-export browser-safe helpers for server callers' convenience.
export { normaliseMap, bundledStrategy }

/**
 * Load maps from a filesystem directory. Each map is `<systemCode>.json`.
 * Throws on filesystem errors but returns `undefined` if the specific
 * file doesn't exist (so other strategies can be tried).
 */
export function filesystemStrategy(mapsDir: string): LoadStrategy {
  return (systemCode: SystemCode): CompiledMap | undefined => {
    const path = resolve(mapsDir, `${systemCode}.json`)
    try {
      const raw = readFileSync(path, "utf8")
      return normaliseMap(JSON.parse(raw) as CompiledMapJson)
    } catch {
      return undefined
    }
  }
}

/**
 * Loader relative to a module URL — handy for test fixtures.
 */
export function relativeFilesystemStrategy(
  relativeTo: string,
  relativePath: string,
): LoadStrategy {
  const base = relativeTo.startsWith("file://") ? dirname(fileURLToPath(relativeTo)) : relativeTo
  return filesystemStrategy(resolve(base, relativePath))
}
