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
import { executeStage, executeStageAsync } from "./runtime/interpreter.js"
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
export { httpStrategy, type HttpStrategyOptions } from "./http-loader.js"
export { iscStrategy, iscBundledStrategy, type IscStrategyOptions } from "./isc/loader.js"
export type { IscDocument, IscItem, IscRule, IscStage, IscStageItem, IscTest, IscConstraint } from "./isc/types.js"
export { parseIsc } from "./isc/parser.js"
export { IscParseError } from "./isc/types.js"
export { iscToCompiledMap } from "./isc/converter.js"
export {
  setRababaConfig,
  resetRababaConfigs,
  type RababaConfigEntry,
} from "./stdlib/ml.js"

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
   * Async pre-load. Required when async strategies (HTTP) are configured
   * and the map isn't already cached.
   *
   * Recursively loads all transitive dependencies so the synchronous
   * execution path can resolve deps without awaiting.
   */
  async loadMapAsync(systemCode: SystemCode): Promise<CompiledMap> {
    const map = await this.loader.loadAsync(systemCode)
    // Recursively load every transitive dep. The synchronous executor
    // calls loader.load() during execution and can't await async
    // strategies — so we preload the entire closure upfront.
    const seen = new Set<SystemCode>()
    const queue: SystemCode[] = [...map.dependencies]
    while (queue.length > 0) {
      const dep = queue.shift()!
      if (seen.has(dep)) continue
      seen.add(dep)
      try {
        const depMap = await this.loader.loadAsync(dep)
        for (const d of depMap.dependencies) {
          if (!seen.has(d)) queue.push(d)
        }
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

  /**
   * Async transliterate. Required when the configured strategies include
   * async loaders (e.g. httpStrategy) and the map may not be cached.
   * Also handles ML-powered maps (rababa, secryst) — use this instead
   * of transliterate() for any map that might contain ML funcalls.
   */
  async transliterateAsync(
    systemCode: SystemCode,
    input: string,
    stage?: string,
  ): Promise<string> {
    try {
      const map = await this.loadMapAsync(systemCode)
      const stageName = stage ?? this.defaultStage
      return await executeStageAsync(map, stageName, input, this.loader)
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

/**
 * Async transliterate. Use when async strategies (httpStrategy) are
 * configured and the map may not be in the cache yet.
 */
export function transliterateAsync(
  systemCode: SystemCode,
  input: string,
  stage?: string,
): Promise<string> {
  return runtime().transliterateAsync(systemCode, input, stage)
}

/** Public API — mirrors Interscript.load. */
export function loadMap(systemCode: SystemCode): CompiledMap {
  return runtime().loadMap(systemCode)
}

/** Async version — needed when async strategies may be used. */
export function loadMapAsync(systemCode: SystemCode): Promise<CompiledMap> {
  return runtime().loadMapAsync(systemCode)
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
