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

    case "capture": {
      const idx = item.index
      return { re: `(${idx > 0 ? `\\${idx}` : ""})`, literal: `$${idx}` }
    }

    case "alias": {
      const resolved = ctx.resolveAlias(item.name)
      if (!resolved) return { re: "", literal: "" }
      return compileItem(resolved, ctx)
    }

    case "any": {
      const parts = item.of.map((i) => compileItem(i, ctx).re)
      return { re: `(?:${parts.join("|")})`, literal: "" }
    }

    case "group": {
      const parts = item.items.map((i) => compileItem(i, ctx).re)
      return { re: `(?:${parts.join("")})`, literal: "" }
    }

    case "repeat": {
      const inner = compileItem(item.item, ctx).re
      const { min, max } = item
      const quant = max === Infinity ? `${min === 0 ? "*" : "+"}` : `{${min},${max}}`
      return { re: `(?:${inner})${quant}`, literal: "" }
    }

    case "stage_ref":
      // Stage references are handled by the executor, not by item compilation.
      return { re: "", literal: "" }
  }
}
