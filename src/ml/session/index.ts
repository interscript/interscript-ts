/**
 * InferenceSession — abstract interface for running ONNX models.
 *
 * Two backends implement this:
 *   - onnx-node: native ONNX Runtime via onnxruntime-node (Node.js only)
 *   - onnx-web: WASM/WebGPU ONNX Runtime via onnxruntime-web (browser)
 *
 * Adding a new backend (e.g. TensorFlow.js, WebGPU-native) = adding a
 * new file here + exporting a factory. Existing code never changes (OCP).
 *
 * Backends are loaded lazily — only the one needed is imported, keeping
 * the bundle size minimal.
 */

import type { InferenceSession, InferenceInputs, InferenceOutputs } from "../types.js"

export type { InferenceSession, InferenceInputs, InferenceOutputs }

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
 * Create an InferenceSession from a model file. Auto-picks the backend.
 * Backend choice can be overridden via opts.backend.
 */
export async function createSession(
  modelData: ArrayBuffer | Uint8Array,
  opts: { backend?: "node" | "web" } = {},
): Promise<InferenceSession> {
  const backend = opts.backend ?? detectBackend() === "node" ? "node" : "web"
  if (backend === "node") {
    return (await import("./onnx-node.js")).createNodeSession(modelData)
  }
  return (await import("./onnx-web.js")).createWebSession(modelData)
}
