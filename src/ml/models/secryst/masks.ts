/**
 * Attention masks for the Secryst transformer.
 *
 * Port of the mask construction logic from
 * `secryst/lib/secryst/translator.rb`.
 *
 * The transformer needs three mask types:
 *   - tgt_mask: causal mask (lower-triangular) prevents attending to future positions
 *   - src_key_padding_mask: marks padding tokens in the source
 *   - tgt_key_padding_mask: marks padding tokens in the target
 *   - memory_key_padding_mask: same as src_key_padding_mask
 */

import type { Tensor } from "../../types.js"

/**
 * Build a causal (lower-triangular) attention mask.
 * Shape: [seq_len, seq_len]. 1 = allowed, 0 = masked.
 *
 * Port of: Numo::DFloat.ones(n,n).triu.transpose.eq(0)
 * → upper triangular of ones → transpose → lower triangular → negate
 */
export function causalMask(seqLen: number): Uint8Array {
  const mask = new Uint8Array(seqLen * seqLen)
  for (let i = 0; i < seqLen; i++) {
    for (let j = 0; j < seqLen; j++) {
      // Allow attention to positions ≤ current position (causal)
      mask[i * seqLen + j] = j <= i ? 1 : 0
    }
  }
  return mask
}

/**
 * Build a padding mask from a token ID sequence.
 * Pad ID = 1 in secryst (matching the Ruby code).
 * Shape: [batch, seq_len]. 1 = real token, 0 = padding.
 */
export function paddingMask(
  tokens: readonly number[],
  padId: number = 1,
): Uint8Array {
  return new Uint8Array(tokens.map((t) => (t === padId ? 0 : 1)))
}

/**
 * Construct all masks needed for one inference step.
 * Returns tensors in the format the ONNX model expects.
 */
export function buildMasks(
  srcLen: number,
  tgtLen: number,
  srcIds: readonly number[],
  tgtIds: readonly number[],
): Record<string, Tensor> {
  const tgt = causalMask(tgtLen)
  const srcPad = paddingMask(srcIds)
  const tgtPad = paddingMask(tgtIds)

  return {
    tgt_mask: {
      name: "tgt_mask",
      type: "int8",
      data: tgt,
      dims: [tgtLen, tgtLen],
    },
    src_key_padding_mask: {
      name: "src_key_padding_mask",
      type: "int8",
      data: srcPad,
      dims: [1, srcLen],
    },
    tgt_key_padding_mask: {
      name: "tgt_key_padding_mask",
      type: "int8",
      data: tgtPad,
      dims: [1, tgtLen],
    },
    memory_key_padding_mask: {
      name: "memory_key_padding_mask",
      type: "int8",
      data: srcPad,
      dims: [1, srcLen],
    },
  }
}
