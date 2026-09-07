/**
 * Composition: detect which loaded system best explains an input/output
 * pair, then transliterate through the winner.
 */
import { detect, loadMapAsync, transliterateAsync } from "../src/index.js"
import { configureSharedStack } from "./_lib/stack.js"

export const title = "Detect the system, then convert"
export const summary =
  "Rank the loaded maps by how well they explain a source/target pair, and use the best hit."

export const expected = "Anton Olehovych"

const CANDIDATES = ["bgnpcgn-ukr-Cyrl-Latn-2019", "un-tam-Taml-Latn-1972"] as const

export async function run(): Promise<string> {
  configureSharedStack()
  for (const system of CANDIDATES) {
    await loadMapAsync(system)
  }
  const [best] = detect("Антон Олегович", "Anton Olehovych")
  return transliterateAsync(best.mapName, "Антон Олегович")
}
