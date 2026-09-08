/**
 * Catalogue-driven detection: the candidate set comes from the caller
 * (opts.systems), and the async form loads candidates on demand
 * through async strategies. RED first — the option and detectAsync
 * don't exist yet.
 */
import { describe, expect, it } from "vitest"
import { configure, detect, detectAsync, reset } from "../src/index.js"
import { filesystemStrategy } from "../src/loaders.node.js"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const MAPS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures", "maps")
const UKR = "bgnpcgn-ukr-Cyrl-Latn-2019"
const RUS = "bgnpcgn-rus-Cyrl-Latn-1947"
const fromDisk = filesystemStrategy(MAPS_DIR)

describe("catalogue-driven detection", () => {
  it("ranks a caller-supplied candidate set", () => {
    reset()
    configure({ strategies: [filesystemStrategy(MAPS_DIR)] })
    const results = detect("Антон", "Anton", { systems: [UKR, RUS] })
    expect(results[0]?.mapName).toBe(UKR)
    expect(results).toHaveLength(2)
  })

  it("detectAsync loads unloaded candidates through async strategies", async () => {
    reset()
    const loaded: string[] = []
    configure({
      strategies: [
        async (code) => {
          const map = fromDisk(code)
          if (!map) return undefined
          loaded.push(code)
          return map
        },
      ],
    })
    const results = await detectAsync("Антон", "Anton", { systems: [UKR, RUS] })
    expect(loaded).toEqual(expect.arrayContaining([UKR, RUS]))
    expect(results[0]?.mapName).toBe(UKR)
  })

  it("detectAsync skips candidates that fail to load", async () => {
    reset()
    configure({
      strategies: [async (code) => (code === RUS ? fromDisk(RUS) : undefined)],
    })
    const results = await detectAsync("Антон", "Anton", { systems: [RUS, "missing-system"] })
    expect(results.map((r) => r.mapName)).toEqual([RUS])
  })

  it("mapPattern composes with systems", () => {
    reset()
    configure({ strategies: [filesystemStrategy(MAPS_DIR)] })
    const results = detect("Антон", "Anton", { systems: [UKR, RUS], mapPattern: "*rus*" })
    expect(results.map((r) => r.mapName)).toEqual([RUS])
  })
})
