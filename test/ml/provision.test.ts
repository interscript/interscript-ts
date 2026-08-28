/**
 * Specs for the explicit-URL model provisioner. The manifest-based
 * resolution layer was removed in 4.0.0 — models resolve through the
 * IMF registry (`imf`) or an explicit `url` on the ModelRef.
 */

import { describe, it, expect } from "vitest"
import { provisionModel } from "../../src/ml/provision/index.js"

describe("provisioner", () => {
  it("requires an explicit url and points at the IMF registry otherwise", async () => {
    await expect(provisionModel({ kind: "secryst", id: "unresolved" })).rejects.toThrow(
      /imf\.resolve\(/,
    )
  })
})
