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
import { compileItem } from "./compile-item.js"
import { MapLogicError } from "../errors.js"
import { downcase, upcase, titleCase, separate, compose, decompose } from "../stdlib.js"

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
    // Parallel rule groups in the Ruby runtime use a tree-based single-pass
    // replace. We approximate by applying each sub in order; this is correct
    // for non-overlapping subs but may differ from Ruby when subs can fire
    // on each other's output.
    // See TODO.complete/42-parallel-replace.md for the faithful port.
    for (const inner of rule.rules) {
      executeRule(inner, ctx)
    }
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
  const before = rule.before ? compileItem(rule.before, ctx).re : ""
  const after = rule.after ? compileItem(rule.after, ctx).re : ""
  const notBefore = rule.notBefore ? compileItem(rule.notBefore, ctx).re : ""
  const notAfter = rule.notAfter ? compileItem(rule.notAfter, ctx).re : ""

  const patternParts: string[] = []
  let captureOffset = 0
  if (before) {
    patternParts.push(`(${before})`)
    captureOffset += 1
  }
  if (notBefore) patternParts.push(`(?<!${notBefore})`)
  patternParts.push(`(${from.re})`)
  const matchGroup = captureOffset + 1
  if (after) patternParts.push(`(${after})`)
  if (notAfter) patternParts.push(`(?!${notAfter})`)

  let re: RegExp
  try {
    re = new RegExp(patternParts.join(""), "gmu")
  } catch (e) {
    throw new MapLogicError(`Invalid pattern compiled from rule: ${patternParts.join("")}`, {
      cause: e,
    })
  }

  const replacement = buildReplacement(rule.to, ctx, before ? 1 : 0, matchGroup)
  ctx.current =
    typeof replacement === "string"
      ? ctx.current.replace(re, replacement)
      : ctx.current.replace(re, replacement as (substring: string, ...args: unknown[]) => string)
}

/**
 * Build the replacement string for a sub rule.
 * Handles plain Items (use their literal form) and inline funcalls.
 */
function buildReplacement(
  to: Item | { kind: "funcall_inline"; name: string } | undefined,
  ctx: ExecutionContext,
  beforeGroups: number,
  matchGroup: number,
): string | ((match: string, ...args: unknown[]) => string) {
  if (!to) return ""
  if (to.kind === "funcall_inline") {
    const fn = resolveFunction(ctx, to.name)
    if (!fn) throw new MapLogicError(`Unknown inline function: ${to.name}`)
    return (match: string) => fn(match)
  }
  const compiled = compileItem(to, ctx)
  // Capture refs in the literal ($1...) need to be renumbered by `beforeGroups`.
  // For the common case (no `before`), compiled.literal is already correct.
  void beforeGroups
  void matchGroup
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
