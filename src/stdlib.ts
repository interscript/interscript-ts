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
 */
export interface MegaregexpRule {
  readonly pattern: string
  readonly replace: (match: string, groups: (string | undefined)[]) => string
}

export function parallelMegaregexp(input: string, rules: readonly MegaregexpRule[]): string {
  if (rules.length === 0) return input
  const parts = rules.map((r, i) => `(?<__r${i}>${r.pattern})`)
  const re = new RegExp(parts.join("|"), "gmu")
  return input.replace(re, (...args: unknown[]) => {
    const groups = args[args.length - 1] as Record<string, string | undefined>
    for (let i = 0; i < rules.length; i++) {
      if (groups[`__r${i}`] !== undefined) {
        const match = args[0] as string
        const captures = (args.slice(1, -2) as (string | undefined)[])
        return rules[i]!.replace(match, captures)
      }
    }
    return args[0] as string
  })
}
