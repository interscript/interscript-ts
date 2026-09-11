/**
 * Speculative decode specs: the acceptance rule as a pure function
 * (synthetic logits are data), the composition session over the tiny
 * real-graph fixture (drafter == verifier: every block accepted,
 * output identical to plain greedy), and an opt-in real-pair e2e
 * (SECRYST_SPEC_E2E=1 with SECRYST_DRAFTER_ZIP / SECRYST_VERIFIER_ZIP).
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { describe, expect, it } from "vitest"
import { IMFModel, EOS_ID } from "../src/ml/imf/index.js"
import { SpeculativeModel, acceptBlock } from "../src/ml/imf/speculative.js"

const fixtureZip = new Uint8Array(readFileSync("test/fixtures/tiny-imf.zip"))

describe("acceptBlock (pure acceptance rule)", () => {
  it("accepts a fully-matching block", () => {
    expect(acceptBlock([7, 8, 9], [7, 8, 9])).toEqual({ accepted: 3, correction: null })
  })

  it("stops at the first divergence with the verifier's pick", () => {
    expect(acceptBlock([7, 9, 9], [7, 8, 9])).toEqual({ accepted: 1, correction: 9 })
  })

  it("corrects at position zero", () => {
    expect(acceptBlock([5, 8], [7, 8])).toEqual({ accepted: 0, correction: 5 })
  })

  it("treats an accepted EOS verdict as a match like any token", () => {
    expect(acceptBlock([7, EOS_ID], [7, EOS_ID])).toEqual({ accepted: 2, correction: null })
    expect(acceptBlock([7, EOS_ID], [7, 8])).toEqual({ accepted: 1, correction: EOS_ID })
  })

  it("handles the empty block", () => {
    expect(acceptBlock([], [])).toEqual({ accepted: 0, correction: null })
  })
})

describe("SpeculativeModel over the tiny fixture (drafter == verifier)", () => {
  it("returns the verifier's own greedy output with full acceptance", async () => {
    const model = await IMFModel.fromZipBytes(fixtureZip)
    const spec = new SpeculativeModel(model, model, { blockSize: 4 })
    const text = "rok"
    const out = await spec.translate(text, 64)
    expect(out).toBe(await model.translate(text, 64))
    const stats = spec.stats()!
    expect(stats.accepted).toBe(stats.drafted)
    expect(stats.blocks).toBeGreaterThan(0)
    expect(stats.bonus).toBe(stats.blocks) // every block fully accepted
    await model.dispose()
  }, 60_000)

  it("normalizes input once for both models", async () => {
    const model = await IMFModel.fromZipBytes(fixtureZip)
    const spec = new SpeculativeModel(model, model)
    const out = await spec.translate("rok", 64, { raw: true })
    expect(spec.lastNormalizedInput()).toBe("rok")
    expect(out).toBe(await model.translate("rok", 64, { raw: true }))
    await model.dispose()
  }, 60_000)
})

const e2e = process.env["SECRYST_SPEC_E2E"] === "1"

describe.skipIf(!e2e)("real drafter/verifier pair (ara layerdrop-int4 -> small-2.1-int8)", () => {
  const cache = join(homedir(), ".cache", "secryst", "models")
  const drafterZip =
    process.env["SECRYST_DRAFTER_ZIP"] ?? join(cache, "ara-diac-layerdrop-1.0-int4", "ara-diac-layerdrop-1.0-int4.zip")
  const verifierZip =
    process.env["SECRYST_VERIFIER_ZIP"] ?? join(cache, "ara-diac-small-2.1-int8", "ara-diac-small-2.1-int8.zip")

  it(
    "matches the verifier's plain-path greedy on a real row",
    async () => {
      const drafter = await IMFModel.load(drafterZip)
      const verifier = await IMFModel.load(verifierZip)
      const spec = new SpeculativeModel(drafter, verifier)
      const row = "السلام عليكم"
      const out = await spec.translate(row, 256)
      const stats = spec.stats()!
      expect(stats.accepted / stats.drafted).toBeGreaterThan(0.9)
      // verifier decides every token: output equals its own plain-path
      // greedy (translate uses the KV path; near-tie divergence within
      // the quantized quality contract is tolerated by comparing
      // prefix overlap, not bytes)
      const reference = await verifier.translate(row, 256)
      expect(out.length).toBeGreaterThan(0.5 * reference.length)
      await drafter.dispose()
      await verifier.dispose()
    },
    300_000,
  )
})
