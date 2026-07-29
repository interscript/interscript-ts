import { describe, it, expect } from "vitest"
import {
  InterscriptError,
  MapNotFoundError,
  SystemConversionError,
  MapLogicError,
  DependencyMissingError,
} from "../src/errors.js"

describe("error hierarchy", () => {
  it("all errors inherit from InterscriptError", () => {
    expect(new MapNotFoundError("x")).toBeInstanceOf(InterscriptError)
    expect(new SystemConversionError("x")).toBeInstanceOf(InterscriptError)
    expect(new MapLogicError("x")).toBeInstanceOf(InterscriptError)
    expect(new DependencyMissingError("x")).toBeInstanceOf(InterscriptError)
  })

  it("all inherit from Error", () => {
    expect(new InterscriptError("x")).toBeInstanceOf(Error)
  })

  it("preserves the message", () => {
    expect(new InterscriptError("foo").message).toBe("foo")
  })

  it("preserves cause when provided", () => {
    const inner = new Error("boom")
    const outer = new SystemConversionError("wrapped", { cause: inner })
    expect(outer.cause).toBe(inner)
  })

  it("MapNotFoundError embeds the system code", () => {
    const e = new MapNotFoundError("bgnpcgn-x-x-x-x")
    expect(e.message).toContain("bgnpcgn-x-x-x-x")
  })

  it("DependencyMissingError embeds the missing dep", () => {
    const e = new DependencyMissingError("posix")
    expect(e.message).toContain("posix")
  })

  it("error names are stable (for instanceof checks across module boundaries)", () => {
    expect(new MapNotFoundError("x").name).toBe("MapNotFoundError")
    expect(new SystemConversionError("x").name).toBe("SystemConversionError")
    expect(new MapLogicError("x").name).toBe("MapLogicError")
    expect(new DependencyMissingError("x").name).toBe("DependencyMissingError")
  })
})
