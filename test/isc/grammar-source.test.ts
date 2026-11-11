/**
 * Grammar provenance pin — the embedded ISC grammar text must match the
 * sha256 recorded at sync time. A mismatch means grammar-source.ts was
 * edited by hand instead of via scripts/sync-isc-grammar.mjs, or the
 * sync was run against a different interscript-ruby revision than the
 * pin records. Either way the drift must be deliberate, never silent.
 */

import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { ISC_PARG_SHA256, ISC_PARG_SOURCE } from "../../src/isc/grammar/grammar-source.js"

describe("vendored ISC grammar (grammar-source.ts)", () => {
  it("matches its recorded sha256 pin", () => {
    const sha = createHash("sha256").update(ISC_PARG_SOURCE).digest("hex")
    expect(sha).toBe(ISC_PARG_SHA256)
  })

  it("declares the ISC entry point", () => {
    // A cheap structural sanity check alongside the hash pin.
    expect(ISC_PARG_SOURCE).toContain("entry isc: isc_source")
    expect(ISC_PARG_SOURCE).toMatch(/^grammar InterscriptIsc version "/m)
  })
})
