/**
 * Model provisioner — fetch + cache model files.
 *
 * Used by the registry to materialize a ModelRef into a session +
 * auxiliary artifacts. Reuses fetch (works in Node 18+ and modern
 * browsers); falls back to filesystem reads in Node when given a
 * `file:` or relative URL.
 *
 * The manifest (version → URL mapping) lives in `./manifest.ts`.
 * The base URL (CDN mirror override) lives in `./base.ts`.
 *
 * Adding a new provision source (e.g. IPFS, BitTorrent) = adding a
 * new provisioner file. Existing code never changes (OCP).
 */

import type { ModelArtifacts, ModelRef } from "../types.js"
import type { InferenceSession } from "../session/index.js"
import { createSession } from "../session/index.js"
import {
  artifactUrls,
  resolveManifestEntry,
  sidecarFilenames,
  type AssetFormat,
  type AssetVariant,
} from "./manifest.js"

export interface ProvisionedModel {
  readonly session: InferenceSession
  readonly artifacts: ModelArtifacts
}

/**
 * Which ONNX variant to download. `q8` is the browser default —
 * 8-bit quantized, ~25% the size of fp32 with negligible accuracy
 * loss for character-level transformers. Override per-call via
 * `provisionModel(ref, { variant: "fp32" })`.
 */
export interface ProvisionOptions {
  readonly variant?: AssetVariant
  /**
   * Model serialization format. `onnx` (default) selects the
   * Microsoft runtime path; `tflite` selects Google's LiteRT.js.
   * Both formats can be shipped for the same model — provisioner
   * picks based on this option.
   */
  readonly format?: AssetFormat
  /** Browser only: enable WebGPU with WASM fallback. Default: true. */
  readonly webgpu?: boolean
  /**
   * LiteRT only: accelerator preference. Default: "webgpu".
   * No-op for ONNX runtime.
   */
  readonly litertAccelerator?: "webgpu" | "webnn" | "wasm"
  /**
   * LiteRT only: input/output tensor names. ONNX reads these from
   * the model graph; LiteRT needs them supplied by the caller.
   * Defaults are correct for rababa models.
   */
  readonly inputNames?: readonly string[]
  readonly outputNames?: readonly string[]
}

/**
 * Provision a model from the manifest. Resolves the task version,
 * downloads the model file from the CDN (falls back to GitHub
 * Releases), opens an inference session, and fetches sidecar
 * artifacts (vocab, config, checksum) in parallel.
 *
 * In Node, can read from the filesystem if `url` starts with `file:`
 * or is a relative path.
 */
export async function provisionModel(
  ref: ModelRef,
  opts: ProvisionOptions = {},
): Promise<ProvisionedModel> {
  const variant = opts.variant ?? "q8"
  const format = opts.format ?? "onnx"
  const webgpu = opts.webgpu ?? true

  const modelUrl = ref.url ?? (await resolveModelUrl(ref, variant, format))

  const modelBuffer = await fetchBytesWithFallback(modelUrl)

  const sidecars = await resolveSidecarUrls(ref, variant, format)
  const artifacts: Record<string, Uint8Array | string> = {}
  await Promise.all(
    sidecars.map(async ({ filename, url }) => {
      try {
        const bytes = await fetchBytesWithFallback(url)
        if (
          filename.endsWith(".json") ||
          filename.endsWith(".yaml") ||
          filename.endsWith(".yml") ||
          filename.endsWith(".sha256")
        ) {
          artifacts[filename] = new TextDecoder().decode(bytes)
        } else {
          artifacts[filename] = bytes
        }
      } catch {
        // Sidecars are optional; missing ones are skipped.
      }
    }),
  )

  const sessionOpts: Record<string, unknown> = { webgpu }
  if (format === "tflite") {
    sessionOpts.runtime = "litert"
    if (opts.litertAccelerator !== undefined) sessionOpts.litertAccelerator = opts.litertAccelerator
    if (opts.inputNames !== undefined) sessionOpts.inputNames = opts.inputNames
    if (opts.outputNames !== undefined) sessionOpts.outputNames = opts.outputNames
  }
  const session = await createSession(modelBuffer, sessionOpts)
  return { session, artifacts }
}

async function resolveModelUrl(
  ref: ModelRef,
  variant: AssetVariant,
  format: AssetFormat,
): Promise<string> {
  const entry = await resolveManifestEntry(ref.kind, ref.id)
  if (!entry) {
    throw new Error(
      `No manifest entry for kind=${ref.kind} id=${ref.id}. ` +
        `Pass an explicit \`url\` on the ModelRef or pin a task version in the manifest.`,
    )
  }
  const { primary } = artifactUrls(entry, variant, format)
  return primary
}

async function resolveSidecarUrls(
  ref: ModelRef,
  variant: AssetVariant,
  format: AssetFormat,
): Promise<readonly { filename: string; url: string }[]> {
  // If the caller provided an explicit URL, skip manifest-based sidecar
  // resolution — they've taken control of provisioning.
  if (ref.url) return []
  const entry = await resolveManifestEntry(ref.kind, ref.id)
  if (!entry) return []
  const { primary, assetName } = artifactUrls(entry, variant, format)
  const base = primary.slice(0, primary.lastIndexOf("/") + 1)
  return sidecarFilenames(entry, variant, format).map((filename) => ({
    filename,
    url: `${base}${filename.startsWith(assetName) ? filename : filename}`,
  }))
}

/**
 * Fetch bytes from a URL. Tries the URL as-given; if it's the CDN
 * primary and fails, the caller can supply a fallback URL via the
 * `url` field on the ModelRef.
 */
async function fetchBytesWithFallback(url: string): Promise<Uint8Array> {
  // Node filesystem path
  if (
    url.startsWith("file:") ||
    (url.startsWith(".") && typeof process !== "undefined" && process.versions?.node)
  ) {
    const { readFile } = await import("node:fs/promises")
    const path = url.startsWith("file:") ? url.slice(5) : url
    return new Uint8Array(await readFile(path))
  }
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`)
  }
  return new Uint8Array(await res.arrayBuffer())
}
