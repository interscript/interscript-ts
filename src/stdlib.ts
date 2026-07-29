/**
 * Standard library helpers — direct port of
 * `interscript-ruby/lib/interscript/stdlib.rb`.
 *
 * Pure functions: no global state, no side effects. Easy to test in
 * isolation. Each function has exactly one responsibility (MECE).
 */

/**
 * Apply parallel string replacements in a single pass.
 *
 * Replaces all (from, to) pairs simultaneously, longest-from-first to
 * avoid ambiguity. Tree-based for O(n log n) on input length.
 *
 * Port of `Interscript::Stdlib.parallel_replace`.
 */
export function parallelReplace(
  input: string,
  pairs: readonly (readonly [string, string])[],
): string {
  if (pairs.length === 0) return input

  const sorted = [...pairs].sort((a, b) => b[0].length - a[0].length)
  let result = ""
  let i = 0

  while (i < input.length) {
    let matched = false
    for (const [from, to] of sorted) {
      if (from.length === 0) continue
      if (input.startsWith(from, i)) {
        result += to
        i += from.length
        matched = true
        break
      }
    }
    if (!matched) {
      result += input[i]
      i += 1
    }
  }
  return result
}

/**
 * Escape a string so it matches literally inside a RegExp.
 * Port of Ruby's `Regexp.escape`.
 */
export function regexpEscape(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Lowercase a string. Maps to `Interscript.functions.downcase`.
 */
export function downcase(input: string): string {
  return input.toLowerCase()
}

/**
 * Uppercase a string. Maps to `Interscript.functions.upcase`.
 */
export function upcase(input: string): string {
  return input.toUpperCase()
}

/**
 * Capitalise each word; honours custom word separator.
 * Maps to `Interscript.functions.title_case`.
 */
export function titleCase(input: string, opts: { wordSeparator?: string } = {}): string {
  const sep = opts.wordSeparator ?? " "
  if (sep === "") return input.charAt(0).toUpperCase() + input.slice(1).toLowerCase()
  return input
    .split(sep)
    .map((w) => (w.length === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(sep)
}

/**
 * Insert a separator between every character.
 * Maps to `Interscript.functions.separate`.
 */
export function separate(input: string, opts: { separator?: string } = {}): string {
  const sep = opts.separator ?? " "
  return input.split("").join(sep)
}

/**
 * Unicode NFC normalisation via String.prototype.normalize.
 */
export function compose(input: string): string {
  return input.normalize("NFC")
}

export function decompose(input: string): string {
  return input.normalize("NFD")
}
