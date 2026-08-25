import { describe, it, expect, beforeEach } from "vitest"
import { MapLoader } from "../src/loader.js"
import { filesystemStrategy, normaliseMap, bundledStrategy } from "../src/loaders.node.js"
import type { CompiledMapJson } from "../src/index.js"
import { MapNotFoundError } from "../src/errors.js"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { dirname } from "node:path"

const MAPS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures", "maps")

const SAMPLE_JSON: CompiledMapJson = {
  schemaVersion: 1,
  systemCode: "test-x-x-x-x",
  dependencies: [],
  metadata: {},
  stages: [{ kind: "stage", name: "main", rules: [] }],
  aliases: { foo: { kind: "string", value: "bar" } },
  functions: {},
}

describe("normaliseMap", () => {
  it("converts aliases object to Map", () => {
    const m = normaliseMap(SAMPLE_JSON)
    expect(m.aliases).toBeInstanceOf(Map)
    expect(m.aliases.get("foo")).toEqual({ kind: "string", value: "bar" })
  })

  it("preserves stages and metadata", () => {
    const m = normaliseMap(SAMPLE_JSON)
    expect(m.stages).toHaveLength(1)
    expect(m.stages[0]?.name).toBe("main")
  })

  it("omits metadata if not present", () => {
    const m = normaliseMap({ ...SAMPLE_JSON, metadata: undefined })
    expect(m.metadata).toBeUndefined()
  })

  it("preserves metadata when present", () => {
    const m = normaliseMap({ ...SAMPLE_JSON, metadata: { authority_id: "bgnpcgn" } })
    expect(m.metadata?.authority_id).toBe("bgnpcgn")
  })
})

describe("filesystemStrategy", () => {
  it("loads a JSON IR file from disk", () => {
    const strat = filesystemStrategy(MAPS_DIR)
    const result = strat("bgnpcgn-deu-Latn-Latn-2000")
    expect(result).toBeDefined()
    expect(result?.systemCode).toBe("bgnpcgn-deu-Latn-Latn-2000")
  })

  it("returns undefined when the map is absent (so other strategies can try)", () => {
    const strat = filesystemStrategy(MAPS_DIR)
    expect(strat("does-not-exist")).toBeUndefined()
  })
})

describe("bundledStrategy", () => {
  it("loads from an in-memory dictionary", () => {
    const strat = bundledStrategy({ "test-x-x-x-x": SAMPLE_JSON })
    expect(strat("test-x-x-x-x")?.systemCode).toBe("test-x-x-x-x")
  })

  it("returns undefined for unregistered codes", () => {
    const strat = bundledStrategy({})
    expect(strat("anything")).toBeUndefined()
  })
})

describe("MapLoader", () => {
  let loader: MapLoader

  beforeEach(() => {
    loader = new MapLoader([
      bundledStrategy({ "from-bundle": SAMPLE_JSON }),
      filesystemStrategy(MAPS_DIR),
    ])
  })

  it("consults strategies in order", () => {
    expect(loader.load("from-bundle").systemCode).toBe("test-x-x-x-x")
    expect(loader.load("bgnpcgn-deu-Latn-Latn-2000").systemCode).toBe(
      "bgnpcgn-deu-Latn-Latn-2000",
    )
  })

  it("caches results", () => {
    let calls = 0
    const counting = (_: string) => {
      calls++
      return normaliseMap(SAMPLE_JSON)
    }
    const l = new MapLoader([counting])
    l.load("x")
    l.load("x")
    expect(calls).toBe(1)
  })

  it("throws MapNotFoundError when no strategy resolves", () => {
    expect(() => loader.load("nope")).toThrow(MapNotFoundError)
    expect(() => loader.load("nope")).toThrow(/nope/)
  })

  it("clear() empties the cache", () => {
    loader.load("from-bundle")
    loader.clear()
    // After clear, a fresh load still works.
    expect(loader.load("from-bundle").systemCode).toBe("test-x-x-x-x")
  })

  it("loadedMaps() returns cached keys", () => {
    loader.load("from-bundle")
    loader.load("bgnpcgn-deu-Latn-Latn-2000")
    expect(loader.loadedMaps()).toContain("from-bundle")
    expect(loader.loadedMaps()).toContain("bgnpcgn-deu-Latn-Latn-2000")
  })
})
