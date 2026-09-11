/**
 * Speculative decoding across the tier ladder: a small drafter
 * proposes `blockSize` tokens, the verifier decides them all in one
 * full-sequence pass. Greedy verification is output-preserving — the
 * verifier's argmax is authoritative at every position, so the result
 * equals the verifier's plain-path greedy regardless of drafter
 * quality; the drafter only buys speed. On quantized artifacts the
 * plain path may differ from the KV path at near-ties, which stays
 * inside the quality-parity contract (golden-v1 scoping).
 *
 * Policy (block loop, corrections, stats) lives here; mechanics
 * (draft-from-prefix, positional verdicts) are IMFModel methods.
 */

import { normalizeArabicInput, repetitionGuardCut } from "./guards.js"
import { EOS_ID, decode, encode } from "./tokens.js"
import type { IMFModel, DecodeOptions } from "./model.js"

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
export function acceptBlock(verdicts: readonly number[], block: readonly number[]): {
  accepted: number
  correction: number | null
} {
  for (let i = 0; i < block.length; i++) {
    if (verdicts[i] !== block[i]) return { accepted: i, correction: verdicts[i]! }
  }
  return { accepted: block.length, correction: null }
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

    const seq: number[] = []
    const run: RunStats = { blocks: 0, drafted: 0, accepted: 0, bonus: 0 }
    while (seq.length < maxLen) {
      const block = await this.drafter.draft(drafterHidden, seq, this.blockSize)
      if (block.length === 0) break
      run.blocks += 1
      run.drafted += block.length
      const { verdicts, gaps, next } = await this.verifier.review(
        verifierHidden,
        seq,
        block,
      )
      const { accepted, correction } = acceptBlock(verdicts, block)
      run.accepted += accepted

      if (correction !== null) {
        // the verifier overrules at the divergence
        seq.push(...block.slice(0, accepted))
        for (let i = 0; i < accepted; i++) opts.onToken?.(block[i]!, seq.length - accepted + i)
        if (correction !== EOS_ID) {
          seq.push(correction)
          opts.onToken?.(correction, seq.length - 1)
          if (repetitionGuardCut(seq, decode(seq))) break
        }
        continue
      }

      const endsWithEos = block[block.length - 1] === EOS_ID
      const kept = endsWithEos ? block.slice(0, -1) : block
      seq.push(...kept)
      for (let i = 0; i < kept.length; i++) opts.onToken?.(kept[i]!, seq.length - kept.length + i)
      if (endsWithEos) break
      // fully accepted: the pass also resolves one bonus token
      run.bonus += 1
      if (next === EOS_ID) break
      seq.push(next)
      opts.onToken?.(next, seq.length - 1)
      opts.onConfidence?.(gaps[gaps.length - 1] ?? Infinity, seq.length - 1)
      if (repetitionGuardCut(seq, decode(seq))) break
    }

    this.lastStats = { ...run }
    return decode(seq)
  }
}
