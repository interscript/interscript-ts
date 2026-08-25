/**
 * Reconciler — port of `rababa/lib/rababa/arabic/reconciler.rb`.
 *
 * Given:
 *   - strOriginal:  original text including digits, punctuation, etc.
 *   - strDiacritized: model output (Arabic letters + haraqat only;
 *     non-Arabic chars dropped by the encoder)
 *
 * Produce a merged string where:
 *   - Arabic letters from `strOriginal` get the haraqat from the
 *     matching position in `strDiacritized`
 *   - Non-Arabic chars from `strOriginal` are preserved at their
 *     original positions
 *
 * The Ruby algorithm:
 *   1. Build pivot map: pairs of (idx_dia, idx_ori) where the chars match
 *   2. Walk both strings, emitting chars from original until next pivot,
 *      then chars from diacritized until next pivot, then the matched
 *      char itself
 *   3. Finalize: remaining diacritized chars, then remaining original chars
 *
 * Direct port — same shape, same edge cases.
 */

import { ARAB_CHARS_NO_SPACE } from "./haraqat.js"

const HARAQAT_SET = new Set(["ْ", "ّ", "ٌ", "ٍ", "ِ", "ً", "َ", "ُ"])
const ARAB_CHARS_SET = new Set(ARAB_CHARS_NO_SPACE)

interface Pivot {
  idxDia: number
  idxOri: number
}

/**
 * Find indices where `dOriginal` and `dDiacritized` agree. Two-pointer
 * scan: for each char in diacritized, find next matching char in original.
 */
function buildPivotMap(
  dOriginal: readonly string[],
  dDiacritized: readonly string[],
): Pivot[] {
  const out: Pivot[] = []
  let idxOri = 0
  for (let idxDia = 0; idxDia < dDiacritized.length; idxDia++) {
    const cDia = dDiacritized[idxDia]!
    for (let i = idxOri; i <= dOriginal.length; i++) {
      if (cDia === dOriginal[i]) {
        idxOri = i
        out.push({ idxDia, idxOri })
        // Skip past arabic letters to avoid double-counting
        if (ARAB_CHARS_SET.has(cDia)) idxOri++
        break
      }
    }
  }
  return out
}

/**
 * Merge original + diacritized into the final output. Direct port of
 * `reconcile_strings`.
 */
export function reconcileStrings(strOriginal: string, strDiacritized: string): string {
  const dOriginal = Array.from(strOriginal).filter((c) => !HARAQAT_SET.has(c))
  const dDiacritized = Array.from(strDiacritized)
  const pivots = buildPivotMap(dOriginal, dDiacritized)

  let out = ""
  let ptDia = 0
  let ptOri = 0

  for (const { idxDia, idxOri } of pivots) {
    if (ptOri < idxOri) {
      for (let i = ptOri; i < idxOri; i++) out += dOriginal[i]
    }
    if (ptDia < idxDia) {
      for (let i = ptDia; i < idxDia; i++) out += dDiacritized[i]
    }
    out += dOriginal[idxOri] ?? ""
    ptDia = idxDia + 1
    ptOri = idxOri + 1
  }

  // Trailing diacritized chars
  for (let i = ptDia; i < dDiacritized.length; i++) out += dDiacritized[i]
  // Trailing original chars
  for (let i = ptOri; i < dOriginal.length; i++) out += dOriginal[i]

  return out
}
