/**
 * Stage execution — apply a stage's rules in sequence to the context.
 *
 * Pure orchestrator: builds context, dispatches to rule executors,
 * returns the final string. Holds no state itself.
 *
 * Two paths:
 *   - executeStage (sync): fast path for rule-only maps. Throws if
 *     the stage contains ML funcalls (rababa/secryst).
 *   - executeStageAsync (async): handles everything including ML.
 *     Falls through to the sync path for non-ML stages (zero overhead).
 */

import type { CompiledMap, Rule, Stage } from "../types.js"
import type { MapLoader } from "../loader.js"
import { ExecutionContext } from "./context.js"
import { executeRule } from "./executor.js"

/**
 * Set of function names that require async execution (ML inference).
 * Populated from the ML module registration.
 */
const ASYNC_FUNCTIONS = new Set<string>(["rababa", "secryst"])

/** Register an additional async function name (used by ML modules). */
export function registerAsyncFunction(name: string): void {
  ASYNC_FUNCTIONS.add(name)
}

/**
 * Check if a rule list contains any async funcalls.
 * Shallow scan — doesn't recurse into parallel/sequential groups
 * deeper than one level (sufficient for real maps).
 */
function containsAsyncFuncalls(rules: readonly Rule[]): boolean {
  for (const r of rules) {
    if (r.kind === "funcall" && ASYNC_FUNCTIONS.has(r.name)) return true
    if (r.kind === "parallel" || r.kind === "sequential") {
      for (const inner of r.rules) {
        if (inner.kind === "funcall" && ASYNC_FUNCTIONS.has(inner.name)) return true
      }
    }
  }
  return false
}

/**
 * Run a single stage by name (SYNC path). Returns the transformed string.
 *
 * Throws if the stage contains ML funcalls — use `executeStageAsync`
 * for those.
 */
export function executeStage(
  map: CompiledMap,
  stageName: string,
  input: string,
  loader?: MapLoader,
): string {
  const stage: Stage | undefined = map.stages.find((s) => s.name === stageName)
  if (!stage) {
    return input
  }

  if (containsAsyncFuncalls(stage.rules)) {
    throw new Error(
      `Stage "${stageName}" contains ML function calls (rababa/secryst). ` +
      `Use transliterateAsync() instead of transliterate().`,
    )
  }

  const ctx = new ExecutionContext(map, input, loader)
  for (const rule of stage.rules) {
    executeRule(rule, ctx)
  }
  return ctx.current
}

/**
 * Run a single stage by name (ASYNC path). Handles ML funcalls.
 *
 * For non-ML stages, delegates to the sync path (zero overhead).
 */
export async function executeStageAsync(
  map: CompiledMap,
  stageName: string,
  input: string,
  loader?: MapLoader,
): Promise<string> {
  const stage: Stage | undefined = map.stages.find((s) => s.name === stageName)
  if (!stage) {
    return input
  }

  // Fast path: no async functions → use the sync executor directly.
  if (!containsAsyncFuncalls(stage.rules)) {
    return executeStage(map, stageName, input, loader)
  }

  // Async path: same executors, but funcall results are awaited.
  const ctx = new ExecutionContext(map, input, loader)
  for (const rule of stage.rules) {
    await executeRuleAsync(rule, ctx)
  }
  return ctx.current
}

/**
 * Async rule dispatcher. Same as `executeRule` but awaits funcall
 * results. Only used for stages that contain async functions.
 *
 * All non-funcall rule kinds delegate to the sync executor (they're
 * already synchronous). Only funcall needs special handling.
 */
async function executeRuleAsync(
  rule: Rule,
  ctx: ExecutionContext,
): Promise<void> {
  if (rule.kind === "funcall") {
    await executeFuncallAsync(rule, ctx)
    return
  }
  // All other rule kinds are sync — delegate to the existing executor.
  // This avoids duplicating the parallel/sub/run logic (DRY).
  executeRule(rule, ctx)
}

/**
 * Async funcall handler. Looks up the function, calls it, and awaits
 * the result. Handles both sync functions (transparent — Promise.resolve)
 * and async functions (rababa, secryst).
 *
 * OCP: doesn't hardcode which functions are async. Just awaits
 * whatever the function returns, sync or not.
 */
async function executeFuncallAsync(
  rule: { readonly name: string; readonly kwargs?: Readonly<Record<string, unknown>> },
  ctx: ExecutionContext,
): Promise<void> {
  // Rababa has its own config-keyed model registry (see stdlib/ml.ts).
  // The config "200" maps to a specific model URL and rababa-specific
  // config — bypass the generic ML registry, which is keyed by task
  // version and doesn't know about rababa configs.
  if (rule.name === "rababa") {
    const { rababa } = await import("../stdlib/ml.js")
    ctx.current = await rababa(ctx.current, rule.kwargs as { config?: string })
    return
  }
  // Other ASYNC_FUNCTIONS (secryst, etc.) still go through the generic
  // ML registry.
  if (ASYNC_FUNCTIONS.has(rule.name)) {
    const { loadModel } = await import("../ml/index.js")
    const modelId = (rule.kwargs?.config ?? rule.kwargs?.model ?? "default") as string
    const model = await loadModel({ kind: rule.name as "secryst", id: modelId })
    ctx.current = await model.transform(ctx.current)
    return
  }
  // Fall back to the sync funcall executor for all other functions.
  executeRule({ kind: "funcall", name: rule.name, kwargs: rule.kwargs } as Rule, ctx)
}
