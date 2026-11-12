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
    create(
      modelData: ArrayBuffer | Uint8Array,
      options?: { intraOpNumThreads?: number },
    ): Promise<OnnxNodeSession>
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

/**
 * float16 feeds cannot cross the onnxruntime-node binding on runtimes
 * with native Float16Array (Node >= 24): ORT's JS Tensor converts every
 * float16 feed into a Float16Array view, and the N-API binding reads
 * that buffer as zero bytes, so session.run fails with the opaque
 * "not enough space: expected N, got 0" (issue #111). On pre-Float16Array
 * runtimes the same feed stays Uint16Array-backed and is consumed fine
 * (verified Node 20/22 ok, Node 24/26 broken). Artifacts with float16
 * graph I/O (the pre-WO79 fp16 exports) must be IO-normalized instead:
 * interscript-models tools/normalize_fp16_io.py.
 */
const FLOAT16_FEEDS_CONSUMABLE =
  typeof (globalThis as { Float16Array?: unknown }).Float16Array === "undefined"

class NodeInferenceSession implements InferenceSession {
  private readonly session: OnnxNodeSession
  private readonly ort: OnnxNodeModule
  readonly inputNames: readonly string[]
  readonly outputNames: readonly string[]
  readonly inputMetadata?:
    ReadonlyArray<{ name: string; type: string; shape: ReadonlyArray<string | number> }> | undefined

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
    // single-thread decode: the conformance contract is byte-exact
    // across environments (WO79); multi-thread fp16 ties flip rows
    const session = await ort.InferenceSession.create(modelData, {
      intraOpNumThreads: 1,
    })
    return new NodeInferenceSession(session, ort)
  }

  async run(inputs: InferenceInputs): Promise<InferenceOutputs> {
    const feeds: Record<string, unknown> = {}
    for (const [name, tensor] of Object.entries(inputs)) {
      if (tensor.type === "float16" && !FLOAT16_FEEDS_CONSUMABLE) {
        throw new Error(
          `input '${name}' is float16: float16 graph I/O cannot cross the onnxruntime-node ` +
            `binding on this runtime (the feed is converted to a Float16Array the binding reads ` +
            `as zero bytes, surfacing as "not enough space: expected N, got 0"). The artifact's ` +
            `graphs must expose fp32 graph I/O — re-export with interscript-models ` +
            `tools/normalize_fp16_io.py.`,
        )
      }
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

export async function createNodeSession(
  modelData: ArrayBuffer | Uint8Array,
): Promise<InferenceSession> {
  return NodeInferenceSession.create(modelData)
}
