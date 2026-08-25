/**
 * Vitest for the HTTP loader strategy and async loader support.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  configure,
  reset,
  transliterateAsync,
  httpStrategy,
  bundledStrategy,
} from "../src/index.js"
import { normaliseMap } from "../src/loaders.js"
import type { CompiledMapJson } from "../src/index.js"

const SAMPLE_MAP: CompiledMapJson = {
  schemaVersion: 1,
  systemCode: "test-x-x-x-x",
  dependencies: [],
  metadata: {},
  stages: [{ kind: "stage", name: "main", rules: [{ kind: "sub", from: { kind: "string", value: "x" }, to: { kind: "string", value: "y" } }] }],
  aliases: {},
  functions: {},
}

function mockFetch(map: CompiledMapJson) {
  const fetchMock = vi.fn(async (url: string) => {
    if (typeof url === "string" && url.endsWith("test-x-x-x-x.json")) {
      return { ok: true, json: async () => map }
    }
    return { ok: false, status: 404 }
  })
  ;(globalThis as { fetch?: unknown }).fetch = fetchMock
  return fetchMock
}

describe("httpStrategy", () => {
  beforeEach(() => {
    reset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    ;(globalThis as { fetch?: unknown }).fetch = undefined
  })

  it("returns undefined for HTTP errors", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404 }))
    ;(globalThis as { fetch?: unknown }).fetch = fetchMock
    const strategy = httpStrategy({ baseUrl: "https://example.com/maps" })
    const result = await strategy("does-not-exist")
    expect(result).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("returns normalised CompiledMap on success", async () => {
    mockFetch(SAMPLE_MAP)
    const strategy = httpStrategy({ baseUrl: "https://example.com/maps" })
    const result = await strategy("test-x-x-x-x")
    expect(result).toBeDefined()
    expect(result?.systemCode).toBe("test-x-x-x-x")
    expect(result?.aliases).toBeInstanceOf(Map)
  })

  it("caches results in memory across calls", async () => {
    const fetchMock = mockFetch(SAMPLE_MAP)
    const strategy = httpStrategy({ baseUrl: "https://example.com/maps" })
    await strategy("test-x-x-x-x")
    await strategy("test-x-x-x-x")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("uses localStorage when cacheKeyPrefix is set", async () => {
    const store = new Map<string, string>()
    const localStorageMock = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    }
    vi.stubGlobal("localStorage", localStorageMock)
    const fetchMock = mockFetch(SAMPLE_MAP)
    const strategy = httpStrategy({
      baseUrl: "https://example.com/maps",
      cacheKeyPrefix: "isx:",
    })
    await strategy("test-x-x-x-x")
    expect(store.size).toBe(1)
    expect([...store.keys()][0]).toContain("isx:")
    // Second call should hit localStorage, not fetch
    fetchMock.mockClear()
    const result = await strategy("test-x-x-x-x")
    expect(result).toBeDefined()
    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it("supports custom URL builder", async () => {
    const fetchMock = mockFetch(SAMPLE_MAP)
    const strategy = httpStrategy({
      baseUrl: (code) => `https://cdn.example.com/${code.charAt(0)}/${code}.json`,
    })
    await strategy("test-x-x-x-x")
    expect(fetchMock).toHaveBeenCalledWith(
      "https://cdn.example.com/t/test-x-x-x-x.json",
      undefined,
    )
  })

  it("works end-to-end with transliterateAsync", async () => {
    mockFetch(SAMPLE_MAP)
    configure({ strategies: [httpStrategy({ baseUrl: "https://example.com/maps" })] })
    const result = await transliterateAsync("test-x-x-x-x", "x")
    expect(result).toBe("y")
  })

  it("falls back through strategies in order", async () => {
    // bundledStrategy first (cache hit), httpStrategy as fallback
    const bundled = bundledStrategy({ "test-x-x-x-x": SAMPLE_MAP })
    const http = httpStrategy({ baseUrl: "https://example.com/maps" })
    configure({ strategies: [bundled, http] })
    const result = await transliterateAsync("test-x-x-x-x", "x")
    expect(result).toBe("y")
  })
})

describe("normaliseMap (regression after httpStrategy addition)", () => {
  it("still converts aliases object to Map", () => {
    const m = normaliseMap(SAMPLE_MAP)
    expect(m.aliases).toBeInstanceOf(Map)
  })
})
