/**
 * Text cleaner — mirrors `rababa/lib/rababa/{cleaner,arabic/cleaner}.rb`.
 *
 * Two cleaners, both pure functions:
 *   - cleanBasic: collapse whitespace, strip
 *   - cleanArabic: keep only VALID_ARABIC chars, then cleanBasic
 */

import { VALID_ARABIC } from "./haraqat.js"

export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ")
}

export function cleanBasic(text: string): string {
  return collapseWhitespace(text).trim()
}

const validArabicSet = new Set(VALID_ARABIC)
export function cleanArabic(text: string): string {
  return cleanBasic(
    Array.from(text)
      .filter((c) => validArabicSet.has(c))
      .join(""),
  )
}
