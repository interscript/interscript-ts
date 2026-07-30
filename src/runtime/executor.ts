/**
 * Rule executors — one pure function per Rule kind.
 *
 * Adding a new Rule kind:
 *   1. Add a variant to `Rule` in `types.ts`
 *   2. Register an executor here via the `executors` map
 *
 * Existing executors never need to change (OCP).
 */

import type { Item, Rule, SubRule } from "../types.js"
import type { ExecutionContext } from "./context.js"
import { compileItem, compileToLiteral, expandFromLiterals } from "./compile-item.js"
import { MapLogicError } from "../errors.js"
import {
  compileParallelTree,
  parallelReplaceTree,
  downcase,
  upcase,
  titleCase,
  separate,
  compose,
  decompose,
} from "../stdlib.js"

type RuleKind = Rule["kind"]
type RuleExecutorFor<K extends RuleKind> = (
  rule: Extract<Rule, { kind: K }>,
  ctx: ExecutionContext,
) => void

/** Built-in function registry. Mirrors Interscript.functions.* in Ruby. */
const BUILTIN_FUNCTIONS: Record<string, (input: string, opts?: Record<string, unknown>) => string> = {
  downcase,
  upcase,
  title_case: (i, o) => titleCase(i, o ?? {}),
  separate: (i, o) => separate(i, o ?? {}),
  compose,
  decompose,
}

function resolveFunction(ctx: ExecutionContext, name: string) {
  const fromMap = ctx.functions.get(name)?.impl
  if (fromMap) return fromMap
  const builtin = BUILTIN_FUNCTIONS[name]
  if (builtin) return builtin
  return undefined
}

const executors: { [K in RuleKind]: RuleExecutorFor<K> } = {
  sub: (rule, ctx) => executeSubRule(rule, ctx),

  run: (rule, ctx) => {
    // If docName is set, resolve via the loader (dependency map).
    // Otherwise look up the stage in the current map.
    const targetMap = rule.docName ? ctx.loadDependency(rule.docName) : ctx.map
    const target = targetMap.stages.find((s) => s.name === rule.stage)
    if (!target) throw new MapLogicError(`Stage not found: ${rule.stage}`)
    const inner = ctx.withMap(targetMap)
    for (const r of target.rules) {
      executeRule(r, inner)
    }
    // Propagate the transformed string back to the outer context.
    ctx.current = inner.current
  },

  funcall: (rule, ctx) => {
    const fn = resolveFunction(ctx, rule.name)
    if (!fn) throw new MapLogicError(`Unknown function: ${rule.name}`)
    ctx.current = fn(ctx.current, rule.kwargs ?? {})
  },

  parallel: (rule, ctx) => {
    // Parallel rule groups: apply all sub-rules simultaneously via trie.
    // Direct port of Ruby's Interscript::Stdlib.parallel_replace_compile_tree
    // + parallel_replace_tree. Longest match wins at each position.
    //
    // Constraints (matching Ruby):
    //   - All inner rules must be Sub (no nesting, no run, no funcall)
    //   - No before/after/notBefore/notAfter (would break single-pass)
    //   - from/to must compile to literal strings (no regex/captures)
    // Anything else falls back to sequential application with a warning.
    const pairs: [string, string][] = []
    let needsFallback = false
    for (const inner of rule.rules) {
      if (inner.kind !== "sub" || inner.before || inner.after || inner.notBefore || inner.notAfter || !inner.from) {
        needsFallback = true
        break
      }
      const toItem = inner.to
      const toLit = !toItem
        ? ""
        : toItem.kind === "funcall_inline"
          ? null
          : compileToLiteral(toItem, ctx)
      if (toLit === null) {
        needsFallback = true
        break
      }
      // Expand `any` items: each alternative becomes its own (from, to) pair.
      const fromAlts = expandFromLiterals(inner.from, ctx)
      if (fromAlts === null) {
        needsFallback = true
        break
      }
      for (const fromLit of fromAlts) {
        pairs.push([fromLit, toLit])
      }
    }
    if (needsFallback) {
      for (const fallback of rule.rules) executeRule(fallback, ctx)
      return
    }
    const tree = compileParallelTree(pairs)
    ctx.current = parallelReplaceTree(ctx.current, tree)
  },

  sequential: (rule, ctx) => {
    for (const inner of rule.rules) {
      executeRule(inner, ctx)
    }
  },
}

function executeSubRule(rule: SubRule, ctx: ExecutionContext): void {
  if (!rule.from) throw new MapLogicError("Sub rule missing 'from'")

  const from = compileItem(rule.from, ctx)
  // `before` and `after` are lookarounds — they assert without consuming.
  // Ruby's interpreter uses Ruby gsub with capture groups, which DOES
  // consume the surrounding context and re-inserts it via backreferences.
  // We use lookarounds for correctness with multi-byte scripts.
  const before = rule.before ? compileItem(rule.before, ctx).re : ""
  const after = rule.after ? compileItem(rule.after, ctx).re : ""
  const notBefore = rule.notBefore ? compileItem(rule.notBefore, ctx).re : ""
  const notAfter = rule.notAfter ? compileItem(rule.notAfter, ctx).re : ""

  const patternParts: string[] = []
  if (before) patternParts.push(`(?<=${before})`)
  if (notBefore) patternParts.push(`(?<!${notBefore})`)
  patternParts.push(from.re)
  if (after) patternParts.push(`(?=${after})`)
  if (notAfter) patternParts.push(`(?!${notAfter})`)

  let re: RegExp
  try {
    re = new RegExp(patternParts.join(""), "gmu")
  } catch (e) {
    throw new MapLogicError(`Invalid pattern compiled from rule: ${patternParts.join("")}`, {
      cause: e,
    })
  }

  const replacement = buildReplacement(rule.to, ctx)
  ctx.current = ctx.current.replace(
    re,
    typeof replacement === "string"
      ? (() => {
          // Use function to avoid $' $` $$ special-meaning bugs in
          // String.replace replacement strings.
          const tmpl = replacement
          return (match: string, ...args: unknown[]) =>
            resolveTemplate(tmpl, match, args as string[])
        })()
      : replacement,
  )
}

/**
 * Resolve a replacement template against a regex match.
 *
 * Handles `$1`, `$2` capture-group references. Does NOT interpret
 * `$'`, `` $` ``, `$$` — those are literal characters in our templates.
 */
function resolveTemplate(template: string, match: string, groups: string[]): string {
  return template.replace(/\$(\d+)/g, (_, n: string) => {
    const idx = parseInt(n, 10)
    return groups[idx - 1] ?? match
  })
}

/**
 * Build the replacement string for a sub rule.
 * Handles plain Items (use their literal form) and inline funcalls.
 *
 * With lookaround-based patterns (no surrounding capture groups), the
 * replacement is simply the compiled literal of the `to` item.
 */
function buildReplacement(
  to: Item | { kind: "funcall_inline"; name: string } | undefined,
  ctx: ExecutionContext,
): string | ((match: string, ...args: unknown[]) => string) {
  if (!to) return ""
  if (to.kind === "funcall_inline") {
    const fn = resolveFunction(ctx, to.name)
    if (!fn) throw new MapLogicError(`Unknown inline function: ${to.name}`)
    return (match: string) => fn(match)
  }
  const compiled = compileItem(to, ctx)
  return compiled.literal
}

/** Dispatch a Rule to its registered executor. O(1) lookup. */
export function executeRule<K extends RuleKind>(
  rule: Extract<Rule, { kind: K }>,
  ctx: ExecutionContext,
): void {
  const executor = executors[rule.kind] as RuleExecutorFor<K>
  executor(rule, ctx)
}

// Ensure Item import is treated as type-only for consistent-type-imports.
export type { Item }
