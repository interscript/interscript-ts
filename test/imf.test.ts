/**
 * IMF v1 runtime tests — the TypeScript side of the cross-runtime
 * contract. Tiny-graph zips for CI (no download); the golden e2e runs
 * when INTERSCRIPT_TS_E2E_ZIP points at a real zip.
 */

import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { IMFModel, IMFError, RegistryError, decode, encode, resolve } from "../src/ml/imf/index.js"
import { parseManifest, verifyAndRead } from "../src/ml/imf/loader.js"

const fixtureZip = new Uint8Array(readFileSync("test/fixtures/tiny-imf.zip"))

describe("canonical ByT5 byte table", () => {
  it("encodes byte+3 with trailing EOS", () => {
    expect(encode("rok")).toEqual([117, 114, 110, 1])
  })
  it("decodes with EOS stop", () => {
    expect(decode([117, 114, 110])).toBe("rok")
    expect(decode([117, 1, 114])).toBe("r")
  })
})

describe("IMF zip loading", () => {
  it("parses and verifies the manifest", async () => {
    const manifest = parseManifest(fixtureZip)
    expect(manifest.format).toBe("imf-v1")
    expect(manifest.id).toBe("tiny-1.0")
    const graphs = await verifyAndRead(fixtureZip)
    expect([...graphs.keys()].sort()).toEqual(["decoder.onnx", "encoder.onnx"])
  })

  it("rejects tampered bytes loudly", async () => {
    const tampered = new Uint8Array(fixtureZip)
    tampered[tampered.length - 5] ^= 0xff
    await expect(verifyAndRead(tampered)).rejects.toThrow(IMFError)
  })

  it("loads sessions from verified bytes", async () => {
    const model = await IMFModel.fromZipBytes(fixtureZip)
    expect(model.id).toBe("tiny-1.0")
      await model.dispose()
    },
    600_000,
  )
})

describe("registry", () => {
  it("resolves, verifies, and caches from a local index", async () => {
    const { mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync } = await import("node:fs")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    const dir = mkdtempSync(join(tmpdir(), "imf-reg-"))
    try {
      mkdirSync(join(dir, "channel"))
      writeFileSync(join(dir, "channel", "tiny.zip"), fixtureZip)
      const { createHash } = await import("node:crypto")
      const sha = createHash("sha256").update(fixtureZip).digest("hex")
      writeFileSync(
        join(dir, "models.yaml"),
        `version: 1\nmodels:\n  tiny-1.0:\n    filename: tiny.zip\n    url: file://${dir}/channel/tiny.zip\n    sha256: ${sha}\n`,
      )
      const cache = join(dir, "cache")
      process.env["INTERSCRIPT_ML_CACHE"] = cache
      try {
        const resolved = await resolve("tiny-1.0", join(dir, "models.yaml"))
        expect(resolved.path).toBe(join(cache, "models", "tiny-1.0", "tiny.zip"))
        expect(existsSync(resolved.path!)).toBe(true)
        rmSync(join(dir, "channel", "tiny.zip"))
        const again = await resolve("tiny-1.0", join(dir, "models.yaml"))
        expect(again.path).toBe(resolved.path)
      } finally {
        delete process.env["INTERSCRIPT_ML_CACHE"]
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("raises for unknown ids", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    const dir = mkdtempSync(join(tmpdir(), "imf-unk-"))
    const index = join(dir, "models.yaml")
    writeFileSync(index, "version: 1\nmodels: {}\n")
    try {
      await expect(resolve("nope-1.0", index)).rejects.toThrow(RegistryError)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

const e2eZip = process.env["INTERSCRIPT_TS_E2E_ZIP"]

describe("golden set e2e", () => {
  it.skipIf(!e2eZip)(
    "matches the Python reference byte-for-byte",
    async () => {
    const zip = e2eZip!
    const model = await IMFModel.load(zip)
    const goldenPath = process.env["INTERSCRIPT_TS_GOLDEN"]
      ?? "/Users/mulgogi/src/interscript/ml-models/golden/khm-latn-100.jsonl"
    const rows = readFileSync(goldenPath, "utf-8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as { input: string; output: string })
    for (const row of rows) {
      expect(await model.translate(row.input, 128), row.input).toBe(row.output)
    }
      await model.dispose()
    },
    600_000,
  )
})
