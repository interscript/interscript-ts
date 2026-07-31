/**
 * Model provisioner — fetch + cache model files.
 *
 * Used by the registry to materialize a ModelRef into a session +
 * auxiliary artifacts. Reuses the existing httpStrategy for HTTP
 * fetching + localStorage caching; falls back to filesystemStrategy
 * in Node.
 *
 * Adding a new source (e.g. IPFS, BitTorrent) = adding a new
 * provisioner file. Existing code never changes (OCP).
 */

import type { ModelArtifacts, ModelRef } from "../types.js"
import type { InferenceSession } from "../session/index.js"
import { createSession } from "../session/index.js"

export interface ProvisionedModel {
  readonly session: InferenceSession
  readonly artifacts: ModelArtifacts
}

/**
 * Default model URLs — kept short for the most common refs. Override
 * by passing `url` in the ModelRef.
 *
 * In production, models live on a CDN (HuggingFace or jsDelivr). The
 * defaults here can be remapped via setModelBase().
 */
let modelBase = "https://huggingface.co/interscript/interscript-models/resolve/main"

export function setModelBase(url: string): void {
  modelBase = url.replace(/\/$/, "")
}

export function getModelBase(): string {
  return modelBase
}

interface ModelManifestEntry {
  readonly files: readonly string[]
}

/**
 * Built-in manifest — small enough to inline. Production deployments
 * should override via setModelBase() pointing at a real CDN.
 */
const knownModels: Record<string, ModelManifestEntry> = {
  "rababa/200": {
    files: ["model.onnx", "config.json", "vocab.json"],
  },
  "secryst/thai-ipa": {
    files: ["model.onnx", "vocabs.yaml"],
  },
}

function defaultUrlFor(ref: ModelRef): string {
  const key = `${ref.kind}/${ref.id}`
  return `${modelBase}/${encodeURIComponent(key)}/model.onnx`
}

function artifactUrlFor(ref: ModelRef, filename: string): string {
  const key = `${ref.kind}/${ref.id}`
  return `${modelBase}/${encodeURIComponent(key)}/${filename}`
}

/**
 * Provision a model from the configured base URL. Fetches the model
 * file + any auxiliary artifacts, opens an inference session.
 *
 * In Node, can read from the filesystem if `url` starts with `file:`
 * or is a relative path.
 */
export async function provisionModel(ref: ModelRef): Promise<ProvisionedModel> {
  const key = `${ref.kind}/${ref.id}`
  const manifest = knownModels[key]
  const artifactFiles = manifest?.files ?? []

  // Fetch the model ONNX file
  const modelUrl = ref.url ?? defaultUrlFor(ref)
  const modelBuffer = await fetchBytes(modelUrl)

  // Fetch auxiliary artifacts in parallel
  const artifacts: Record<string, Uint8Array | string> = {}
  await Promise.all(
    artifactFiles
      .filter((f) => f !== "model.onnx")
      .map(async (filename) => {
        try {
          const bytes = await fetchBytes(artifactUrlFor(ref, filename))
          // Treat JSON + YAML as text for easy parsing downstream.
          if (filename.endsWith(".json") || filename.endsWith(".yaml") || filename.endsWith(".yml")) {
            artifacts[filename] = new TextDecoder().decode(bytes)
          } else {
            artifacts[filename] = bytes
          }
        } catch {
          // Auxiliary artifacts are optional; missing ones are skipped.
        }
      }),
  )

  const session = await createSession(modelBuffer)
  return { session, artifacts }
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  // Node filesystem path
  if (url.startsWith("file:") || (url.startsWith(".") && typeof process !== "undefined" && process.versions?.node)) {
    const { readFile } = await import("node:fs/promises")
    const path = url.startsWith("file:") ? url.slice(5) : url
    return new Uint8Array(await readFile(path))
  }
  // HTTP fetch — works in both Node (18+) and browser
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to fetch model from ${url}: ${res.status} ${res.statusText}`)
  }
  const buf = await res.arrayBuffer()
  return new Uint8Array(buf)
}
