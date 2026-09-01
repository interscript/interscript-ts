/** Client-work guards + normalization (TODO.client-work 01/02). */

import { describe, expect, it } from "vitest"
import { decode as dec, encode } from "../src/ml/imf/tokens.js"
import { normalizeArabicInput, repetitionGuardCut } from "../src/ml/imf/guards.js"

describe("input normalization", () => {
  it("strips pre-existing haraqat", () => {
    expect(normalizeArabicInput("كِتَابٌ")).toBe("كتاب")
  })
  it("decomposes lam-alef presentation ligatures", () => {
    expect(normalizeArabicInput("ﻻ")).toBe("لا")
    expect(normalizeArabicInput("ﻷ")).toBe("لأ")
  })
  it("leaves non-Arabic text untouched", () => {
    expect(normalizeArabicInput("สวัสดี 123")).toBe("สวัสดี 123")
  })
})

describe("repetition guards (ported from the Python harness)", () => {
  it("cuts a verbatim token cycle well before maxLen", () => {
    const cycle = [10, 11, 10, 11, 10, 11]
    const tokens: number[] = []
    for (let i = 0; i < 5000; i++) {
      tokens.push(cycle[i % cycle.length]!)
      if (repetitionGuardCut(tokens, dec(tokens))) break
    }
    expect(tokens.length).toBeLessThan(200)
    expect(tokens.slice(0, 4)).toEqual([10, 11, 10, 11])
  })
  it("cuts a phrase echo with rotating separators (decoded-text guard)", () => {
    const phrase = encode("كَتَابٍ")
    const seps = ['"', " ", "\n", ":"].map((s) => encode(s)[0]!)
    const tokens: number[] = []
    outer: for (let round = 0; round < 100; round++) {
      for (const t of phrase) {
        tokens.push(t)
        if (repetitionGuardCut(tokens, dec(tokens))) break outer
      }
      tokens.push(seps[round % seps.length]!)
      if (repetitionGuardCut(tokens, dec(tokens))) break
    }
    expect(tokens.filter((t) => t === phrase[0]).length).toBeLessThan(40)
  })
  it("normal generation never trips the guard", () => {
    const tokens = [20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33]
    expect(repetitionGuardCut(tokens, dec(tokens))).toBe(false)
  })
})

import { pickTier } from "../src/ml/imf/tiers.js"

describe("tier auto-selection (04)", () => {
  it("desktop memory prefers the full int8 tier", () => {
    expect(pickTier(["ara-diac-small-2.0", "ara-diac-small-2.0-int8"], 8)).toBe(
      "ara-diac-small-2.0-int8",
    )
  })
  it("constrained devices fall back to the smallest artifact", () => {
    expect(
      pickTier(
        [
          { id: "ara-diac-small-2.0", size: 1.4e9 },
          { id: "ara-diac-small-2.0-int8", size: 2.6e8 },
        ],
        2,
      ),
    ).toBe("ara-diac-small-2.0-int8")
    expect(
      pickTier(
        [
          { id: "layerdrop-int8", size: 1.9e8 },
          { id: "layerdrop-int4", size: 9.5e7 },
        ],
        2,
      ),
    ).toBe("layerdrop-int4")
  })
})

import { createServer } from "node:http"

describe("download progress (03)", () => {
  it("resolve reports monotonic 0..1 progress with byte counts", async () => {
    const { imf } = await import("../src/ml/index.js")
    const { createHash } = await import("node:crypto")
    const zip = Buffer.from("hello-zip")
    const sha = createHash("sha256").update(zip).digest("hex")
    let indexBody = ""
    const server = createServer((req, res) => {
      if (req.url === "/index.yaml") {
        res.writeHead(200)
        res.end(indexBody)
        return
      }
      if (req.url === "/index.yaml.sha256") {
        res.writeHead(200)
        res.end(`${createHash("sha256").update(indexBody).digest("hex")}  index.yaml\n`)
        return
      }
      if (req.url === "/tiny.zip") {
        res.writeHead(200, { "content-length": String(zip.length) })
        res.end(zip)
        return
      }
      res.writeHead(404)
      res.end()
    })
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
    const port = (server.address() as { port: number }).port
    const { mkdtempSync, rmSync } = await import("node:fs")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    const cacheDir = mkdtempSync(join(tmpdir(), "progress-"))
    process.env["SECRYST_CACHE"] = cacheDir
    indexBody = `version: 1\nmodels:\n  tiny-1.0:\n    filename: tiny.zip\n    url: http://127.0.0.1:${port}/tiny.zip\n    sha256: ${sha}\n`
    const events: Array<[number, number]> = []
    try {
      const resolved = await imf.resolve("tiny-1.0", `http://127.0.0.1:${port}/index.yaml`, {
        onProgress: (fraction, bytes) => events.push([fraction, bytes]),
      })
      expect([...resolved.bytes]).toEqual([...zip])
      expect(events.length).toBeGreaterThan(0)
      expect(events[events.length - 1]![0]).toBe(1)
      const fracs = events.map((e) => e[0])
      for (let i = 1; i < fracs.length; i++) expect(fracs[i]).toBeGreaterThanOrEqual(fracs[i - 1]!)
    } finally {
      delete process.env["SECRYST_CACHE"]
      rmSync(cacheDir, { recursive: true, force: true })
      await new Promise<void>((r) => server.close(() => r()))
    }
  })
})
