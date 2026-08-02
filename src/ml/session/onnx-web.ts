/**
 * Browser backend — wraps onnxruntime-web (WASM by default, optional
 * WebGPU).
 *
 * Imported lazily by the session factory. Bundlers will only include
 * this in browser builds.
 *
 * onnxruntime-web is a peer dep; users install it if they need ML.
 * Without it, calling rababa() from the browser throws a clear error.
 */

import type {
  InferenceSession,
  InferenceInputs,
  InferenceOutputs,
  Tensor,
  TensorData,
} from "../types.js"

type OrtWebSession = {
  readonly inputNames: readonly string[]
  readonly outputNames: readonly string[]
  run(feeds: Record<string, unknown>, options?: Record<string, unknown>): Promise<Record<string, unknown>>
  release(): Promise<void>
}

interface OrtWebModule {
  InferenceSession: {
    create(
      modelData: ArrayBuffer | Uint8Array,
      options?: Record<string, unknown>,
    ): Promise<OrtWebSession>
  }
  Tensor: new (type: string, data: TensorData, dims: readonly number[]) => unknown
  env: {
    wasm: {
      wasmPaths?: string | Record<string, string>
      numThreads?: number
      proxy?: boolean
      simd?: boolean
    }
  }
}

let cached: Promise<OrtWebModule> | undefined

async function loadOrt(): Promise<OrtWebModule> {
  if (!cached) {
    cached = (async () => {
      try {
        const mod = (await import("onnxruntime-web")) as unknown as OrtWebModule
        // Use SIMD when available (~2x faster)
        mod.env.wasm.simd = true
        return mod
      } catch (e) {
        cached = undefined
        throw new Error(
          "onnxruntime-web is required for ML inference in the browser. Install with: npm install onnxruntime-web",
          { cause: e },
        )
      }
    })()
  }
  return cached
}

class WebInferenceSession implements InferenceSession {
  private readonly session: OrtWebSession
  private readonly ort: OrtWebModule
  readonly inputNames: readonly string[]
  readonly outputNames: readonly string[]

  private constructor(session: OrtWebSession, ort: OrtWebModule) {
    this.session = session
    this.ort = ort
    this.inputNames = session.inputNames
    this.outputNames = session.outputNames
  }

  static async create(modelData: ArrayBuffer | Uint8Array): Promise<WebInferenceSession> {
    const ort = await loadOrt()
    const session = await ort.InferenceSession.create(modelData)
    return new WebInferenceSession(session, ort)
  }

  async run(inputs: InferenceInputs): Promise<InferenceOutputs> {
    const feeds: Record<string, unknown> = {}
    for (const [name, tensor] of Object.entries(inputs)) {
      feeds[name] = new this.ort.Tensor(tensor.type, tensor.data, tensor.dims)
    }
    const outputs = await this.session.run(feeds)
    const out: Record<string, Tensor> = {}
    for (const [name, value] of Object.entries(outputs)) {
      const v = value as { type: string; data: TensorData; dims: number[] }
      out[name] = {
        name,
        type: v.type as Tensor["type"],
        data: v.data,
        dims: v.dims,
      }
    }
    return out
  }

  async dispose(): Promise<void> {
    await this.session.release()
  }
}

export async function createWebSession(modelData: ArrayBuffer | Uint8Array): Promise<InferenceSession> {
  return WebInferenceSession.create(modelData)
}
