/**
 * Ambient declarations for optional peer deps.
 *
 * Users must install `onnxruntime-node` (Node) or `onnxruntime-web`
 * (browser) if they want ML inference. Without these deps, ML
 * functions throw a clear error at runtime.
 *
 * These declarations make the type-checker happy when the deps
 * aren't installed.
 */

declare module "onnxruntime-node" {
  export interface OnnxTensor {
    readonly type: string
    readonly data: unknown
    readonly dims: readonly number[]
  }
  export interface OnnxSession {
    readonly inputNames: readonly string[]
    readonly outputNames: readonly string[]
    run(feeds: Record<string, unknown>): Promise<Record<string, OnnxTensor>>
    release(): Promise<void>
  }
  export const Tensor: new (type: string, data: unknown, dims: readonly number[]) => OnnxTensor
  export const InferenceSession: {
    create(modelData: ArrayBuffer | Uint8Array): Promise<OnnxSession>
  }
}

declare module "onnxruntime-web" {
  export interface OrtTensor {
    readonly type: string
    readonly data: unknown
    readonly dims: readonly number[]
  }
  export interface OrtSession {
    readonly inputNames: readonly string[]
    readonly outputNames: readonly string[]
    run(feeds: Record<string, unknown>, options?: Record<string, unknown>): Promise<Record<string, OrtTensor>>
    release(): Promise<void>
  }
  export const Tensor: new (type: string, data: unknown, dims: readonly number[]) => OrtTensor
  export const InferenceSession: {
    create(
      modelData: ArrayBuffer | Uint8Array,
      options?: Record<string, unknown>,
    ): Promise<OrtSession>
  }
  export const env: {
    wasm: {
      wasmPaths?: string | Record<string, string>
      numThreads?: number
      proxy?: boolean
      simd?: boolean
    }
  }
}
