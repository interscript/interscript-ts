/**
 * Rababa diacritizer — port of `rababa/lib/rababa/arabic/diacritizer.rb`.
 *
 * Pipeline:
 *   text → clean → strip diacritics → encode to IDs
 *        → ONNX inference ({src, lengths}) → logits
 *        → argmax over classes → haraqat IDs
 *        → combine: original letters + predicted haraqat
 *        → reconcile with original input (preserves non-Arabic chars)
 *
 * The model file is loaded by the provisioner; we receive an
 * InferenceSession + config artifacts.
 */

import type {
  InferenceSession,
  Model,
  MLModel,
  ModelArtifacts,
  ModelKind,
  Tensor,
} from "../../types.js"
import { ArabicEncoder } from "./encoder.js"
import { reconcileStrings } from "./reconciler.js"
import { ID_TO_HARAAQAT, INPUT_ID_TO_SYMBOL } from "./haraqat.js"

export interface RababaConfig {
  readonly maxLen: number
  readonly batchSize: number
  readonly textEncoder: "BasicArabicEncoder" | "ArabicEncoderWithStartSymbol"
  readonly textCleaner: "basic_cleaners" | "valid_arabic_cleaners"
}

const DEFAULT_CONFIG: RababaConfig = {
  maxLen: 200,
  batchSize: 1,
  textEncoder: "ArabicEncoderWithStartSymbol",
  textCleaner: "valid_arabic_cleaners",
}

export interface RababaModel extends MLModel {
  readonly kind: ModelKind
  diacritize(text: string): Promise<string>
  transform(input: string): Promise<string>
  dispose(): Promise<void>
}

class RababaModelImpl implements RababaModel {
  readonly kind: ModelKind = "rababa"
  private readonly session: InferenceSession
  private readonly encoder: ArabicEncoder
  private readonly config: RababaConfig

  constructor(session: InferenceSession, config: RababaConfig) {
    this.session = session
    this.config = config
    this.encoder = new ArabicEncoder({
      cleaner: config.textCleaner === "valid_arabic_cleaners" ? "arabic" : "basic",
      startSymbol: config.textEncoder === "ArabicEncoderWithStartSymbol",
    })
  }

  async diacritize(text: string): Promise<string> {
    // Truncate if too long
    let truncated = text
    if (truncated.length > this.config.maxLen) {
      truncated = truncated.slice(0, this.config.maxLen)
    }

    // Clean → strip existing diacritics → encode
    const cleaned = this.encoder.clean(truncated)
    const stripped = this.stripDiacritics(cleaned)
    const sequence = this.encoder.inputToSequence(stripped)
    if (sequence.length === 0) return truncated

    // Replicate the sequence batch_size times, padded to maxLen.
    // The trained rababa model is fixed-shape [batch_size, max_len].
    // We replicate the input row batch_size times (matching Ruby's
    // diacritize_text) and pad each row to maxLen with the pad token.
    const batchSize = this.config.batchSize
    const maxLen = this.config.maxLen
    const padToken = this.encoder.inputPadId
    const flat: number[] = []
    for (let b = 0; b < batchSize; b++) {
      for (let i = 0; i < maxLen; i++) {
        flat.push(i < sequence.length ? sequence[i]! : padToken)
      }
    }

    // Inference: {src, lengths}
    const src: Tensor = {
      name: "src",
      type: "int64",
      data: new BigInt64Array(flat.map((n) => BigInt(n))),
      dims: [batchSize, maxLen],
    }
    const lengths: Tensor = {
      name: "lengths",
      type: "int64",
      data: new BigInt64Array(Array(batchSize).fill(BigInt(maxLen))),
      dims: [batchSize],
    }
    const outputs = await this.session.run({ src, lengths })

    // Outputs[0] is the predictions tensor: [batch, seq, classes].
    const out = outputs[this.session.outputNames[0]!]
    if (!out) throw new Error("Rababa model produced no output")

    const preds = argmaxBatch(out, sequence.length)
    const combined = combineTextAndHaraqat(sequence, preds, this.encoder.inputPadId)
    return reconcileStrings(cleaned, combined)
  }

  /** Unified MLModel interface — delegates to diacritize. */
  async transform(input: string): Promise<string> {
    return this.diacritize(input)
  }

  /**
   * Strip haraqat from text — direct port of the Ruby
   * remove_diacritics. We reuse the encoder's vocab check.
   */
  private stripDiacritics(text: string): string {
    return Array.from(text)
      .filter((c) => !/[ً-ْ]/.test(c))
      .join("")
  }

  async dispose(): Promise<void> {
    await this.session.dispose()
  }
}

/**
 * Argmax over the last axis of a [batch, seq, classes] tensor.
 * Returns one class index per (batch, seq) position.
 */
function argmaxBatch(tensor: Tensor, seqLen: number): number[] {
  const dims = tensor.dims
  // Last dim is classes
  const classCount = dims[dims.length - 1]!
  const out: number[] = []
  // Treat data as flat floats or ints
  const data = tensor.data as Float32Array | Int32Array | BigInt64Array
  for (let i = 0; i < seqLen; i++) {
    let best = 0
    let bestVal = -Infinity
    const base = i * classCount
    for (let c = 0; c < classCount; c++) {
      const v = typeof data[base + c] === "bigint"
        ? Number(data[base + c])
        : (data[base + c] as number)
      if (v > bestVal) {
        bestVal = v
        best = c
      }
    }
    out.push(best)
  }
  return out
}

/**
 * Combine input token IDs + haraqat IDs into a diacritized string.
 * Direct port of `combine_text_and_haraqat`.
 */
function combineTextAndHaraqat(vecTxt: readonly number[], vecHaraqat: readonly number[], padId: number): string {
  let text = ""
  for (let i = 0; i < vecTxt.length; i++) {
    const txt = vecTxt[i]!
    if (txt === padId) break
    const haraq = vecHaraqat[i] ?? 0
    const symbol = INPUT_ID_TO_SYMBOL[txt] ?? ""
    const haraqStr = ID_TO_HARAAQAT[haraq] ?? ""
    // Skip the pad and unused start tokens in the target vocab —
    // they decode to "P" or "" and shouldn't appear in output.
    if (haraqStr === "P") continue
    text += symbol + haraqStr
  }
  return text
}

/**
 * Factory: builds a RababaModel from a session + artifacts.
 *
 * Registered as the factory for kind "rababa" in src/ml/index.ts.
 */
export async function createRababaModel(params: {
  readonly session: InferenceSession
  readonly artifacts: ModelArtifacts
  readonly config?: RababaConfig
}): Promise<RababaModel> {
  const config = params.config ?? parseConfig(params.artifacts["config.json"])
  return new RababaModelImpl(params.session, config)
}

function parseConfig(raw: string | Uint8Array | undefined): RababaConfig {
  if (!raw) return DEFAULT_CONFIG
  try {
    const json = typeof raw === "string" ? JSON.parse(raw) : JSON.parse(new TextDecoder().decode(raw))
    return {
      maxLen: Number(json.max_len ?? json.maxLen ?? DEFAULT_CONFIG.maxLen),
      batchSize: Number(json.batch_size ?? json.batchSize ?? DEFAULT_CONFIG.batchSize),
      textEncoder: (json.text_encoder ?? DEFAULT_CONFIG.textEncoder) as RababaConfig["textEncoder"],
      textCleaner: (json.text_cleaner ?? DEFAULT_CONFIG.textCleaner) as RababaConfig["textCleaner"],
    }
  } catch {
    return DEFAULT_CONFIG
  }
}
