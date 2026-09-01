/**
 * Client-side decode guards + input normalization
 * (TODO.client-work 01/02), ported from the Python inference harness
 * where they were validated against live int8 student echo loops.
 *
 * The guards stop greedy generation when the output has entered a
 * cycle: flat-byte students echo phrases (with rotating punctuation,
 * so no verbatim token window repeats) until the generation cap.
 */

import { decode } from "./tokens.js"

const HARAQAT = /[ً-ْٰٓ-ٕٖ-ٟۖ-ۭ]/g

const PRESENTATION_LIGATURES: ReadonlyArray<[string, string]> = [
  ["\uFEF5", "\u0644\u0622"],
  ["\uFEF6", "\u0644\u0622"],
  ["\uFEF7", "\u0644\u0623"],
  ["\uFEF8", "\u0644\u0623"],
  ["\uFEF9", "\u0644\u0625"],
  ["\uFEFA", "\u0644\u0625"],
  ["\uFEFB", "\u0644\u0627"],
  ["\uFEFC", "\u0644\u0627"],
]

/** Normalize user input for models trained on stripped text: remove
 * pre-existing haraqat and decompose Arabic presentation-form
 * ligatures. Non-Arabic text passes through untouched. */
export function normalizeArabicInput(text: string): string {
  let out = text.replace(HARAQAT, "")
  for (const [lig, expansion] of PRESENTATION_LIGATURES) {
    out = out.replaceAll(lig, expansion)
  }
  return out
}

const TOKEN_WINDOW = 24
const TEXT_SUFFIX = 16
const TEXT_ECHOES = 3

/** True when generation has entered a repetition cycle and must stop.
 * Token guard: trailing 24-token window occurs verbatim earlier.
 * Text guard: trailing 16 decoded chars echo 3+ times (catches
 * phrase loops whose separators rotate). */
export function repetitionGuardCut(tokens: readonly number[], decodedSoFar: string): boolean {
  if (tokens.length >= 2 * TOKEN_WINDOW) {
    const joined = tokens.join(",")
    const needle = tokens.slice(-TOKEN_WINDOW).join(",")
    if (joined.indexOf(needle) < joined.length - needle.length) return true
  }
  if (tokens.length % 8 === 0 && decodedSoFar.length >= TEXT_SUFFIX * TEXT_ECHOES) {
    const suffix = decodedSoFar.slice(-TEXT_SUFFIX)
    let count = 0
    let at = decodedSoFar.indexOf(suffix)
    while (at !== -1) {
      count++
      at = decodedSoFar.indexOf(suffix, at + 1)
    }
    if (count >= TEXT_ECHOES) return true
  }
  return false
}

/** Decode helper mirroring the runtime loop's guard checks. */
export function guardStep(tokens: number[]): boolean {
  return repetitionGuardCut(tokens, decode(tokens))
}
