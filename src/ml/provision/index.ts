/**
 * Model provisioner — fetch + cache model files.
 *
 * Used by the registry to materialize a ModelRef into a session +
 * auxiliary artifacts. Reuses fetch (works in Node 18+ and modern
 * browsers); falls back to filesystem reads in Node when given a
 * `file:` or relative URL.
 *
 * The manifest-based resolution layer was removed in 4.0.0: models
 * resolve through the IMF registry (`imf`, GitHub Releases index,
 * sha256-verified) or an explicit `url` on the ModelRef.
 */

import type { ModelArtifacts, ModelRef } from "../types.js"
import type { InferenceSession } from "../session/index.js"
import { createSession } from "../session/index.js"
import type { AssetFormat, AssetVariant } from "./types.js"

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
 * Provision a model from an explicit URL. Downloads the model file,
 * opens an inference session, and returns it with any artifacts the
 * caller fetches separately.
 *
 * In Node, can read from the filesystem if `url` starts with `file:`
 * or is a relative path.
 */
export async function provisionModel(
  ref: ModelRef,
  opts: ProvisionOptions = {},
): Promise<ProvisionedModel> {
  const format = opts.format ?? "onnx"
  const webgpu = opts.webgpu ?? true

  if (!ref.url) {
    throw new Error(
      `No url on ModelRef kind=${ref.kind} id=${ref.id}. Load models via ` +
        `\`import { imf } from "interscript/ml"\` and \`imf.resolve("${ref.id}")\` ` +
        `(GitHub Releases index, sha256-verified), or pass an explicit \`url\` on the ModelRef.`,
    )
  }

  const modelBuffer = await fetchBytesWithFallback(ref.url)
  const artifacts: Record<string, Uint8Array | string> = {}

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
