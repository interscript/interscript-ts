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

import type { CompiledMap, DetectionResult, DetectOptions, SystemCode } from "./types.js"
import { MapLoader, type LoadStrategy } from "./loader.js"
import { executeStage, executeStageAsync } from "./runtime/interpreter.js"
import {
  DependencyMissingError,
  InterscriptError,
  MapNotFoundError,
  SystemConversionError,
} from "./errors.js"
import { detectInMaps, detectInMapsAsync } from "./detector.js"
import { reverseMap, reverseName } from "./reverse.js"

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
export type {
  IscDocument,
  IscItem,
  IscRule,
  IscRuleset,
  IscStage,
  IscStageItem,
  IscTest,
  IscConstraint,
} from "./isc/types.js"
export { parseIsc } from "./isc/parser.js"
export { IscParseError, IscLoadError } from "./isc/types.js"
export { iscToCompiledMap, type IscToCompiledMapOptions } from "./isc/converter.js"
export { expandDocument, requiredDependencyDocs, type DependencyDocResolver } from "./isc/expand.js"
export { reverseName, reverseMap } from "./reverse.js"
export { setRababaConfig, resetRababaConfigs, type RababaConfigEntry } from "./stdlib/ml.js"

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
   *
   * Carries the ruby `Interscript::DSL.parse` reverse-name fallback: a
   * missing map whose reverse-named sibling exists loads that sibling
   * and returns its reverse (cached under the requested code).
   */
  loadMap(systemCode: SystemCode): CompiledMap {
    try {
      return this.loadMapWithDeps(systemCode)
    } catch (e) {
      if (e instanceof MapNotFoundError) return this.loadReversedFallback(systemCode, e)
      throw e
    }
  }

  /** Load a map and warm its direct dependencies (shared by both load
   * paths so the sync executor can resolve them without awaiting). */
  private loadMapWithDeps(systemCode: SystemCode): CompiledMap {
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
   * Ruby DSL.parse fallback: `locate(map)` failed, so try
   * `reverse_name(map)` and return the reversed document. Re-raises the
   * original error when the fallback name is identical or also missing.
   */
  private loadReversedFallback(systemCode: SystemCode, original: MapNotFoundError): CompiledMap {
    const fallback = reverseName(systemCode)
    if (fallback === systemCode) throw original
    let forward: CompiledMap
    try {
      forward = this.loadMapWithDeps(fallback)
    } catch (e) {
      if (e instanceof MapNotFoundError) throw original
      throw e
    }
    const reversed = reverseMap(forward)
    // Ruby caches the reversed document under the requested name.
    this.loader.register(systemCode, reversed)
    return reversed
  }

  /**
   * Async pre-load. Required when async strategies (HTTP) are configured
   * and the map isn't already cached.
   *
   * Recursively loads all transitive dependencies so the synchronous
   * execution path can resolve deps without awaiting.
   */
  async loadMapAsync(systemCode: SystemCode): Promise<CompiledMap> {
    try {
      return await this.loadMapAsyncWithDeps(systemCode)
    } catch (e) {
      if (e instanceof MapNotFoundError) {
        // Same reverse-name fallback as the sync path (ruby DSL.parse).
        const fallback = reverseName(systemCode)
        if (fallback !== systemCode) {
          try {
            const forward = await this.loadMapAsyncWithDeps(fallback)
            const reversed = reverseMap(forward)
            this.loader.register(systemCode, reversed)
            return reversed
          } catch (e2) {
            if (e2 instanceof MapNotFoundError) throw e
            throw e2
          }
        }
      }
      throw e
    }
  }

  private async loadMapAsyncWithDeps(systemCode: SystemCode): Promise<CompiledMap> {
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
   *
   * `language` (ISC-WF-1 W3): selects one of the map's declared
   * languages. When given and declared, `when`-guarded rules listing it
   * apply and all other guarded rules are inert; when omitted (or
   * undeclared), every guarded rule is inert.
   */
  transliterate(systemCode: SystemCode, input: string, stage?: string, language?: string): string {
    try {
      const map = this.loadMap(systemCode)
      const stageName = stage ?? this.defaultStage
      return executeStage(map, stageName, input, this.loader, language)
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
    language?: string,
  ): Promise<string> {
    try {
      const map = await this.loadMapAsync(systemCode)
      const stageName = stage ?? this.defaultStage
      return await executeStageAsync(map, stageName, input, this.loader, language)
    } catch (e) {
      if (e instanceof InterscriptError) throw e
      throw new SystemConversionError(
        `Transliteration failed for ${systemCode}: ${(e as Error).message}`,
        { cause: e },
      )
    }
  }

  /**
   * Reverse-mode transliteration — the `iscrs reverse` analog: load the
   * map, reverse it (mirroring rs `reverse_document`, which recursively
   * reverses embedded dependency documents — here the whole dependency
   * closure is reversed and served to execution), then run one stage of
   * the reversed document.
   */
  reverse(systemCode: SystemCode, input: string, stage?: string, language?: string): string {
    const map = this.loadMap(systemCode)

    // rs: dependency documents reverse with the parent. Memoized
    // closure walk — cycles recurse in rs/ruby too, only repeat work
    // is skipped here.
    const reversedDeps = new Map<SystemCode, CompiledMap>()
    const collect = (m: CompiledMap): void => {
      for (const dep of m.dependencies) {
        if (reversedDeps.has(dep)) continue
        let depMap: CompiledMap
        try {
          depMap = this.loader.load(dep)
        } catch (e) {
          if (e instanceof MapNotFoundError) throw new DependencyMissingError(dep)
          throw e
        }
        reversedDeps.set(dep, reverseMap(depMap))
        collect(depMap)
      }
    }
    collect(map)

    const reversed = reverseMap(map)
    // Serve the reversed dependency documents under their original
    // names (run rules reference the forward names).
    const depLoader = new MapLoader([])
    for (const [code, depReversed] of reversedDeps) depLoader.register(code, depReversed)
    const stageName = stage ?? this.defaultStage
    return executeStage(reversed, stageName, input, depLoader, language)
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

  /** Async detection — loads candidates through `loadMapAsync`. */
  async detectAsync(
    input: string,
    output: string,
    opts: DetectOptions = {},
  ): Promise<DetectionResult[]> {
    // The runtime's dep-aware loader, so maps with dependencies load whole.
    return detectInMapsAsync(input, output, this.loader, opts, (code) => this.loadMapAsync(code))
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
export function transliterate(
  systemCode: SystemCode,
  input: string,
  stage?: string,
  language?: string,
): string {
  return runtime().transliterate(systemCode, input, stage, language)
}

/**
 * Async transliterate. Use when async strategies (httpStrategy) are
 * configured and the map may not be in the cache yet.
 */
export function transliterateAsync(
  systemCode: SystemCode,
  input: string,
  stage?: string,
  language?: string,
): Promise<string> {
  return runtime().transliterateAsync(systemCode, input, stage, language)
}

/**
 * Public API — reverse-mode transliteration (`iscrs reverse`): load
 * `systemCode`, reverse the document (dependencies reverse with the
 * parent), and transliterate `input` through it.
 */
export function reverse(
  systemCode: SystemCode,
  input: string,
  stage?: string,
  language?: string,
): string {
  return runtime().reverse(systemCode, input, stage, language)
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
export function detect(input: string, output: string, opts?: DetectOptions): DetectionResult[] {
  return runtime().detect(input, output, opts)
}

/**
 * Public API — async detection over a candidate catalogue. Loads each
 * candidate (`opts.systems`, else everything ever loaded) through the
 * async strategies, so ISC/HTTP-backed catalogues need no preloading.
 */
export function detectAsync(
  input: string,
  output: string,
  opts?: DetectOptions,
): Promise<DetectionResult[]> {
  return runtime().detectAsync(input, output, opts)
}

/** Reset the default runtime (mainly for tests). */
export function reset(): void {
  defaultRuntime = undefined
}
