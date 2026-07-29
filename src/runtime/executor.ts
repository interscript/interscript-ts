/**
 * Rule executors — one pure function per Rule kind.
 *
 * Adding a new Rule kind:
 *   1. Add a variant to `Rule` in `types.ts`
 *   2. Register an executor here via the `executors` map
 *
 * Existing executors never need to change (OCP).
 */

import type { Rule } from "../types.js"
import type { ExecutionContext } from "./context.js"
import { compileItem } from "./compile-item.js"
import { MapLogicError } from "../errors.js"

type RuleKind = Rule["kind"]
type RuleExecutorFor<K extends RuleKind> = (
  rule: Extract<Rule, { kind: K }>,
  ctx: ExecutionContext,
) => void

const executors: { [K in RuleKind]: RuleExecutorFor<K> } = {
  sub: (rule, ctx) => {
    const from = compileItem(rule.from, ctx)
    const to = compileItem(rule.to, ctx)
    const before = rule.before ? compileItem(rule.before, ctx).re : ""
    const after = rule.after ? compileItem(rule.after, ctx).re : ""
    const notBefore = rule.notBefore ? compileItem(rule.notBefore, ctx).re : ""
    const notAfter = rule.notAfter ? compileItem(rule.notAfter, ctx).re : ""

    const patternParts: string[] = []
    if (before) patternParts.push(`(${before})`)
    if (notBefore) patternParts.push(`(?<!${notBefore})`)
    patternParts.push(`(${from.re})`)
    if (after) patternParts.push(`(${after})`)
    if (notAfter) patternParts.push(`(?!${notAfter})`)

    let re: RegExp
    try {
      re = new RegExp(patternParts.join(""), "gmu")
    } catch (e) {
      throw new MapLogicError(`Invalid pattern compiled from rule: ${patternParts.join("")}`, e)
    }

    const replacement = before ? `$1${to.literal}` : to.literal
    ctx.current = ctx.current.replace(re, replacement)
  },

  run: (rule, ctx) => {
    const target = ctx.map.stages.find((s) => s.name === rule.stage)
    if (!target) throw new MapLogicError(`Stage not found: ${rule.stage}`)
    for (const inner of target.rules) {
      executeRule(inner, ctx)
    }
  },

  funcall: (rule, ctx) => {
    const fn = ctx.functions.get(rule.name)?.impl
    if (!fn) throw new MapLogicError(`Unknown function: ${rule.name}`)
    ctx.current = fn(ctx.current, rule.kwargs ?? {})
  },
}

/** Dispatch a Rule to its registered executor. O(1) lookup. */
export function executeRule<K extends RuleKind>(
  rule: Extract<Rule, { kind: K }>,
  ctx: ExecutionContext,
): void {
  const executor = executors[rule.kind] as RuleExecutorFor<K>
  executor(rule, ctx)
}
