/**
 * Specs for the manifest-driven model provisioner.
 *
 * No network: tests inject an inline manifest via `setInlineManifest()`
 * and exercise URL derivation, variant selection, sidecar naming, and
 * task-name extraction.
 */

import { describe, it, expect, beforeEach } from "vitest"
import {
  artifactUrls,
  sidecarFilenames,
  setInlineManifest,
  resolveManifestEntry,
  type Manifest,
  type ManifestModelEntry,
} from "../../src/ml/provision/manifest.js"

const SAMPLE_ENTRY: ManifestModelEntry = {
  status: "stable",
  version: "0.1.0",
  cdn_base: "https://cdn.jsdelivr.net/gh/interscript/ml-models@rababa_arabic-v{version}/",
  github_base:
    "https://github.com/interscript/ml-models/releases/download/rababa_arabic-v{version}/",
}

const SAMPLE_MANIFEST: Manifest = {
  schema_version: 1,
  models: {
    rababa_arabic: SAMPLE_ENTRY,
    secryst_thai_ipa: {
      status: "preview",
      version: "0.0.0",
      cdn_base: "https://cdn.jsdelivr.net/gh/interscript/ml-models@secryst_thai_ipa-v{version}/",
      github_base:
        "https://github.com/interscript/ml-models/releases/download/secryst_thai_ipa-v{version}/",
    },
  },
}

describe("manifest provisioner", () => {
  beforeEach(() => {
    setInlineManifest(SAMPLE_MANIFEST)
  })

  describe("artifactUrls", () => {
    it("defaults to q8 variant with -q8 suffix", () => {
      const out = artifactUrls(SAMPLE_ENTRY)
      expect(out.assetName).toBe("rababa_arabic-q8.onnx")
      expect(out.primary).toContain("rababa_arabic-v0.1.0/")
      expect(out.primary).toContain("rababa_arabic-q8.onnx")
    })

    it("fp32 variant has no suffix", () => {
      const out = artifactUrls(SAMPLE_ENTRY, "fp32")
      expect(out.assetName).toBe("rababa_arabic.onnx")
    })

    it("primary uses cdn_base, fallback uses github_base", () => {
      const out = artifactUrls(SAMPLE_ENTRY, "q8")
      expect(out.primary).toContain("cdn.jsdelivr.net")
      expect(out.fallback).toContain("github.com/interscript/ml-models/releases")
    })

    it("substitutes version into both URLs", () => {
      const out = artifactUrls(SAMPLE_ENTRY)
      expect(out.primary).not.toContain("{version}")
      expect(out.fallback).not.toContain("{version}")
      expect(out.primary).toContain("v0.1.0")
    })
  })

  describe("sidecarFilenames", () => {
    it("includes checksum sidecar with asset prefix", () => {
      const sidecars = sidecarFilenames(SAMPLE_ENTRY, "q8")
      expect(sidecars).toContain("rababa_arabic-q8.onnx.sha256")
      expect(sidecars).toContain("vocab.json")
      expect(sidecars).toContain("config.json")
    })

    it("fp32 sidecar matches fp32 asset name", () => {
      const sidecars = sidecarFilenames(SAMPLE_ENTRY, "fp32")
      expect(sidecars).toContain("rababa_arabic.onnx.sha256")
    })
  })

  describe("resolveManifestEntry", () => {
    it("resolves by task name when kind prefix present", async () => {
      const entry = await resolveManifestEntry("rababa", "rababa_arabic")
      expect(entry?.version).toBe("0.1.0")
    })

    it("resolves by bare task id without kind prefix", async () => {
      const entry = await resolveManifestEntry("rababa", "rababa_arabic")
      expect(entry?.status).toBe("stable")
    })

    it("returns null for unknown task", async () => {
      const entry = await resolveManifestEntry("rababa", "nope_not_here")
      expect(entry).toBeNull()
    })
  })

  describe("task name extraction from bases", () => {
    it("extracts from secryst entry", () => {
      const out = artifactUrls(SAMPLE_MANIFEST.models["secryst_thai_ipa"]!)
      expect(out.assetName).toBe("secryst_thai_ipa-q8.onnx")
    })

    it("throws on malformed github_base", () => {
      const malformed: ManifestModelEntry = {
        ...SAMPLE_ENTRY,
        github_base: "https://example.com/no-version-pattern/",
      }
      expect(() => artifactUrls(malformed)).toThrow(/task name/)
    })
  })
})
