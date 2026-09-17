/**
 * Windowed translate behavior: long inputs decode as the join of
 * their windows' decodes; short inputs are byte-identical to the
 * direct path (the golden-parity guarantee is untouched).
 */
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { IMFModel, SpeculativeModel } from "../src/ml/imf/index.js"
import { splitWindows } from "../src/ml/imf/windows.js"

const fixtureZip = new Uint8Array(readFileSync("test/fixtures/tiny-imf.zip"))

describe("translateWindowed over the tiny fixture", () => {
  it("short inputs match the direct path byte-for-byte", async () => {
    const model = await IMFModel.fromZipBytes(fixtureZip)
    const text = "rok dto roki"
    expect(await model.translate(text, 64)).toBe(await model.translateDirect(text, 64))
    await model.dispose()
  }, 60_000)

  it("a long input decodes as the join of its window decodes", async () => {
    const model = await IMFModel.fromZipBytes(fixtureZip)
    const text = "rok dto roki ".repeat(200).trim() // > 1400 bytes
    const windows = splitWindows(text)
    expect(windows.length).toBeGreaterThan(1)
    const expected = (await Promise.all(windows.map((w) => model.translateDirect(w, 64)))).join(" ")
    expect(await model.translate(text, 64)).toBe(expected)
    await model.dispose()
  }, 120_000)

  it("the speculative path windows the same way", async () => {
    const model = await IMFModel.fromZipBytes(fixtureZip)
    const spec = new SpeculativeModel(model, model)
    const text = "rok dto roki ".repeat(200).trim()
    const expected = (
      await Promise.all(splitWindows(text).map((w) => model.translateDirect(w, 64)))
    ).join(" ")
    expect(await spec.translate(text, 64)).toBe(expected)
    await model.dispose()
  }, 120_000)
})
