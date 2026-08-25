/**
 * InferenceSession — abstract interface for running ML models.
 *
 * Three backends implement this:
 *   - onnx-node: native ONNX Runtime via onnxruntime-node (Node.js only)
 *   - onnx-web: WASM/WebGPU ONNX Runtime via onnxruntime-web (browser)
 *   - litert-web: LiteRT.js for .tflite models (browser)
 *
 * Adding a new backend = adding a new file here + exporting a factory.
 * Existing code never changes (OCP).
 *
 * Backends are loaded lazily — only the one needed is imported, keeping
 * the bundle size minimal.
 */

import type { InferenceSession, InferenceInputs, InferenceOutputs } from "../types.js"

export type { InferenceSession, InferenceInputs, InferenceOutputs }
export type { WebSessionOptions } from "./onnx-web.js"
export type { LitertSessionOptions } from "./litert-web.js"

/**
 * Detect environment. Browser backends work in `window`, Node backends
 * work in `process.versions.node`. Some environments (Cloudflare
 * Workers, Deno) might prefer Web.
 */
export function detectBackend(): "node" | "web" | "unknown" {
  const g = globalThis as { process?: { versions?: { node?: string } }, self?: unknown }
  if (g.process?.versions?.node) {
    return "node"
  }
  if (g.self !== undefined) {
    return "web"
  }
  return "unknown"
}

/**
 * Options for `createSession`.
 */
export interface SessionOptions {
  /** Force a specific backend. Auto-detected by default. */
  backend?: "node" | "web"
  /**
   * Which runtime to use. ONNX is the default; "litert" selects
   * Google's LiteRT.js for .tflite models. The runtime choice must
   * match the model artifact being loaded (.onnx vs .tflite).
   */
  runtime?: "onnx" | "litert"
  /** ONNX-web only: enable WebGPU with WASM fallback. Default: true. */
  webgpu?: boolean
  /** LiteRT-web only: accelerator preference. Default: "webgpu". */
  litertAccelerator?: "webgpu" | "webnn" | "wasm"
  /**
   * LiteRT-web only: input/output tensor names. ONNX reads these from
   * the model graph; LiteRT's auto-generated names are not user-facing,
   * so the caller must supply them.
   */
  inputNames?: readonly string[]
  outputNames?: readonly string[]
}

/**
 * Create an InferenceSession from a model file. Auto-picks the backend.
 * Backend choice can be overridden via opts.backend; runtime choice
 * via opts.runtime.
 */
export async function createSession(
  modelData: ArrayBuffer | Uint8Array,
  opts: SessionOptions = {},
): Promise<InferenceSession> {
  const runtime = opts.runtime ?? "onnx"

  // LiteRT runs in the browser only (for now — no Node.js build).
  if (runtime === "litert") {
    const litertOpts: Record<string, unknown> = {}
    if (opts.litertAccelerator !== undefined) litertOpts.accelerator = opts.litertAccelerator
    if (opts.inputNames !== undefined) litertOpts.inputNames = opts.inputNames
    if (opts.outputNames !== undefined) litertOpts.outputNames = opts.outputNames
    return (await import("./litert-web.js")).createLitertSession(modelData, litertOpts)
  }

  const backend = opts.backend ?? detectBackend() === "node" ? "node" : "web"
  if (backend === "node") {
    return (await import("./onnx-node.js")).createNodeSession(modelData)
  }
  // Pass through webgpu only when explicitly set — exactOptionalPropertyTypes
  // distinguishes missing vs undefined, and we want missing = use default.
  const webOpts = opts.webgpu === undefined ? {} : { webgpu: opts.webgpu }
  return (await import("./onnx-web.js")).createWebSession(modelData, webOpts)
}
