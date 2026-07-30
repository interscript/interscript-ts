/**
 * Public API surface of Interscript-TS.
 *
 * Mirrors `interscript-ruby/lib/interscript.rb`:
 *   - transliterate(systemCode, input)
 *   - loadMap(systemCode)
 *   - detect(input, output)
 *
 * The runtime is configured with a MapLoader. Callers can supply their
 * own (e.g. for browser fetch, for fs reads) without modifying the
 * interpreter (OCP).
 */

import type {
  CompiledMap,
  DetectionResult,
  DetectOptions,
  SystemCode,
} from "./types.js"
import { MapLoader, type LoadStrategy } from "./loader.js"
import { executeStage } from "./runtime/interpreter.js"
import {
  DependencyMissingError,
  InterscriptError,
  MapNotFoundError,
  SystemConversionError,
} from "./errors.js"
import { detectInMaps } from "./detector.js"

export {
  InterscriptError,
  MapNotFoundError,
  SystemConversionError,
  DependencyMissingError,
  MapLogicError,
} from "./errors.js"
export type {
  CompiledMap,
  CompiledMapJson,
  DetectionResult,
  DetectOptions,
  FunctionDef,
  MapInfo,
  SystemCode,
  Stage,
  Rule,
  Item,
  SubRule,
  RunRule,
  FuncallRule,
  ParallelRule,
  SequentialRule,
  StringItem,
  CaptureGroupItem,
  CaptureRefItem,
  AliasItem,
  AnyItem,
  GroupItem,
  RepeatItem,
  StageItem,
} from "./types.js"
export type { LoadStrategy, MapLoader } from "./loader.js"
// Only re-export browser-safe loaders from the main entry. Filesystem
// strategies live in `./loaders.node.ts` and pull in `node:fs`; importing
// them via the main entry would break browser bundles. Node callers
// (CLI, server tests) should import directly from `./loaders.node.js`.
export { normaliseMap, bundledStrategy } from "./loaders.js"

export interface InterscriptConfig {
  /** Strategies consulted in order when loading a map. */
  readonly strategies?: LoadStrategy[]
  /** Default stage to execute if not specified. Default: "main". */
  readonly defaultStage?: string
}

const DEFAULT_STAGE = "main"

class InterscriptRuntime {
  private readonly loader: MapLoader
  private readonly defaultStage: string

  constructor(config: InterscriptConfig = {}) {
    this.loader = new MapLoader(config.strategies ?? [])
    this.defaultStage = config.defaultStage ?? DEFAULT_STAGE
  }

  /**
   * Pre-load a map so subsequent transliterate() calls are fast.
   * Throws MapNotFoundError if the map can't be located.
   */
  loadMap(systemCode: SystemCode): CompiledMap {
    const map = this.loader.load(systemCode)
    for (const dep of map.dependencies) {
      try {
        this.loader.load(dep)
      } catch (e) {
        if (e instanceof MapNotFoundError) {
          throw new DependencyMissingError(dep)
        }
        throw e
      }
    }
    return map
  }

  /**
   * Transliterate `input` using `systemCode`. Loads the map on first use,
   * caches it.
   */
  transliterate(systemCode: SystemCode, input: string, stage?: string): string {
    try {
      const map = this.loadMap(systemCode)
      const stageName = stage ?? this.defaultStage
      return executeStage(map, stageName, input, this.loader)
    } catch (e) {
      if (e instanceof InterscriptError) throw e
      throw new SystemConversionError(
        `Transliteration failed for ${systemCode}: ${(e as Error).message}`,
        { cause: e },
      )
    }
  }

  /** List all maps currently loaded in the cache. */
  loadedMaps(): readonly SystemCode[] {
    return this.loader.loadedMaps()
  }

  /** Direct loader access (for detector + advanced use). */
  getLoader(): MapLoader {
    return this.loader
  }

  /**
   * Detect which transliteration system best explains how `input` became
   * `output`. Returns candidates ranked by edit distance.
   *
   * Iterates every loaded map; for large map sets, supply `mapPattern`
   * to pre-filter.
   */
  detect(
    input: string,
    output: string,
    opts: DetectOptions = {},
    knownMaps?: Iterable<SystemCode>,
  ): DetectionResult[] {
    return detectInMaps(input, output, this.loader, opts, knownMaps)
  }
}

let defaultRuntime: InterscriptRuntime | undefined

/** Configure the default runtime with custom strategies. */
export function configure(config: InterscriptConfig): void {
  defaultRuntime = new InterscriptRuntime(config)
}

function runtime(): InterscriptRuntime {
  if (!defaultRuntime) {
    defaultRuntime = new InterscriptRuntime()
  }
  return defaultRuntime
}

/** Public API — mirrors Interscript.transliterate from Ruby. */
export function transliterate(systemCode: SystemCode, input: string, stage?: string): string {
  return runtime().transliterate(systemCode, input, stage)
}

/** Public API — mirrors Interscript.load. */
export function loadMap(systemCode: SystemCode): CompiledMap {
  return runtime().loadMap(systemCode)
}

/** Public API — mirrors Interscript.detect. */
export function detect(
  input: string,
  output: string,
  opts?: DetectOptions,
): DetectionResult[] {
  return runtime().detect(input, output, opts)
}

/** Reset the default runtime (mainly for tests). */
export function reset(): void {
  defaultRuntime = undefined
}
