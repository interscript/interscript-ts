/**
 * IMF v1 zip loading: manifest parse, per-graph sha256 verification.
 * Corrupt downloads fail loudly, before any session is created.
 */

import { unzipSync } from "fflate"
import { load as loadYaml } from "js-yaml"

export interface IMFManifest {
  format: string
  id: string
  task: string
  decoder: string
  precision: string
  opset: number
  sha256: Record<string, string>
}

export class IMFError extends Error {}

export function parseManifest(zipBytes: Uint8Array): IMFManifest {
  const files = unzipSync(zipBytes)
  const metaBytes = files["metadata.yaml"]
  if (!metaBytes) throw new IMFError("missing metadata.yaml")
  const raw = loadYaml(new TextDecoder().decode(metaBytes)) as Record<string, unknown>
  if (raw["format"] !== "imf-v1") throw new IMFError(`unsupported format: ${String(raw["format"])}`)
  if (raw["tokenizer"] !== "bytes") {
    throw new IMFError(`tokenizer ${String(raw["tokenizer"])}: this runtime is byte-level only`)
  }
  if (!files["encoder.onnx"] || !files["decoder.onnx"]) {
    throw new IMFError("missing encoder.onnx / decoder.onnx")
  }
  return {
    format: "imf-v1",
    id: String(raw["id"]),
    task: String(raw["task"]),
    decoder: raw["decoder"] === undefined ? "plain" : String(raw["decoder"]),
    precision: raw["precision"] === undefined ? "fp32" : String(raw["precision"]),
    opset: raw["opset"] === undefined ? 14 : Number(raw["opset"]),
    sha256: (raw["sha256"] as Record<string, string>) ?? {},
  }
}

async function sha256(data: Uint8Array): Promise<string> {
  const buffer = new Uint8Array(data).buffer as ArrayBuffer
  const digest = await crypto.subtle.digest("SHA-256", buffer)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/** Unzip + sha256-verify every .onnx member; returns name -> bytes. */
export async function verifyAndRead(zipBytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const manifest = parseManifest(zipBytes)
  const files = unzipSync(zipBytes)
  const graphs = new Map<string, Uint8Array>()
  for (const [name, bytes] of Object.entries(files)) {
    if (!name.endsWith(".onnx")) continue
    const recorded = manifest.sha256[name]
    if (!recorded) throw new IMFError(`${name} is not covered by metadata sha256`)
    const actual = await sha256(bytes)
    if (actual !== recorded) {
      throw new IMFError(`${name} sha256 mismatch: zip has ${actual}, metadata says ${recorded}`)
    }
    graphs.set(name, bytes)
  }
  return graphs
}
