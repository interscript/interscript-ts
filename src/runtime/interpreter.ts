/**
 * Stage execution — apply a stage's rules in sequence to the context.
 *
 * Pure orchestrator: builds context, dispatches to rule executors,
 * returns the final string. Holds no state itself.
 */

import type { CompiledMap, Stage } from "../types.js"
import { ExecutionContext } from "./context.js"
import { executeRule } from "./executor.js"

/**
 * Run a single stage by name. Returns the transformed string.
 */
export function executeStage(map: CompiledMap, stageName: string, input: string): string {
  const stage: Stage | undefined = map.stages.find((s) => s.name === stageName)
  if (!stage) {
    return input
  }

  const ctx = new ExecutionContext(map, input)
  for (const rule of stage.rules) {
    executeRule(rule, ctx)
  }
  return ctx.current
}
