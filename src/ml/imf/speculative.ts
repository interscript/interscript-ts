/**
 * Speculative decoding across the tier ladder: a small drafter
 * proposes `blockSize` tokens, the verifier decides them all in one
 * incremental pass. Greedy verification is output-preserving — the
 * verifier's argmax is authoritative at every position, so the result
 * equals the verifier's own greedy decode regardless of drafter
 * quality.
 *
 * Cost model: both cursors carry their KV caches across blocks — one
 * incremental decoder run per block per model, O(T) total. (The first
 * implementation re-prefilled from zero every block: O(T^2), measured
 * 5.7x slower than plain decode despite 0.988 acceptance — see
 * interscript-ml RESULTS.md 2026-09-12. This is the fix.)
 *
 * Policy (block loop, corrections, stats) lives here; mechanics
 * (feed-with-pasts, cache rewind) are IMFModel cursor methods.
 * DecodeOptions.onConfidence is not emitted on this path — block
 * verdicts are argmax-only.
 *
 * QUANTIZED-ARTIFACT CONSTRAINT (measured 2026-09-12, interscript-ml
 * RESULTS.md): dynamic-int8/int4 ONNX graphs compute activation
 * quantization scales per fed tensor, so single-step and batched
 * framings produce materially different decodes — on an int4→int8
 * pair the batched-verifier output lost a word and runtime acceptance
 * measured 0.46 (the 0.99 probe figure was a uniform-framing
 * artifact). Treat this class as measurement infrastructure on
 * quantized artifacts; output preservation vs translate() holds for
 * fp-class artifacts (or any pair with framing-consistent numerics).
 */

import { normalizeArabicInput, repetitionGuardCut } from "./guards.js"
import { EOS_ID, decode, encode } from "./tokens.js"
import type { IMFModel, DecodeOptions, DecodeCursor } from "./model.js"

export interface SpeculativeOptions {
  /** draft tokens per verifier pass (default 8) */
  readonly blockSize?: number
}

export interface SpeculativeStats {
  readonly blocks: number
  readonly drafted: number
  readonly accepted: number
  readonly bonus: number
}

/** The acceptance rule: how many leading draft tokens the verdicts
 * confirm, and the verifier's pick at the first divergence (null when
 * the whole block is accepted). */
export function acceptBlock(
  verdicts: readonly number[],
  block: readonly number[],
): {
  accepted: number
  correction: number | null
} {
  for (let i = 0; i < block.length; i++) {
    if (verdicts[i] !== block[i]) return { accepted: i, correction: verdicts[i]! }
  }
  return { accepted: block.length, correction: null }
}

/** Verdicts over a fed block from the cursor protocol: the pending
 * prediction from before the feed decides block[0]; the prediction
 * after block[i] decides block[i+1]; the prediction after the last
 * fed token becomes the next pending. */
export function verdictsFromFeed(
  pendingBefore: number,
  block: readonly number[],
  feedResults: readonly number[],
): { verdicts: number[]; nextPending: number } {
  const verdicts = [pendingBefore, ...feedResults.slice(0, block.length - 1)]
  return { verdicts, nextPending: feedResults[feedResults.length - 1]! }
}

interface RunStats {
  blocks: number
  drafted: number
  accepted: number
  bonus: number
}

export class SpeculativeModel {
  readonly drafter: IMFModel
  readonly verifier: IMFModel
  readonly blockSize: number
  private lastStats: SpeculativeStats | undefined
  private lastNormalized: string | undefined

  constructor(drafter: IMFModel, verifier: IMFModel, opts: SpeculativeOptions = {}) {
    this.drafter = drafter
    this.verifier = verifier
    this.blockSize = opts.blockSize ?? 8
  }

  /** Stats from the last translate() call. */
  stats(): SpeculativeStats | undefined {
    return this.lastStats
  }

  /** The normalized input of the last translate() call — both models
   * saw exactly this text. */
  lastNormalizedInput(): string | undefined {
    return this.lastNormalized
  }

  async translate(text: string, maxLen = 256, opts: DecodeOptions = {}): Promise<string> {
    const normalized = opts.raw === true ? text : normalizeArabicInput(text)
    this.lastNormalized = normalized
    if (encode(normalized).length === 1) return ""
    const drafterHidden = await this.drafter.encode(normalized, { raw: true })
    const verifierHidden = await this.verifier.encode(normalized, { raw: true })
    if (!drafterHidden || !verifierHidden) return ""

    const draftCursor = this.drafter.cursor(drafterHidden)
    const verifyCursor = this.verifier.cursor(verifierHidden)
    let pendingDraft = await draftCursor.seed()
    let pendingVerify = await verifyCursor.seed()

    const seq: number[] = []
    const run: RunStats = { blocks: 0, drafted: 0, accepted: 0, bonus: 0 }

    while (seq.length < maxLen) {
      const { block, pending } = await this.draftBlock(
        draftCursor,
        pendingDraft,
        seq.length,
        maxLen,
      )
      if (block.length === 0) break
      pendingDraft = pending
      run.blocks += 1
      run.drafted += block.length

      const feedResults = await verifyCursor.feed(block)
      const { verdicts, nextPending } = verdictsFromFeed(pendingVerify, block, feedResults)
      pendingVerify = nextPending
      const { accepted, correction } = acceptBlock(verdicts, block)
      run.accepted += accepted
      const seqBefore = seq.length

      if (correction !== null) {
        // the verifier overrules at the divergence: keep its verdicts
        // up to the divergence, rewind both caches there, and feed the
        // correction — each model's prediction after it becomes the
        // new pending
        seq.push(...block.slice(0, accepted))
        for (let i = 0; i < accepted; i++) opts.onToken?.(block[i]!, seq.length - accepted + i)
        if (correction === EOS_ID) break
        seq.push(correction)
        opts.onToken?.(correction, seq.length - 1)
        verifyCursor.rewindToLen(1 + seqBefore + accepted)
        pendingVerify = (await verifyCursor.feed([correction]))[0]!
        draftCursor.rewindToLen(1 + seqBefore + accepted)
        pendingDraft = (await draftCursor.feed([correction]))[0]!
        if (repetitionGuardCut(seq, decode(seq))) break
        continue
      }

      const endsWithEos = block[block.length - 1] === EOS_ID
      const kept = endsWithEos ? block.slice(0, -1) : block
      seq.push(...kept)
      for (let i = 0; i < kept.length; i++) opts.onToken?.(kept[i]!, seq.length - kept.length + i)
      if (endsWithEos) break
      // fully accepted: the pending verdict resolves one bonus token;
      // feed it so both caches stay aligned with the sequence
      run.bonus += 1
      if (pendingVerify === EOS_ID) break
      seq.push(pendingVerify)
      opts.onToken?.(pendingVerify, seq.length - 1)
      pendingVerify = (await verifyCursor.feed([pendingVerify]))[0]!
      pendingDraft = (await draftCursor.feed([pendingVerify]))[0]!
      if (repetitionGuardCut(seq, decode(seq))) break
    }

    this.lastStats = { ...run }
    return decode(seq)
  }

  /** Draft up to blockSize tokens greedily from the cursor; a
   * trailing EOS is included but not fed. Returns the block and the
   * drafter's pending prediction after it. */
  private async draftBlock(
    cursor: DecodeCursor,
    pending: number,
    seqLen: number,
    maxLen: number,
  ): Promise<{ block: number[]; pending: number }> {
    const block: number[] = []
    let token = pending
    while (block.length < this.blockSize && seqLen + block.length < maxLen) {
      block.push(token)
      if (token === EOS_ID) return { block, pending: token }
      token = (await cursor.feed([token]))[0]!
    }
    return { block, pending: token }
  }
}
