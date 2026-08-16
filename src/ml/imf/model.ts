/**
 * IMFModel — a loaded, checksum-verified IMF v1 model. Greedy KV-cache
 * decode when the zip ships decoder-kv.onnx (default), plain
 * full-recompute fallback otherwise. The decode loop is the shared
 * cross-runtime contract; outputs are byte-identical with the Python
 * reference on the golden sets.
 */

import { createSession, type InferenceSession } from "../session/index.js"
import type { Tensor } from "../types.js"
import { verifyAndRead, parseManifest, type IMFManifest } from "./loader.js"
import { resolve } from "./registry.js"
import { EOS_ID, PAD_ID, decode, encode } from "./tokens.js"

interface InputMeta {
  readonly name: string
  readonly type: string
  readonly shape: ReadonlyArray<string | number>
}

interface MetadataSession extends InferenceSession {
  readonly inputMetadata?: readonly InputMeta[]
}

export class IMFModel {
  readonly id: string
  private readonly manifest: IMFManifest
  private readonly encoder: InferenceSession
  private readonly decoder: MetadataSession
  private readonly kv: boolean
  private readonly pasts: ReadonlyArray<{ name: string; dims: readonly number[] }>

  private constructor(
    manifest: IMFManifest,
    encoder: InferenceSession,
    decoder: MetadataSession,
  ) {
    this.manifest = manifest
    this.id = manifest.id
    this.encoder = encoder
    this.decoder = decoder
    this.kv = manifest.decoder === "kv" && decoder.inputNames.some((n) => n.startsWith("past_"))
    this.pasts = this.kv ? this.zeroPastSpecs() : []
  }

  static async fromZipBytes(zipBytes: Uint8Array): Promise<IMFModel> {
    const manifest = parseManifest(zipBytes)
    const graphs = await verifyAndRead(zipBytes)
    const encoder = await createSession(graphs.get("encoder.onnx")!)
    const decoderName = manifest.decoder === "kv" && graphs.has("decoder-kv.onnx")
      ? "decoder-kv.onnx"
      : "decoder.onnx"
    const decoder = (await createSession(graphs.get(decoderName)!)) as MetadataSession
    return new IMFModel(manifest, encoder, decoder)
  }

  /** Accepts a zip path (Node), raw zip bytes, or a models.yaml model id. */
  static async load(source: string | Uint8Array, indexUrl?: string): Promise<IMFModel> {
    if (source instanceof Uint8Array) return IMFModel.fromZipBytes(source)
    if (source.endsWith(".zip")) {
      const fs = (await import("node:fs")) as { readFileSync(path: string): Uint8Array }
      return IMFModel.fromZipBytes(fs.readFileSync(source))
    }
    const resolved = await resolve(source, indexUrl)
    return IMFModel.fromZipBytes(resolved.bytes)
  }

  async translate(text: string, maxLen = 256): Promise<string> {
    const ids = encode(text)
    if (ids.length === 1) return ""
    const hidden = await this.runEncoder(ids)
    const tokens = this.kv ? await this.greedyKv(hidden, maxLen) : await this.greedyPlain(hidden, maxLen)
    return decode(tokens)
  }

  async dispose(): Promise<void> {
    await this.encoder.dispose()
    await this.decoder.dispose()
  }

  private async runEncoder(ids: readonly number[]): Promise<Tensor> {
    const outputs = await this.encoder.run({
      input_ids: {
        name: "input_ids",
        type: "int64",
        data: new BigInt64Array(ids.map((n) => BigInt(n))),
        dims: [1, ids.length],
      },
    })
    return outputs["last_hidden_state"]!
  }

  private zeroPastSpecs(): ReadonlyArray<{ name: string; dims: readonly number[] }> {
    const specs: { name: string; dims: number[] }[] = []
    const metadata = this.decoder.inputMetadata
    for (const name of this.decoder.inputNames) {
      if (!name.startsWith("past_")) continue
      // [batch, heads, past_seq, d_kv]: heads and d_kv are static
      let heads = 6
      let dKv = 64
      const meta = metadata?.find((m) => m.name === name)
      if (meta && typeof meta.shape[1] === "number") heads = meta.shape[1] as number
      if (meta && typeof meta.shape[3] === "number") dKv = meta.shape[3] as number
      specs.push({ name, dims: [1, heads, 0, dKv] })
    }
    return specs
  }

  private pastTensors(
    present: ReadonlyMap<string, Tensor> | undefined,
  ): Record<string, Tensor> {
    const feeds: Record<string, Tensor> = {}
    for (const spec of this.pasts) {
      const value = present?.get(spec.name)
      if (value) {
        feeds[spec.name] = { name: spec.name, type: value.type, data: value.data, dims: value.dims }
      } else {
        feeds[spec.name] = {
          name: spec.name,
          type: "float32",
          data: new Float32Array(0),
          dims: [...spec.dims],
        }
      }
    }
    return feeds
  }

  private argmaxLastStep(logits: Tensor): number {
    const dims = logits.dims
    const classes = dims[dims.length - 1]!
    const data = logits.data as Float32Array | BigInt64Array
    const base = (dims[dims.length - 2]! - 1) * classes
    let best = 0
    let bestVal = -Infinity
    for (let c = 0; c < classes; c++) {
      const v = typeof data[base + c] === "bigint" ? Number(data[base + c]) : (data[base + c] as number)
      if (v > bestVal) {
        bestVal = v
        best = c
      }
    }
    return best
  }

  private async greedyKv(hidden: Tensor, maxLen: number): Promise<number[]> {
    const generated: number[] = []
    let current = [PAD_ID]
    let present: ReadonlyMap<string, Tensor> | undefined
    for (let step = 0; step < maxLen; step++) {
      const outputs = await this.decoder.run({
        input_ids: {
          name: "input_ids",
          type: "int64",
          data: new BigInt64Array(current.map((n) => BigInt(n))),
          dims: [1, current.length],
        },
        encoder_hidden_states: {
          name: "encoder_hidden_states",
          type: hidden.type,
          data: hidden.data,
          dims: hidden.dims,
        },
        ...this.pastTensors(present),
      })
      const token = this.argmaxLastStep(outputs["logits"]!)
      if (token === EOS_ID) break
      generated.push(token)
      present = new Map(
        this.pasts.map((spec) => [spec.name, outputs[spec.name.replace("past_", "present_")]!]),
      )
      current = [token]
    }
    return generated
  }

  private async greedyPlain(hidden: Tensor, maxLen: number): Promise<number[]> {
    const generated: number[] = []
    const decoderIds: number[] = [PAD_ID]
    for (let step = 0; step < maxLen; step++) {
      const outputs = await this.decoder.run({
        input_ids: {
          name: "input_ids",
          type: "int64",
          data: new BigInt64Array(decoderIds.map((n) => BigInt(n))),
          dims: [1, decoderIds.length],
        },
        encoder_hidden_states: {
          name: "encoder_hidden_states",
          type: hidden.type,
          data: hidden.data,
          dims: hidden.dims,
        },
      })
      const token = this.argmaxLastStep(outputs["logits"]!)
      if (token === EOS_ID) break
      generated.push(token)
      decoderIds.push(token)
    }
    return generated
  }
}
