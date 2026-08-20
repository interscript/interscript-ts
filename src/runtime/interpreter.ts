/**
 * Stage execution — apply a stage's rules in sequence to the context.
 *
 * Pure orchestrator: builds context, dispatches to rule executors,
 * returns the final string. Holds no state itself.
 */

import type { CompiledMap, Stage } from "../types.js";
import type { MapLoader } from "../loader.js";
import { ExecutionContext } from "./context.js";
import { executeRule } from "./executor.js";

/**
 * Run a single stage by name. Returns the transformed string.
 *
 * Optional `loader` enables `run` rules with `docName` to resolve
 * dependency maps. Without a loader, such rules throw at runtime.
 */
export function executeStage(
  map: CompiledMap,
  stageName: string,
  input: string,
  loader?: MapLoader,
): string {
  const stage: Stage | undefined = map.stages.find((s) => s.name === stageName);
  if (!stage) {
    return input;
  }

  const ctx = new ExecutionContext(map, input, loader);
  for (const rule of stage.rules) {
    executeRule(rule, ctx);
  }
  return ctx.current;
}
