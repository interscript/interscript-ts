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
  return parallelReplaceTree(input, compileParallelTree(pairs))
}

/**
 * Trie node for parallel replacement. Maps char code → child node.
 * `match` holds the replacement string when this node is the end of a
 * complete "from" pattern.
 *
 * Port of Ruby's nested-hash tree with `nil` sentinel for matches.
 */
export interface ParallelTrieNode {
  readonly children: Map<number, ParallelTrieNode>
  match: string | null
}

export function emptyTrieNode(): ParallelTrieNode {
  return { children: new Map(), match: null }
}

/**
 * Build a trie from (from, to) pairs. Each "from" string becomes a path
 * from root through character codes; the final node holds `match = to`.
 *
 * Multiple "from"s can share prefixes naturally. Longest match wins at
 * runtime (handled by `parallelReplaceTree`).
 *
 * Port of `Interscript::Stdlib.parallel_replace_compile_tree`.
 */
export function compileParallelTree(
  pairs: readonly (readonly [string, string])[],
): ParallelTrieNode {
  const root = emptyTrieNode()
  for (const [from, to] of pairs) {
    if (from.length === 0) continue
    let branch = root
    for (let i = 0; i < from.length - 1; i++) {
      const code = from.charCodeAt(i)
      let next = branch.children.get(code)
      if (!next) {
        next = emptyTrieNode()
        branch.children.set(code, next)
      }
      branch = next
    }
    const last = from.charCodeAt(from.length - 1)
    let leaf = branch.children.get(last)
    if (!leaf) {
      leaf = emptyTrieNode()
      branch.children.set(last, leaf)
    }
    leaf.match = to
  }
  return root
}

/**
 * Walk `input` against the trie, emitting the longest match at each
 * position. Falls back to passing through the character unchanged.
 *
 * Port of `Interscript::Stdlib.parallel_replace_tree`.
 */
export function parallelReplaceTree(input: string, tree: ParallelTrieNode): string {
  let out = ""
  const len = input.length
  let i = 0

  while (i < len) {
    let branch = tree
    let matchEnd = 0
    let matchReplacement: string | null = null

    for (let j = 0; i + j < len; j++) {
      const code = input.charCodeAt(i + j)
      const next = branch.children.get(code)
      if (!next) break
      branch = next
      if (branch.match !== null) {
        matchEnd = j + 1
        matchReplacement = branch.match
      }
    }

    if (matchReplacement !== null && matchEnd > 0) {
      out += matchReplacement
      i += matchEnd
    } else {
      out += input[i]
      i += 1
    }
  }
  return out
}

/**
 * Escape a string so it matches literally inside a RegExp.
 * Port of Ruby's `Regexp.escape`.
 */
export function regexpEscape(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Count the numbered capture groups a RegExp source emits.
 *
 * Mirrors compile-item.ts's emission grammar: the ONLY capturing
 * construct is `capture_group`, compiled as a bare `(...)`; every other
 * group is non-capturing (`(?:...)`) or a lookaround (`(?=`, `(?!`,
 * `(?<=`, `(?<!`). Escaped parens and parens inside char classes are
 * literals. Keep this in step with compile-item.ts if its group
 * conventions ever change.
 */
export function countCaptureGroups(re: string): number {
  let count = 0
  let i = 0
  while (i < re.length) {
    const c = re[i]
    if (c === "\\") {
      i += 2
      continue
    }
    if (c === "[") {
      // Char class: scan to the closing bracket, honouring escapes.
      i++
      while (i < re.length && re[i] !== "]") {
        if (re[i] === "\\") i++
        i++
      }
      i++
      continue
    }
    if (c === "(" && re[i + 1] !== "?") count++
    i++
  }
  return count
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
 * Title-case — `Interscript::Stdlib::Functions.title_case` / rs
 * `title_case` parity: upcase the FIRST character of the string, then
 * the character following each word separator. Other characters are
 * untouched (ruby `gsub(/^(.)/)` + `gsub(/#{sep}(.)/)` — notably NOT
 * full per-word title-casing).
 */
export function titleCase(input: string, opts: { wordSeparator?: string } = {}): string {
  const sep = opts.wordSeparator ?? " "
  const chars = Array.from(input)
  if (chars.length > 0) chars[0] = chars[0]!.toUpperCase()
  if (sep === "") return chars.join("")
  const sepChars = Array.from(sep)
  const out: string[] = []
  let i = 0
  while (i < chars.length) {
    if (i + sepChars.length < chars.length && sepChars.every((c, k) => chars[i + k] === c)) {
      out.push(sep, chars[i + sepChars.length]!.toUpperCase())
      i += sepChars.length + 1
    } else {
      out.push(chars[i]!)
      i += 1
    }
  }
  return out.join("")
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
 * Remove every separator (the inverse of `separate`).
 * Maps to `Interscript.functions.unseparate` — used by reverse mode
 * (`Stdlib.reverse_function` maps separate <-> unseparate). Split
 * semantics mirror rs/ruby: trailing empty segments survive the split
 * and rejoin (no trimming).
 */
export function unseparate(input: string, opts: { separator?: string } = {}): string {
  const sep = opts.separator ?? " "
  return input.split(sep).join("")
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

/**
 * Reverse a string by code point. Maps to
 * `Interscript.functions.reverse` (ruby String#reverse) — WO19 G6.
 */
export function reverse(input: string): string {
  return [...input].reverse().join("")
}

/**
 * Trim leading/trailing whitespace. Maps to `Interscript.functions.strip`
 * (ruby String#strip: the ASCII whitespace + NUL set, both ends) — WO19 G6.
 */
export function strip(input: string): string {
  // ruby String#strip's character set: NUL, tab, LF, VT, FF, CR, space.
  return input.replace(/^[\0\t\n\v\f\r ]+/, "").replace(/[\0\t\n\v\f\r ]+$/, "")
}

/**
 * Swap the case of every character (full Unicode mapping, matching
 * toUpperCase/toLowerCase semantics). Maps to
 * `Interscript.functions.swapcase` (ruby String#swapcase) — WO19 G6.
 */
export function swapcase(input: string): string {
  let out = ""
  for (const ch of input) {
    const lo = ch.toLowerCase()
    const up = ch.toUpperCase()
    out += lo !== ch ? lo : up !== ch ? up : ch
  }
  return out
}

/**
 * Megaregexp parallel replace — Ruby's fallback for parallel blocks
 * where any rule has `before`/`after`/`not_before`/`not_after` constraints.
 *
 * Mirrors `Interscript::Stdlib.parallel_regexp_compile` + `parallel_regexp_gsub`:
 * all rules join into one alternation `(?<g0>p0)|(?<g1>p1)|...` and a single
 * gsub decides which alternative matched via the named group. Rule order is
 * pre-sorted by the caller (longest `max_length` first, declaration order
 * as tiebreaker — matching Ruby's `deterministic_sort_by_max_length`).
 *
 * Onigmo and V8 share alternation semantics: at each scan position,
 * alternatives are tried in declaration order and the first match wins.
 *
 * Capture templates resolve against the RULE'S OWN capture list (rs
 * semantics, WO18 G1): the wrapping groups occupy the leading slots of
 * the global group list, so each rule's replacement receives only the
 * slice of numbered groups belonging to its own pattern.
 */
export interface MegaregexpRule {
  readonly pattern: string
  readonly replace: (match: string, groups: (string | undefined)[]) => string
}

export function parallelMegaregexp(input: string, rules: readonly MegaregexpRule[]): string {
  if (rules.length === 0) return input
  const parts = rules.map((r, i) => `(?<__r${i}>${r.pattern})`)
  const re = new RegExp(parts.join("|"), "gmu")
  // Numbered groups BEFORE each rule's wrapper: one wrapper per earlier
  // rule plus each earlier rule's inner captures. Rule i's own captures
  // therefore occupy global slice [before + 1, before + 1 + count).
  const before: number[] = []
  const counts: number[] = []
  let base = 0
  for (const r of rules) {
    before.push(base)
    const n = countCaptureGroups(r.pattern)
    counts.push(n)
    base += 1 + n
  }
  return input.replace(re, (...args: unknown[]) => {
    const groups = args[args.length - 1] as Record<string, string | undefined>
    for (let i = 0; i < rules.length; i++) {
      if (groups[`__r${i}`] !== undefined) {
        const match = args[0] as string
        const all = args.slice(1, -2) as (string | undefined)[]
        const start = before[i]! + 1
        return rules[i]!.replace(match, all.slice(start, start + counts[i]!))
      }
    }
    return args[0] as string
  })
}
