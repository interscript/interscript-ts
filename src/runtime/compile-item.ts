/**
 * Item compilation — convert AST Items into RegExp source or literal string.
 *
 * Items are decomposed into their compiled form ONCE per stage, then
 * reused across many string inputs. This avoids redundant work and
 * keeps the interpreter's inner loop tight (DRY + performance).
 */

import type { Item } from "../types.js"
import type { ExecutionContext } from "./context.js"
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
 * Note: this is intentionally a single switch with exhaustive type
 * coverage. New Item kinds force this switch to be updated, which is
 * good — it surfaces the change rather than hiding it.
 */
export function compileItem(item: Item, ctx: ExecutionContext): CompiledItem {
  switch (item.kind) {
    case "string":
      return { re: regexpEscape(item.value), literal: item.value }

    case "capture_group": {
      const inner = compileItem(item.data, ctx)
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
      if (!resolved) return { re: "", literal: "" }
      return compileItem(resolved, ctx)
    }

    case "any": {
      const parts = item.of.map((i) => compileItem(i, ctx).re)
      return { re: `(?:${parts.join("|")})`, literal: "" }
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
      const quant = max === Infinity ? (min === 0 ? "*" : "+") : `{${min},${max}}`
      return { re: `(?:${inner})${quant}`, literal: "" }
    }

    case "stage_ref":
      // Stage references are handled by the executor, not by item compilation.
      return { re: "", literal: "" }
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
 * Stdlib alias table — single-character aliases like `:word`, `:boundary`.
 * Mirrors Interscript::Stdlib::ALIASES in Ruby.
 */
const STDLIB_ALIASES: Readonly<Record<string, CompiledItem>> = Object.freeze({
  any_character: { re: ".", literal: "" },
  none: { re: "", literal: "" },
  space: { re: " ", literal: " " },
  whitespace: { re: "\\s+", literal: " " },
  // JavaScript's \b only works for ASCII. Use Unicode-aware lookarounds
  // so that word boundaries work correctly for Cyrillic, Greek, etc.
  boundary: { re: "(?:(?<!\\p{L})(?=\\p{L})|(?<=\\p{L})(?!\\p{L}))", literal: "" },
  non_word_boundary: { re: "(?:(?<=\\p{L})(?=\\p{L})|(?<!\\p{L})(?!\\p{L}))", literal: "" },
  word: { re: "\\p{L}\\p{N}_", literal: "" },
  not_word: { re: "[^\\p{L}\\p{N}_]", literal: "" },
  alpha: { re: "\\p{L}", literal: "" },
  not_alpha: { re: "\\P{L}", literal: "" },
  digit: { re: "\\p{N}", literal: "" },
  not_digit: { re: "\\P{N}", literal: "" },
  line_start: { re: "(?<=\\n|^)", literal: "" },
  line_end: { re: "(?=\\n|$)", literal: "" },
  string_start: { re: "^", literal: "" },
  string_end: { re: "$", literal: "" },
})
