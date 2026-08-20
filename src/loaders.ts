/**
 * Map loading strategies — pluggable sources for compiled maps.
 *
 * Adding a new source (e.g. remote URL, custom bundle): add a function
 * to this file returning a `LoadStrategy`. Existing strategies don't
 * change (OCP).
 */

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import type { CompiledMap, CompiledMapJson, LoadStrategy, SystemCode } from "./index.js"
import type { CompiledMapBuilder } from "./types.js"

/**
 * Convert raw JSON IR (as emitted by the Ruby compiler) into the runtime
 * CompiledMap shape. Reconstructs Map objects for aliases and functions.
 *
 * Single responsibility: shape normalisation. No I/O.
 */
export function normaliseMap(json: CompiledMapJson): CompiledMap {
  const out = {
    schemaVersion: json.schemaVersion,
    systemCode: json.systemCode,
    dependencies: json.dependencies,
    stages: json.stages,
    aliases: new Map(Object.entries(json.aliases)),
    functions: new Map(),
  } as CompiledMapBuilder
  if (json.metadata) out.metadata = json.metadata
  return out
}

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
 * Load maps from a JSON dictionary bundled at build time. Useful for
 * browser bundles and tests.
 */
export function bundledStrategy(maps: Record<string, CompiledMapJson>): LoadStrategy {
  const normalised = new Map<string, CompiledMap>()
  for (const [code, json] of Object.entries(maps)) {
    normalised.set(code, normaliseMap(json))
  }
  return (systemCode: SystemCode): CompiledMap | undefined => normalised.get(systemCode)
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
