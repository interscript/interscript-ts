/**
 * Rababa function — wired into the stdlib function registry.
 *
 * Called from rule executors when a map invokes `rababa config: "200"`.
 * Loads the model on first use via the ML registry.
 *
 * Pure stub if onnxruntime isn't installed — returns the input
 * unchanged so non-rababa maps never break.
 */

import { loadModel } from "../ml/index.js"
import type { RababaModel } from "../ml/models/rababa/index.js"

const rababaCache = new Map<string, Promise<RababaModel>>()

async function getRababa(config: string): Promise<RababaModel> {
  let cached = rababaCache.get(config)
  if (!cached) {
    cached = loadModel({ kind: "rababa", id: config }).then((m) => m as RababaModel)
    rababaCache.set(config, cached)
    cached.catch(() => rababaCache.delete(config))
  }
  return cached
}

/**
 * Run rababa diacritization on the input.
 *
 * Maps call this as `rababa config: "200"` (the Interscript DSL).
 * The function registry in `executor.ts` dispatches funcalls with
 * `name: "rababa"` to this function.
 *
 * Async — the function executor must use `transliterateAsync` when
 * a map's stage contains a rababa call (see #67).
 */
export async function rababa(input: string, opts: { config?: string } = {}): Promise<string> {
  const config = opts.config ?? "200"
  const model = await getRababa(config)
  return model.diacritize(input)
}

/**
 * Strip haraqat from text. Pure — no model required.
 * Used by `rababa_reverse` in maps.
 */
export function rababaReverse(input: string): string {
  return input.replace(/[ًٌٍَُِّْ]/g, "")
}
