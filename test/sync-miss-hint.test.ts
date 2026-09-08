/**
 * Actionable sync-miss error: when the sync loader misses but the
 * configured stack is async-capable, the error points at the async
 * API. RED first — the hint doesn't exist yet.
 */
import { describe, expect, it } from "vitest"
import { MapNotFoundError } from "../src/errors.js"

describe("sync-miss hint", () => {
  it("carries the async guidance when provided", () => {
    const error = new MapNotFoundError("some-system", {
      asyncLoadersConfigured: true,
    })
    expect(error.message).toMatch(/^Map not found: some-system/)
    expect(error.message).toMatch(/loadMapAsync|transliterateAsync/)
  })

  it("stays bare without a hint", () => {
    expect(new MapNotFoundError("x").message).toBe("Map not found: x")
  })
})
