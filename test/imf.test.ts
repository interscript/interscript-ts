/**
 * IMF v1 runtime tests — the TypeScript side of the cross-runtime
 * contract. Tiny-graph zips for CI (no download); the golden e2e runs
 * when SECRYST_E2E_ZIP points at a real zip.
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
  }, 600_000)
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
      process.env["SECRYST_CACHE"] = cache
      try {
        const resolved = await resolve("tiny-1.0", join(dir, "models.yaml"))
        expect(resolved.path).toBe(join(cache, "models", "tiny-1.0", "tiny.zip"))
        expect(existsSync(resolved.path!)).toBe(true)
        rmSync(join(dir, "channel", "tiny.zip"))
        const again = await resolve("tiny-1.0", join(dir, "models.yaml"))
        expect(again.path).toBe(resolved.path)
      } finally {
        delete process.env["SECRYST_CACHE"]
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

  it("assembles split parts and verifies per-part + whole-file sha256", async () => {
    const { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } = await import("node:fs")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    const dir = mkdtempSync(join(tmpdir(), "imf-parts-"))
    try {
      mkdirSync(join(dir, "channel"))
      const blob = fixtureZip
      const split = Math.floor(blob.length / 2) + 3
      const partA = blob.subarray(0, split)
      const partB = blob.subarray(split)
      writeFileSync(join(dir, "channel", "tiny.zip.part-00"), partA)
      writeFileSync(join(dir, "channel", "tiny.zip.part-01"), partB)
      const { createHash } = await import("node:crypto")
      const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex")
      writeFileSync(
        join(dir, "models.yaml"),
        `version: 1\nmodels:\n  tiny-1.0:\n    filename: tiny.zip\n    sha256: ${sha(blob)}\n    parts:\n` +
          `      - url: file://${dir}/channel/tiny.zip.part-00\n        sha256: ${sha(partA)}\n        size: ${partA.length}\n` +
          `      - url: file://${dir}/channel/tiny.zip.part-01\n        sha256: ${sha(partB)}\n        size: ${partB.length}\n`,
      )
      const cache = join(dir, "cache")
      process.env["SECRYST_CACHE"] = cache
      try {
        const resolved = await resolve("tiny-1.0", join(dir, "models.yaml"))
        expect(resolved.path).toBe(join(cache, "models", "tiny-1.0", "tiny.zip"))
        expect(new Uint8Array(readFileSync(resolved.path!))).toEqual(blob)
        rmSync(join(dir, "channel", "tiny.zip.part-00"))
        const again = await resolve("tiny-1.0", join(dir, "models.yaml"))
        expect(again.path).toBe(resolved.path)
      } finally {
        delete process.env["SECRYST_CACHE"]
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("rejects a corrupt part by index", async () => {
    const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import("node:fs")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    const dir = mkdtempSync(join(tmpdir(), "imf-badpart-"))
    try {
      mkdirSync(join(dir, "channel"))
      const partA = fixtureZip.subarray(0, 7)
      const partB = fixtureZip.subarray(7)
      writeFileSync(join(dir, "channel", "tiny.zip.part-00"), partA)
      writeFileSync(join(dir, "channel", "tiny.zip.part-01"), partB)
      const { createHash } = await import("node:crypto")
      const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex")
      writeFileSync(
        join(dir, "models.yaml"),
        `version: 1\nmodels:\n  tiny-1.0:\n    filename: tiny.zip\n    sha256: ${sha(fixtureZip)}\n    parts:\n` +
          `      - url: file://${dir}/channel/tiny.zip.part-00\n        sha256: ${"0".repeat(64)}\n        size: ${partA.length}\n` +
          `      - url: file://${dir}/channel/tiny.zip.part-01\n        sha256: ${sha(partB)}\n        size: ${partB.length}\n`,
      )
      process.env["SECRYST_CACHE"] = join(dir, "cache")
      try {
        await expect(resolve("tiny-1.0", join(dir, "models.yaml"))).rejects.toThrow(
          /part 0 .* sha256 mismatch/,
        )
      } finally {
        delete process.env["SECRYST_CACHE"]
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("persists verified models in the browser Cache API (download once)", async () => {
    const { createHash } = await import("node:crypto")
    const { createServer } = await import("node:http")
    const sha = createHash("sha256").update(fixtureZip).digest("hex")
    let channelUp = true
    let indexBody = ""
    const server = createServer((req, res) => {
      if (req.url === "/index.yaml") {
        res.writeHead(200, { "content-type": "text/yaml" })
        res.end(indexBody)
        return
      }
      if (req.url === "/index.yaml.sha256") {
        const digest = createHash("sha256").update(indexBody).digest("hex")
        res.writeHead(200)
        res.end(`${digest}  index.yaml\n`)
        return
      }
      if (req.url === "/tiny.zip") {
        if (!channelUp) {
          res.writeHead(404)
          res.end("gone")
          return
        }
        res.writeHead(200)
        res.end(fixtureZip)
        return
      }
      res.writeHead(404)
      res.end()
    })
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
    const port = (server.address() as { port: number }).port
    const indexUrl = `http://127.0.0.1:${port}/index.yaml`
    indexBody = `version: 1\nmodels:\n  tiny-1.0:\n    filename: tiny.zip\n    url: http://127.0.0.1:${port}/tiny.zip\n    sha256: ${sha}\n`

    // store raw bytes: Response.clone() stream semantics differ across
    // undici versions (node 20 vs 24) and are irrelevant to the contract
    const store = new Map<string, Uint8Array>()
    const fakeCache = {
      async match(req: RequestInfo) {
        const key = String(req instanceof Request ? req.url : req)
        const bytes = store.get(key)
        return bytes === undefined ? undefined : new Response(bytes)
      },
      async put(req: RequestInfo, res: Response) {
        const key = String(req instanceof Request ? req.url : req)
        store.set(key, new Uint8Array(await res.arrayBuffer()))
      },
      async delete(req: RequestInfo) {
        const key = String(req instanceof Request ? req.url : req)
        return store.delete(key)
      },
    }
    const g = globalThis as Record<string, unknown>
    g["caches"] = { open: async () => fakeCache }
    // Simulate a browser host by swapping the globalThis.process
    // reference (the registry detects Node via globalThis). Deleting
    // process.versions.node instead breaks node 20's bundled undici,
    // which splits it inside fetch().
    const realProcess = globalThis.process
    const withBrowserHost = async <T>(fn: () => Promise<T>): Promise<T> => {
      const gg = globalThis as { process?: unknown }
      gg.process = { env: {}, versions: {} }
      try {
        return await fn()
      } finally {
        gg.process = realProcess
      }
    }
    try {
      process.env["SECRYST_CACHE"] = undefined
      const first = await withBrowserHost(() => resolve("tiny-1.0", indexUrl))
      expect([...first.bytes]).toEqual([...fixtureZip])
      // zip + the offline index copy (TODO.client-work 05)
      expect(store.size).toBe(2)
      const zipKeys = [...store.keys()].filter((k) => k.endsWith("tiny.zip"))
      expect(zipKeys.length).toBe(1)

      // channel dies; the cached copy serves, still sha-verified
      channelUp = false
      const second = await withBrowserHost(() => resolve("tiny-1.0", indexUrl))
      expect([...second.bytes]).toEqual([...fixtureZip])

      // a corrupted cache entry falls through to a fresh download
      channelUp = true
      const key = store.keys().next().value as string
      store.set(key, new Uint8Array([1, 2, 3]))
      const third = await withBrowserHost(() => resolve("tiny-1.0", indexUrl))
      expect([...third.bytes]).toEqual([...fixtureZip])
    } finally {
      delete g["caches"]
      delete process.env["SECRYST_CACHE"]
      await new Promise<void>((r) => server.close(() => r()))
    }
  })

  it("DEFAULT_INDEX_URL pins a GitHub Release asset, never raw", async () => {
    const { DEFAULT_INDEX_URL } = await import("../src/ml/imf/registry.js")
    expect(DEFAULT_INDEX_URL).toMatch(
      /^https:\/\/github\.com\/interscript\/interscript-ml\/releases\/download\/index-v2\/models-index\.yaml$/,
    )
    expect(DEFAULT_INDEX_URL).not.toMatch(/raw\.githubusercontent/)
  })

  it("HTTP index fetch verifies the .sha256 sidecar before parsing", async () => {
    const { createHash } = await import("node:crypto")
    const { createServer } = await import("node:http")
    const body = "version: 1\nmodels: {}\n"
    const good = createHash("sha256").update(body).digest("hex")
    const bad = "0".repeat(64)

    async function withServer(sidecar: string | null, fn: (base: string) => Promise<void>) {
      const server = createServer((req, res) => {
        if (req.url === "/models-index.yaml") {
          res.writeHead(200, { "content-type": "text/yaml" })
          res.end(body)
          return
        }
        if (req.url === "/models-index.yaml.sha256") {
          if (sidecar === null) {
            res.writeHead(404)
            res.end("missing")
            return
          }
          res.writeHead(200, { "content-type": "text/plain" })
          res.end(`${sidecar}  models-index.yaml\n`)
          return
        }
        res.writeHead(404)
        res.end()
      })
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
      const { port } = server.address() as { port: number }
      try {
        await fn(`http://127.0.0.1:${port}/models-index.yaml`)
      } finally {
        await new Promise<void>((r) => server.close(() => r()))
      }
    }

    await withServer(good, async (url) => {
      await expect(resolve("nope", url)).rejects.toThrow(/unknown model id/)
    })
    await withServer(bad, async (url) => {
      await expect(resolve("nope", url)).rejects.toThrow(/index sha256 mismatch/)
    })
    await withServer(null, async (url) => {
      await expect(resolve("nope", url)).rejects.toThrow(/index sha256/)
    })
  })
  it("the public ./ml surface no longer exports the deprecated manifest APIs", async () => {
    const ml = (await import("../src/ml/index.js")) as unknown as Record<string, unknown>
    for (const k of [
      "loadManifest",
      "resolveManifestEntry",
      "artifactUrls",
      "sidecarFilenames",
      "setInlineManifest",
      "setManifestUrl",
      "setModelBase",
      "getModelBase",
    ]) {
      expect(ml[k], `ml.${k} should be gone`).toBeUndefined()
    }
  })

  it("secryst funcall resolves model ids through the IMF registry", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    const { configure, reset, transliterateAsync } = await import("../src/index.js")
    const dir = mkdtempSync(join(tmpdir(), "imf-funcall-"))
    writeFileSync(join(dir, "models.yaml"), "version: 1\nmodels: {}\n")
    process.env["SECRYST_INDEX"] = join(dir, "models.yaml")
    try {
      const map = {
        schemaVersion: 1,
        systemCode: "test-secryst-funcall",
        dependencies: [],
        stages: [
          {
            kind: "stage",
            name: "main",
            rules: [{ kind: "funcall", name: "secryst", kwargs: { config: "nope-1.0" } }],
          },
        ],
        aliases: new Map(),
        functions: new Map(),
      }
      configure({ strategies: [(code: string) => (code === map.systemCode ? map : undefined)] })
      await expect(transliterateAsync("test-secryst-funcall", "abc")).rejects.toThrow(
        /unknown model id 'nope-1.0'/,
      )
    } finally {
      delete process.env["SECRYST_INDEX"]
      reset()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("the public ./ml surface re-exports the IMF registry", async () => {
    const ml = await import("../src/ml/index.js")
    const imf = (ml as { imf?: Record<string, unknown> }).imf
    expect(imf).toBeDefined()
    expect(typeof imf!["resolve"]).toBe("function")
    expect(typeof imf!["IMFModel"]).toBe("function")
    expect(imf!["DEFAULT_INDEX_URL"]).toMatch(
      /github\.com\/interscript\/interscript-ml\/releases\/download\/index-v2\/models-index\.yaml/,
    )
  })
})

const e2eZip = process.env["SECRYST_E2E_ZIP"]

describe("golden set e2e", () => {
  it.skipIf(!e2eZip)(
    "matches the Python reference byte-for-byte",
    async () => {
      const zip = e2eZip!
      const model = await IMFModel.load(zip)
      const goldenPath =
        process.env["SECRYST_GOLDEN"] ??
        "/Users/mulgogi/src/interscript/ml-models/golden/khm-latn-100.jsonl"
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
