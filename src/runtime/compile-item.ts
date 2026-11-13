/**
 * Item compilation — convert AST Items into RegExp source or literal string.
 *
 * Items are decomposed into their compiled form ONCE per stage, then
 * reused across many string inputs. This avoids redundant work and
 * keeps the interpreter's inner loop tight (DRY + performance).
 */

import type { Item } from "../types.js"
import type { ExecutionContext } from "./context.js"
import { MapLogicError } from "../errors.js"
import { regexpEscape } from "../stdlib.js"

/** Compiled form of a pattern Item. */
export interface CompiledItem {
  /** RegExp source. */
  readonly re: string
  /** Literal value (for replacement strings). */
  readonly literal: string
}

/**
 * Compile an Item into a RegExp source string + literal value.
 * Visitor-free dispatch — adding a new Item kind = adding a case here.
 *
 * `classCtx` selects the compile context. Ruby/RS resolve aliases in two
 * contexts (NodeAdapter#materialize_class vs #materialize, mirrored in
 * interscript-rs builder.rs):
 *
 * - sequence context (default): an alias resolving to a String is a
 *   literal sequence;
 * - class context (constraint positions — before/not_before/after/
 *   not_after — and the arguments of `any()`): an IMPORTED charset alias
 *   (a dependency map's alias) resolving to a String is a per-character
 *   set (`convert_class_alias` expands Item::Str into one entry per
 *   char; Ruby `Any#to_regexp` builds a char class). A LOCAL string
 *   alias stays a sequence even in class context, matching RS.
 *
 * Note: this is intentionally a single switch with exhaustive type
 * coverage. New Item kinds force this switch to be updated, which is
 * good — it surfaces the change rather than hiding it.
 */
export function compileItem(item: Item, ctx: ExecutionContext, classCtx = false): CompiledItem {
  switch (item.kind) {
    case "string":
      return { re: regexpEscape(item.value), literal: item.value }

    case "capture_group": {
      // RS converts capture innards in sequence context even inside a
      // constraint (convert_class_fragment only class-resolves the
      // top-level alias).
      const inner = compileItem(item.data, ctx, false)
      return { re: `(${inner.re})`, literal: inner.literal }
    }

    case "capture_ref": {
      const id = item.id
      return { re: `\\${id}`, literal: `$${id}` }
    }

    case "alias": {
      // Stdlib aliases (single characters like \w, \b, etc.)
      const stdlib = STDLIB_ALIASES[item.name]
      if (stdlib) return stdlib
      const resolved = ctx.resolveAlias(item.name)
      // WO18 G3 (parity audit): an unresolved alias is map-logic damage,
      // not an empty matcher. Compiling `re: ""` matched at every string
      // boundary and silently spliced the replacement text ("a" ->
      // "XaX"); ruby raises SystemConversionError and rs fails at load.
      if (!resolved) throw new MapLogicError(`Alias ${item.name} not found`)
      if (classCtx && !ctx.map.aliases.has(item.name) && resolved.kind === "string") {
        // Imported charset alias in class position: per-character set.
        return stringCharset(resolved.value)
      }
      return compileItem(resolved, ctx, classCtx)
    }

    case "any": {
      // any() arguments are class-resolved regardless of the surrounding
      // context (RS convert_any_arg routes alias entries through
      // convert_set_entry -> convert_class_alias). Concatenation/capture
      // entries inside a list stay sequence-resolved — only alias
      // entries differ per context.
      const parts = item.of.map((i) => compileItem(i, ctx, i.kind === "alias").re)
      // Mirror Ruby's Any#nth_string: the literal form picks the first
      // alternative. Sub rules with `to: any("ie")` use this for the
      // canonical replacement.
      const firstLit =
        item.of.length > 0
          ? compileItem(item.of[0]!, ctx, item.of[0]!.kind === "alias").literal
          : ""
      return { re: `(?:${parts.join("|")})`, literal: firstLit }
    }

    case "any_char_class": {
      // Build a JS char class. Range → [first-last], chars → [abc].
      // Both forms are escaped so a literal `]` or `-` survives.
      if (item.range) {
        const [first, last] = item.range
        return {
          re: `[${regexpEscape(first!)}-${regexpEscape(last!)}]`,
          literal: first ?? "",
        }
      }
      if (item.chars && item.chars.length > 0) {
        const escaped = item.chars.map((c) => regexpEscape(c)).join("")
        return { re: `[${escaped}]`, literal: item.chars[0]! }
      }
      return { re: "[^]", literal: "" }
    }

    case "group": {
      const compiled = item.items.map((i) => compileItem(i, ctx))
      const re = compiled.map((c) => c.re).join("")
      const literal = compiled.map((c) => c.literal).join("")
      return { re: `(?:${re})`, literal }
    }

    case "repeat": {
      const inner = compileItem(item.item, ctx).re
      const { min, max } = item
      const maxVal = max === null ? Infinity : max
      const quant = maxVal === Infinity ? (min === 0 ? "*" : "+") : `{${min},${maxVal}}`
      return { re: `(?:${inner})${quant}`, literal: "" }
    }

    case "stage_ref":
      // Stage references are handled by the executor, not by item compilation.
      return { re: "", literal: "" }
  }
}

/**
 * Compile a String charset as a per-character SET (class context).
 * Mirrors RS `convert_class_alias` expanding Item::Str into one entry
 * per char, and Ruby `Any#to_regexp` building a char class from String
 * data. Compiled as an alternation (not a `[...]` class) so astral
 * code points and regexp-escaped chars stay correct under the `u` flag.
 */
function stringCharset(value: string): CompiledItem {
  const chars = Array.from(value)
  return {
    re: `(?:${chars.map((c) => regexpEscape(c)).join("|")})`,
    literal: chars[0] ?? "",
  }
}

/**
 * Compile an Item to a literal string only (no regex semantics).
 * Used by the parallel-replace executor which needs exact strings.
 *
 * Returns `null` if the Item cannot be represented as a literal
 * (captures, regex-only constructs). The caller decides whether to
 * fall back to sequential execution.
 */
export function compileToLiteral(item: Item, ctx: ExecutionContext): string | null {
  switch (item.kind) {
    case "string":
      return item.value

    case "alias": {
      const stdlib = STDLIB_ALIASES[item.name]
      if (stdlib) return stdlib.literal === "" ? null : stdlib.literal
      const resolved = ctx.resolveAlias(item.name)
      if (!resolved) return null
      return compileToLiteral(resolved, ctx)
    }

    case "capture_group":
    case "capture_ref":
    case "repeat":
    case "stage_ref":
      return null

    case "any_char_class": {
      // Mirror Ruby's Any#nth_string: first char of the class.
      if (item.chars && item.chars.length > 0) return item.chars[0]!
      if (item.range) return item.range[0]!
      return null
    }

    case "any": {
      // `any` represents alternative spellings (e.g. "te" vs "t" for the
      // same source char). Ruby picks the first option in non-iterating
      // mode; we match that.
      if (item.of.length === 0) return null
      return compileToLiteral(item.of[0]!, ctx)
    }

    case "group": {
      let out = ""
      for (const child of item.items) {
        const lit = compileToLiteral(child, ctx)
        if (lit === null) return null
        out += lit
      }
      return out
    }
  }
}

/**
 * Expand a `from` item into ALL possible literal strings for parallel
 * replace. `any` items produce one entry per alternative. Other items
 * produce a single entry (or null if not literal).
 *
 * This is the multi-valued counterpart of `compileToLiteral`.
 */
export function expandFromLiterals(item: Item, ctx: ExecutionContext): string[] | null {
  switch (item.kind) {
    case "string":
      return [item.value]

    case "alias": {
      const stdlib = STDLIB_ALIASES[item.name]
      if (stdlib) return null
      const resolved = ctx.resolveAlias(item.name)
      if (!resolved) return null
      return expandFromLiterals(resolved, ctx)
    }

    case "any_char_class": {
      // Mirror Ruby's parallel-tree expansion: one entry per char.
      // For ranges, expand every code point — same as Ruby's Any#data
      // when value is a Range.
      if (item.chars) return [...item.chars]
      if (item.range) {
        const [first, last] = item.range
        const start = first!.codePointAt(0)!
        const end = last!.codePointAt(0)!
        const out: string[] = []
        for (let cp = start; cp <= end; cp++) out.push(String.fromCodePoint(cp))
        return out
      }
      return null
    }

    case "any": {
      const out: string[] = []
      for (const child of item.of) {
        const lit = expandFromLiterals(child, ctx)
        if (lit === null) return null
        out.push(...lit)
      }
      return out
    }

    case "group": {
      // Cartesian product of all children's alternatives.
      let combos: string[] = [""]
      for (const child of item.items) {
        const childAlts = expandFromLiterals(child, ctx)
        if (childAlts === null) return null
        const next: string[] = []
        for (const prefix of combos) {
          for (const suffix of childAlts) {
            next.push(prefix + suffix)
          }
        }
        combos = next
      }
      return combos
    }

    default:
      return null
  }
}

/**
 * Compute the max-length estimate for an Item. Mirrors Ruby's
 * `Node::Item#max_length`, which is used to sort parallel rules
 * (longest first) before building the megaregexp fallback.
 *
 * The estimate need not be exact — it only governs sort order within
 * a parallel block. Stdlib aliases count as length 1 (matching Ruby),
 * `none` is 0.
 */
export function maxLengthOfItem(item: Item, ctx: ExecutionContext): number {
  switch (item.kind) {
    case "string":
      return item.value.length
    case "capture_group":
      return maxLengthOfItem(item.data, ctx)
    case "capture_ref":
      return 1
    case "alias": {
      if (item.name === "none") return 0
      if (STDLIB_ALIASES[item.name]) return 1
      const resolved = ctx.resolveAlias(item.name)
      return resolved ? maxLengthOfItem(resolved, ctx) : 1
    }
    case "any":
      return item.of.reduce((m, i) => Math.max(m, maxLengthOfItem(i, ctx)), 0)
    case "any_char_class":
      return 1
    case "group":
      return item.items.reduce((sum, i) => sum + maxLengthOfItem(i, ctx), 0)
    case "repeat":
      return maxLengthOfItem(item.item, ctx)
    case "stage_ref":
      return 1
  }
}

/**
 * Stdlib alias table — single-character aliases like `:word`, `:boundary`.
 * Mirrors Interscript::Stdlib::ALIASES in Ruby.
 */
const STDLIB_ALIASES: Readonly<Record<string, CompiledItem>> = Object.freeze({
  any_character: { re: ".", literal: "" },
  none: { re: "", literal: "" },
  space: { re: " ", literal: " " },
  whitespace: { re: "\\s+", literal: " " },
  // Boundary is implemented as Unicode-aware lookarounds so that
  // Cyrillic, Arabic, Devanagari etc. get correct word boundaries
  // (66 maps rely on this). Ruby's \b is ASCII-only by default, but
  // most maps work because their boundary usage is at start-of-string
  // or after whitespace — cases where ASCII \b happens to coincide
  // with the Unicode form.
  boundary: {
    re: "(?:(?<![\\p{L}\\p{M}])(?=[\\p{L}\\p{M}])|(?<=[\\p{L}\\p{M}])(?![\\p{L}\\p{M}]))",
    literal: "",
  },
  non_word_boundary: {
    re: "(?:(?<=[\\p{L}\\p{M}])(?=[\\p{L}\\p{M}])|(?<![\\p{L}\\p{M}])(?![\\p{L}\\p{M}]))",
    literal: "",
  },
  // word / not_word mirror Ruby's default ASCII-only \w / \W. Only one
  // map (odni-che-Cyrl-Latn-2015) uses these aliases — its palochka
  // rule depends on Cyrillic being treated as non-word. ASCII-only
  // here is harmless to the 65+ maps that use boundary instead.
  word: { re: "[A-Za-z0-9_]", literal: "" },
  not_word: { re: "[^A-Za-z0-9_]", literal: "" },
  alpha: { re: "[a-zA-Z]", literal: "" },
  not_alpha: { re: "[^a-zA-Z]", literal: "" },
  digit: { re: "[0-9]", literal: "" },
  not_digit: { re: "[^0-9]", literal: "" },
  line_start: { re: "^", literal: "" },
  line_end: { re: "(?=\\n|$)", literal: "" },
  string_start: { re: "^", literal: "" },
  string_end: { re: "$", literal: "" },
})
