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
import { compileItem, compileToLiteral, expandFromLiterals, maxLengthOfItem } from "./compile-item.js"
import { MapLogicError } from "../errors.js"
import {
  compileParallelTree,
  parallelReplaceTree,
  parallelMegaregexp,
  type MegaregexpRule,
  downcase,
  upcase,
  titleCase,
  separate,
  compose,
  decompose,
} from "../stdlib.js"
import { rababa, rababaReverse } from "../stdlib/ml.js"

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
    // Ruby's parallel executor tries tree mode first; if ANY rule has
    // before/after/not_before/not_after constraints OR contains a
    // re-only stdlib alias (boundary, line_start, word, etc.) inside
    // `from`, the whole block falls back to a single megaregexp gsub
    // (alternation of every rule's compiled pattern, first-match-wins
    // at each position).
    //
    // Splitting at the rule level (trie for unconstrained, sequential
    // for constrained) produces different output because the trie pass
    // mutates the string before constrained rules can compete. We must
    // take the WHOLE block down one path or the other.

    const subRules: SubRule[] = []
    const trailingRules: Rule[] = []
    for (const inner of rule.rules) {
      if (inner.kind === "sub" && inner.from) {
        subRules.push(inner)
      } else {
        trailingRules.push(inner)
      }
    }

    // A rule is tree-compatible if it has no before/after clauses AND
    // its `from` can be expanded to literal strings (no re-only aliases
    // like boundary, no captures). If any rule fails this check, the
    // whole block goes through megaregexp.
    const treeCompatible = (r: SubRule) =>
      !r.before && !r.after && !r.notBefore && !r.notAfter && expandFromLiterals(r.from!, ctx) !== null

    const anyConstrained = subRules.some((r) => !treeCompatible(r))

    if (!anyConstrained) {
      // Tree mode: every from must compile to literal(s)
      const triePairs: [string, string][] = []
      for (const r of subRules) {
        if (r.to && r.to.kind === "funcall_inline") continue
        const toLit = r.to ? compileToLiteral(r.to, ctx) : ""
        if (toLit === null) continue
        const fromAlts = expandFromLiterals(r.from!, ctx)
        if (fromAlts === null) continue
        for (const fromLit of fromAlts) triePairs.push([fromLit, toLit])
      }
      if (triePairs.length > 0) {
        ctx.current = parallelReplaceTree(ctx.current, compileParallelTree(triePairs))
      }
    } else {
      // Megaregexp mode: sort by max_length desc (declaration as
      // tiebreaker), then build one alternation regex.
      const sorted = subRules
        .map((r, idx) => ({
          rule: r,
          idx,
          len:
            maxLengthOfItem(r.from!, ctx) +
            (r.before ? maxLengthOfItem(r.before, ctx) : 0) +
            (r.after ? maxLengthOfItem(r.after, ctx) : 0) +
            (r.notBefore ? maxLengthOfItem(r.notBefore, ctx) : 0) +
            (r.notAfter ? maxLengthOfItem(r.notAfter, ctx) : 0) +
            (r.priority ?? 0),
        }))
        .sort((a, b) => b.len - a.len || a.idx - b.idx)

      const megaRules: MegaregexpRule[] = sorted.map(({ rule: r }) => {
        const from = compileItem(r.from!, ctx)
        const before = r.before ? compileItem(r.before, ctx).re : ""
        const after = r.after ? compileItem(r.after, ctx).re : ""
        const notBefore = r.notBefore ? compileItem(r.notBefore, ctx).re : ""
        const notAfter = r.notAfter ? compileItem(r.notAfter, ctx).re : ""

        const pattern = [
          before ? `(?<=${before})` : "",
          notBefore ? `(?<!${notBefore})` : "",
          from.re,
          after ? `(?=${after})` : "",
          notAfter ? `(?!${notAfter})` : "",
        ].join("")

        const replacement = buildReplacement(r.to, ctx)
        const replaceFn =
          typeof replacement === "string"
            ? (match: string, _groups: (string | undefined)[]) =>
                resolveTemplate(replacement, match, _groups as string[])
            : replacement
        return { pattern, replace: replaceFn }
      })

      ctx.current = parallelMegaregexp(ctx.current, megaRules)
    }

    // Non-sub rules (run/funcall/etc.) execute after the parallel pass,
    // in declaration order.
    for (const r of trailingRules) executeRule(r, ctx)
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
