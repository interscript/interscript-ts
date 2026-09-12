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
import { normalizeArabicInput, repetitionGuardCut } from "./guards.js"
import { EOS_ID, PAD_ID, decode, encode } from "./tokens.js"

interface InputMeta {
  readonly name: string
  readonly type: string
  readonly shape: ReadonlyArray<string | number>
}

interface MetadataSession extends InferenceSession {
  readonly inputMetadata?: readonly InputMeta[]
}

export interface DecodeCursor {
  /** The model's greedy prediction for the token after everything it
   * has consumed. Valid after seed() or feed(); invalidated by
   * rewindToLen() until the next feed. */
  readonly pending: number
  /** Consumed token count ([PAD] counts as the first). */
  readonly length: number
  /** Consume [PAD]; returns the first pending prediction. */
  seed(): Promise<number>
  /** Consume tokens; returns the argmax after each fed position and
   * updates pending to the prediction after the last. */
  feed(tokens: readonly number[]): Promise<number[]>
  /** Truncate consumption to n tokens (1 = [PAD] only). The caller
   * must feed again before reading pending. */
  rewindToLen(n: number): void
}

export interface DecodeOptions {
  /** skip input normalization (raw text) */
  readonly raw?: boolean
  /** streaming: called per emitted token (TODO.client-work 03) */
  readonly onToken?: (token: number, step: number) => void
  /** per-step top1-top2 logit gap; low gap = low confidence (06) */
  readonly onConfidence?: (gap: number, step: number) => void
}

export class IMFModel {
  readonly id: string
  private readonly manifest: IMFManifest
  private readonly encoder: InferenceSession
  private readonly decoder: MetadataSession
  private readonly kv: boolean
  private readonly pasts: ReadonlyArray<{ name: string; dims: readonly number[] }>

  private constructor(manifest: IMFManifest, encoder: InferenceSession, decoder: MetadataSession) {
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
    const decoderName =
      manifest.decoder === "kv" && graphs.has("decoder-kv.onnx")
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

  async translate(text: string, maxLen = 256, opts: DecodeOptions = {}): Promise<string> {
    const hidden = await this.encode(text, opts)
    if (!hidden) return ""
    const tokens = this.kv
      ? await this.greedyKv(hidden, maxLen, opts)
      : await this.greedyPlain(hidden, maxLen, opts)
    return decode(tokens)
  }

  /** Normalized text -> encoder hidden states; null when the input
   * carries no decodable content. Shared entry for composition
   * strategies (e.g. speculative decode). */
  async encode(text: string, opts: DecodeOptions = {}): Promise<Tensor | null> {
    const normalized = opts.raw === true ? text : normalizeArabicInput(text)
    const ids = encode(normalized)
    if (ids.length === 1) return null
    return this.runEncoder(ids)
  }

  /** A greedy decode cursor over this model: consumes tokens once,
   * carries its KV cache across calls (plain-graph models recompute),
   * and exposes what the model predicts after everything consumed.
   * The substrate for speculative decode — one incremental run per
   * block, O(T) total, instead of re-prefilling per call. */
  cursor(hidden: Tensor): DecodeCursor {
    // property captures, not a `this` alias: the closures below keep
    // the enclosing method's receiver without tripping no-this-alias
    const { decoder, kv } = this
    const argmaxAt = (logits: Tensor, position: number) => this.argmaxAt(logits, position)
    const pastTensors = (present: ReadonlyMap<string, Tensor> | undefined) =>
      this.pastTensors(kv ? present : undefined)
    const pastSpecs = this.pasts
    const run = async (
      tokens: readonly number[],
    ): Promise<{
      argmaxes: number[]
      presents: ReadonlyMap<string, Tensor>
      logits: Tensor
    }> => {
      const outputs = await decoder.run({
        input_ids: {
          name: "input_ids",
          type: "int64",
          data: new BigInt64Array(tokens.map((n) => BigInt(n))),
          dims: [1, tokens.length],
        },
        encoder_hidden_states: {
          name: "encoder_hidden_states",
          type: hidden.type,
          data: hidden.data,
          dims: hidden.dims,
        },
        ...pastTensors(present),
      })
      const logits = outputs["logits"]!
      const argmaxes = tokens.map((_, i) => argmaxAt(logits, i).token)
      const presents = kv
        ? new Map(
            pastSpecs.map((spec) => [spec.name, outputs[spec.name.replace("past_", "present_")]!]),
          )
        : new Map()
      return { argmaxes, presents, logits }
    }

    // consumed = tokens the cursor has fed ([PAD] first); KV presents
    // always cover exactly `consumed` positions
    let consumed = 0
    let pending = -1 // valid after seed(), invalidated by rewind
    let present: ReadonlyMap<string, Tensor> | undefined
    let plainSeq: number[] = []

    const slicePresent = (n: number): ReadonlyMap<string, Tensor> => {
      const out = new Map<string, Tensor>()
      for (const [name, t] of present ?? []) {
        const [b, heads, seq, d] = t.dims
        // layout [1, H, S, D]: the first n steps of EACH head are not a
        // contiguous prefix — copy per head into a fresh buffer. IMF v1
        // pasts are float32 (every shipped zip).
        const src = t.data as Float32Array
        const Ctor = src.constructor as new (len: number) => Float32Array
        const sliced = new Ctor(heads! * n * d!)
        const stride = seq! * d!
        for (let h = 0; h < heads!; h++) {
          sliced.set(src.subarray(h * stride, h * stride + n * d!), h * n * d!)
        }
        out.set(name, { name, type: t.type, data: sliced, dims: [b!, heads!, n, d!] })
      }
      return out
    }

    return {
      get pending() {
        return pending
      },
      get length() {
        return consumed
      },
      async seed(): Promise<number> {
        const r = await run([PAD_ID])
        consumed = 1
        plainSeq = [PAD_ID]
        pending = r.argmaxes[0]!
        return pending
      },
      async feed(tokens: readonly number[]): Promise<number[]> {
        if (kv) {
          const r = await run(tokens)
          consumed += tokens.length
          present = r.presents
          pending = r.argmaxes[r.argmaxes.length - 1]!
          return r.argmaxes
        }
        // plain graphs have no pasts: recompute the full sequence and
        // read the argmax after each newly fed position
        const base = plainSeq.length
        plainSeq = [...plainSeq, ...tokens]
        const r = await run(plainSeq)
        consumed = plainSeq.length
        const out = tokens.map((_, i) => argmaxAt(r.logits, base + i).token)
        pending = argmaxAt(r.logits, plainSeq.length - 1).token
        return out
      },
      rewindToLen(n: number): void {
        if (kv) present = slicePresent(n)
        else plainSeq = plainSeq.slice(0, n)
        consumed = n
        pending = -1
      },
    }
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

  private pastTensors(present: ReadonlyMap<string, Tensor> | undefined): Record<string, Tensor> {
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

  private argmaxLastStep(logits: Tensor): { token: number; gap: number } {
    return this.argmaxAt(logits, logits.dims[logits.dims.length - 2]! - 1)
  }

  /** Argmax and top1-top2 gap at a sequence position of the logits
   * tensor [batch, seq, classes]. */
  private argmaxAt(logits: Tensor, position: number): { token: number; gap: number } {
    const dims = logits.dims
    const classes = dims[dims.length - 1]!
    const data = logits.data as Float32Array | BigInt64Array
    const base = position * classes
    let best = 0
    let bestVal = -Infinity
    let secondVal = -Infinity
    for (let c = 0; c < classes; c++) {
      const v =
        typeof data[base + c] === "bigint" ? Number(data[base + c]) : (data[base + c] as number)
      if (v > bestVal) {
        secondVal = bestVal
        bestVal = v
        best = c
      } else if (v > secondVal) {
        secondVal = v
      }
    }
    return { token: best, gap: bestVal - secondVal }
  }

  private async greedyKv(
    hidden: Tensor,
    maxLen: number,
    opts: DecodeOptions = {},
  ): Promise<number[]> {
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
      const { token, gap } = this.argmaxLastStep(outputs["logits"]!)
      if (token === EOS_ID) break
      generated.push(token)
      opts.onToken?.(token, step)
      opts.onConfidence?.(gap, step)
      if (repetitionGuardCut(generated, decode(generated))) break
      present = new Map(
        this.pasts.map((spec) => [spec.name, outputs[spec.name.replace("past_", "present_")]!]),
      )
      current = [token]
    }
    return generated
  }

  private async greedyPlain(
    hidden: Tensor,
    maxLen: number,
    opts: DecodeOptions = {},
  ): Promise<number[]> {
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
      const { token, gap } = this.argmaxLastStep(outputs["logits"]!)
      if (token === EOS_ID) break
      generated.push(token)
      decoderIds.push(token)
      opts.onToken?.(token, step)
      opts.onConfidence?.(gap, step)
      if (repetitionGuardCut(generated, decode(generated))) break
    }
    return generated
  }
}
