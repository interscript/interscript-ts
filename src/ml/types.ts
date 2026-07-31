/**
 * ML types — used by the model registry, sessions, and individual model
 * implementations. Discriminated unions throughout so adding a new
 * model kind or backend is purely additive (OCP).
 */

/**
 * Discriminated union of every supported model kind. Add a new variant
 * here + register a factory; nothing else changes.
 */
export type ModelKind = "rababa" | "secryst"

/**
 * Reference to a model the runtime can provision. Discriminated by
 * `kind` so the registry can dispatch to the right factory.
 */
export interface ModelRef {
  readonly kind: ModelKind
  /** Model-specific identifier (e.g. "200" for rababa max-len-200). */
  readonly id: string
  /** Optional override URL for the model file (otherwise from manifest). */
  readonly url?: string
}

/**
 * Input to an ONNX inference call. The runtime hands the model a
 * Record of named tensors.
 */
export type TensorData = Int8Array | Int16Array | Int32Array | Float32Array | Float64Array | BigInt64Array

export interface Tensor {
  readonly name: string
  readonly data: TensorData
  readonly dims: readonly number[]
  readonly type: "int8" | "int16" | "int32" | "int64" | "float32" | "float64"
}

export interface InferenceInputs {
  readonly [name: string]: Tensor
}

export interface InferenceOutputs {
  readonly [name: string]: Tensor
}

/**
 * An inference session wraps an ONNX model. Both Node and browser
 * backends implement this interface; callers don't know which.
 */
export interface InferenceSession {
  /** Run inference with named inputs. Returns named outputs. */
  run(inputs: InferenceInputs): Promise<InferenceOutputs>
  /** Input names the model accepts. */
  inputNames: readonly string[]
  /** Output names the model produces. */
  outputNames: readonly string[]
  /** Free native resources held by the session. */
  dispose(): Promise<void>
}

/**
 * A loaded model — has a session plus any auxiliary artifacts
 * (vocabularies, configs). Each ModelKind has its own subclass
 * extending this; the registry returns Model implementations
 * generically.
 */
export interface Model {
  readonly kind: ModelKind
  /** Free native resources. */
  dispose(): Promise<void>
}

/**
 * Factory for a model. Given a provisioned bundle (session + auxiliary
 * data), return a Model implementation.
 *
 * Each kind registers exactly one factory (MECE).
 */
export type ModelFactory = (params: ModelLoadParams) => Promise<Model>

export interface ModelLoadParams {
  readonly session: InferenceSession
  readonly artifacts: ModelArtifacts
}

/**
 * Auxiliary files that ship alongside the model ONNX file:
 * vocabularies, configs, metadata. Loaded by the provisioner before
 * the factory is called.
 */
export interface ModelArtifacts {
  readonly [filename: string]: Uint8Array | string
}
