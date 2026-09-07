/**
 * The examples are the contract: every registered example runs and
 * produces its documented output. This is the playground gallery's
 * CI guarantee — an API change that breaks an example fails here first.
 */
import { beforeAll, describe, expect, it } from "vitest"
import { EXAMPLES, loadExample } from "../examples/index.js"

const live = process.env.INTERSCRIPT_PLAYGROUND_LIVE === "1"

describe("the example gallery", () => {
  beforeAll(() => {
    expect(EXAMPLES.length).toBeGreaterThanOrEqual(5)
  })

  for (const entry of EXAMPLES) {
    it(`${entry.id}: produces its documented output`, { timeout: 30_000 }, async () => {
      const example = await loadExample(entry)
      expect(example.title).toBeTruthy()
      expect(example.summary).toBeTruthy()
      if (entry.liveOnly && !live) {
        await expect(example.run()).rejects.toThrow(/INTERSCRIPT_PLAYGROUND_LIVE/)
        return
      }
      await expect(example.run()).resolves.toBe(example.expected)
    })
  }
})
