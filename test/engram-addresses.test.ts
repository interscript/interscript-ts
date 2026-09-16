/**
 * Engram hash parity: the TS port must produce identical addresses to
 * the Python reference (they feed the same IMF graph input). The
 * fixture is generated from ml-models src/gpu/engram.py.
 */
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { ngramAddresses } from "../src/ml/imf/engram.js"

const fixture = JSON.parse(readFileSync("test/fixtures/engram-addresses.json", "utf8")) as {
  orders: number[]
  cases: { seq: number[]; addresses: number[][] }[]
}

describe("engram address parity with the Python reference", () => {
  for (const c of fixture.cases) {
    it(`matches on seq len ${c.seq.length}`, () => {
      expect(ngramAddresses(c.seq, fixture.orders)).toEqual(c.addresses)
    })
  }

  it("wraps ids through the byte table (id 259+3k ≡ id 3k... byte wrap)", () => {
    expect(ngramAddresses([103 + 256, 104 + 256])[1]).toEqual(ngramAddresses([103, 104])[1])
  })
})
