/**
 * Node.js backend — wraps onnxruntime-node.
 *
 * Server-only: requires Node native modules. Imported lazily by the
 * session factory only when the runtime detects a Node environment.
 * Don't import this from browser bundles.
 */

import type {
  InferenceSession,
  InferenceInputs,
  InferenceOutputs,
  Tensor,
  TensorData,
} from "../types.js"

// onnxruntime-node is a peer dep — users install it if they need ML.
// We import dynamically so the package can be tree-shaken out.
type OnnxNodeSession = {
  readonly inputNames: readonly string[]
  readonly outputNames: readonly string[]
  run(feeds: Record<string, unknown>): Promise<Record<string, unknown>>
  release(): Promise<void>
}

interface OnnxNodeModule {
  InferenceSession: {
    create(modelData: ArrayBuffer | Uint8Array): Promise<OnnxNodeSession>
  }
  Tensor: new (type: string, data: TensorData, dims: readonly number[]) => unknown
}

async function loadOrt(): Promise<OnnxNodeModule> {
  try {
    return (await import("onnxruntime-node")) as unknown as OnnxNodeModule
  } catch (e) {
    throw new Error(
      "onnxruntime-node is required for ML inference in Node. Install with: npm install onnxruntime-node",
      { cause: e },
    )
  }
}

class NodeInferenceSession implements InferenceSession {
  private readonly session: OnnxNodeSession
  private readonly ort: OnnxNodeModule
  readonly inputNames: readonly string[]
  readonly outputNames: readonly string[]
  readonly inputMetadata?: ReadonlyArray<{ name: string; type: string; shape: ReadonlyArray<string | number> }> | undefined

  private constructor(session: OnnxNodeSession, ort: OnnxNodeModule) {
    this.session = session
    this.ort = ort
    this.inputNames = session.inputNames
    this.outputNames = session.outputNames
    const raw = (session as { inputMetadata?: unknown }).inputMetadata
    if (Array.isArray(raw)) {
      this.inputMetadata = raw as NodeInferenceSession["inputMetadata"]
    }
  }

  static async create(modelData: ArrayBuffer | Uint8Array): Promise<NodeInferenceSession> {
    const ort = await loadOrt()
    const session = await ort.InferenceSession.create(modelData)
    return new NodeInferenceSession(session, ort)
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

export async function createNodeSession(modelData: ArrayBuffer | Uint8Array): Promise<InferenceSession> {
  return NodeInferenceSession.create(modelData)
}
