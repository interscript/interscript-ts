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

export {
  registerModel,
  loadModel,
  registeredKinds,
  resetModels,
} from "./registry.js"

export { createSession, detectBackend } from "./session/index.js"

export { setModelBase, getModelBase } from "./provision/base.js"

export {
  loadManifest,
  resolveManifestEntry,
  artifactUrls,
  sidecarFilenames,
  setInlineManifest,
  setManifestUrl,
  type AssetVariant,
  type Manifest,
  type ManifestModelEntry,
} from "./provision/manifest.js"

// Side-effect: register built-in model kinds. Adding a new model kind
// = adding a new import here. Order doesn't matter.
import "./models/rababa/index.js"
import "./models/secryst/index.js"
