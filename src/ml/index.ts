/**
 * Public API for ML inference in interscript-ts.
 *
 * End users don't import this directly — they call `transliterateAsync`
 * and the runtime transparently loads ML models when a map requires
 * one. This module is for:
 *   - Internal stdlib integration (rababa/secryst functions)
 *   - Power users who want to load models directly
 *
 * Usage:
 *   import { loadModel } from "interscript-ts/ml"
 *   const rababa = await loadModel({ kind: "rababa", id: "200" })
 *
 * Models register themselves on first import of this module's
 * `models/` submodules.
 */

export type {
  Model,
  ModelArtifacts,
  ModelFactory,
  ModelKind,
  ModelLoadParams,
  ModelRef,
  InferenceInputs,
  InferenceOutputs,
  InferenceSession,
  Tensor,
} from "./types.js"

export { registerModel, loadModel, registeredKinds, resetModels } from "./registry.js"

export { createSession, detectBackend } from "./session/index.js"

/**
 * @deprecated CDN-base override for the deprecated manifest-based
 *   provisioner. IMF models resolve through the GitHub Releases
 *   index instead.
 */
export { setModelBase, getModelBase } from "./provision/base.js"

/**
 * @deprecated The manifest-based provisioner (loose .onnx + sidecars
 *   behind a version→URL manifest) is superseded by the IMF registry:
 *   `import { imf } from "interscript/ml"` → `imf.resolve("<model-id>")`
 *   (GitHub Releases index, sha256-verified zips). Kept for explicit-URL
 *   provisioning and inline-manifest (test/air-gapped) use; no manifest
 *   is published anymore.
 */
export {
  loadManifest,
  resolveManifestEntry,
  artifactUrls,
  sidecarFilenames,
  setInlineManifest,
  setManifestUrl,
  type AssetVariant,
  /** @deprecated — see the block comment above */
  type Manifest,
  /** @deprecated — see the block comment above */
  type ManifestModelEntry,
} from "./provision/manifest.js"

/**
 * The IMF v1 registry — models.yaml resolution over GitHub Releases
 * (sha256-sidecar-verified). This is the canonical way to load models
 * by id; `import { imf } from "interscript/ml"`.
 */
export * as imf from "./imf/index.js"

// Side-effect: register built-in model kinds. Adding a new model kind
// = adding a new import here. Order doesn't matter.
import "./models/rababa/index.js"
import "./models/secryst/index.js"
