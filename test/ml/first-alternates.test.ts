import { describe, expect, it } from "vitest"

import { firstAlternates } from "../../src/ml/imf/tokens.js"

describe("firstAlternates", () => {
  it("keeps the primary choice per token", () => {
    expect(firstAlternates("وِكَالَةُ/وِكَالَةُ اَلْأَرْصَادِ")).toBe("وِكَالَةُ اَلْأَرْصَادِ")
  })

  it("leaves plain text untouched", () => {
    expect(firstAlternates("مرحبا بالعالم")).toBe("مرحبا بالعالم")
  })

  it("handles edges", () => {
    expect(firstAlternates("")).toBe("")
    expect(firstAlternates("a/b c/d")).toBe("a c")
  })
})
