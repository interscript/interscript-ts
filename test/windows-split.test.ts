/**
 * Windowed long-input handling — parity with the published Python
 * harness (ml-models src/harness/sadeed.py). The fixture in
 * test/fixtures/windows-split.json is generated from the Python
 * split_windows; the parity test pins this port to it.
 */
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { splitWindows, BYTE_BUDGET } from "../src/ml/imf/windows.js"

const fixture = JSON.parse(readFileSync("test/fixtures/windows-split.json", "utf8")) as {
  budget: number
  inputs: Record<string, string>
  cases: Record<string, string[]>
}

describe("splitWindows parity with the Python harness", () => {
  for (const [name, expected] of Object.entries(fixture.cases)) {
    it(`matches on ${name}`, () => {
      expect(splitWindows(fixture.inputs[name], fixture.budget)).toEqual(expected)
    })
  }

  it("keeps every window within the byte budget", () => {
    for (const windows of Object.values(fixture.cases)) {
      for (const w of windows) {
        // unbreakable single words exceed the budget in the Python
        // reference too — the split cannot cut inside a word
        if (w.split(" ").length > 1) {
          expect(new TextEncoder().encode(w).length).toBeLessThanOrEqual(fixture.budget)
        }
      }
    }
  })
})
