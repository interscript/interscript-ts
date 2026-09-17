/**
 * Windowed long-input handling (the runtime side of the 1400-byte
 * protocol): models train on <=1400-byte windows, so longer inputs are
 * out-of-distribution and degrade. splitWindows reproduces the
 * published harness split exactly (word-boundary, byte-budget);
 * translateWithWindows decodes each window and joins with spaces.
 */

export const BYTE_BUDGET = 1400

/** Split at word boundaries so no window exceeds the byte budget.
 * Identical to the Python harness's split_windows. */
export function splitWindows(text: string, budget: number = BYTE_BUDGET): string[] {
  if (new TextEncoder().encode(text).length <= budget) return [text]
  const windows: string[] = []
  let current: string[] = []
  let n = 0
  // Python str.split(): runs of whitespace, no empty tokens
  for (const word of text.split(/\s+/).filter((w) => w !== "")) {
    const cost = new TextEncoder().encode(word).length + 1
    if (current.length > 0 && n + cost > budget) {
      windows.push(current.join(" "))
      current = []
      n = 0
    }
    current.push(word)
    n += cost
  }
  if (current.length > 0) windows.push(current.join(" "))
  return windows
}

import type { DecodeOptions } from "./model.js"

/** Decode text through `model`, splitting at the training budget when
 * the input is long. Single-window inputs (all golden-set sizes) pass
 * through untouched — cross-runtime parity is unaffected. Both
 * IMFModel.translate and SpeculativeModel.translate route through
 * this, so long inputs never reach a model out-of-distribution. */
export async function translateWindowed(
  model: { translateDirect(text: string, maxLen?: number, opts?: DecodeOptions): Promise<string> },
  text: string,
  maxLen: number,
  opts: DecodeOptions = {},
): Promise<string> {
  const windows = splitWindows(text)
  if (windows.length <= 1) return model.translateDirect(text, maxLen, opts)
  const parts: string[] = []
  for (const w of windows) parts.push(await model.translateDirect(w, maxLen, opts))
  return parts.join(" ")
}
