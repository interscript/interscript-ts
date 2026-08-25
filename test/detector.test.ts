import { describe, it, expect } from "vitest"
import { levenshtein, detectInMaps } from "../src/detector.js"
import { MapLoader } from "../src/loader.js"
import { filesystemStrategy } from "../src/loaders.node.js"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { dirname } from "node:path"

const MAPS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures", "maps")

describe("levenshtein", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshtein("hello", "hello")).toBe(0)
  })

  it("returns length when one is empty", () => {
    expect(levenshtein("", "abc")).toBe(3)
    expect(levenshtein("abc", "")).toBe(3)
  })

  it("computes substitutions", () => {
    expect(levenshtein("cat", "cot")).toBe(1)
  })

  it("computes insertions", () => {
    expect(levenshtein("cat", "cats")).toBe(1)
  })

  it("computes deletions", () => {
    expect(levenshtein("cats", "cat")).toBe(1)
  })

  it("handles unicode", () => {
    // All 5 characters differ between Cyrillic "Антон" and Latin "Anton".
    expect(levenshtein("Антон", "Anton")).toBe(5)
  })
})

describe("detectInMaps", () => {
  const loader = new MapLoader([filesystemStrategy(MAPS_DIR)])

  it("returns candidates sorted by distance", () => {
    // "Київ" should match the Ukrainian system best.
    const results = detectInMaps(
      "Антон",
      "Anton",
      loader,
      {},
      ["bgnpcgn-ukr-Cyrl-Latn-2019", "bgnpcgn-deu-Latn-Latn-2000"],
    )
    expect(results.length).toBe(2)
    expect(results[0]!.distance).toBeLessThanOrEqual(results[1]!.distance)
    expect(results[0]!.mapName).toBe("bgnpcgn-ukr-Cyrl-Latn-2019")
  })

  it("respects mapPattern filter", () => {
    const results = detectInMaps(
      "x",
      "y",
      loader,
      { mapPattern: "bgnpcgn-*" },
      ["bgnpcgn-ukr-Cyrl-Latn-2019", "odni-rus-Cyrl-Latn-2015"],
    )
    expect(results.every((r) => r.mapName.startsWith("bgnpcgn-"))).toBe(true)
  })

  it("returns empty when no known maps provided", () => {
    const results = detectInMaps("x", "y", loader, {}, [])
    expect(results).toEqual([])
  })
})
