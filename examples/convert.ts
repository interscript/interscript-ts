/**
 * Hello world: configure the map stack, transliterate one string.
 */
import { transliterateAsync } from "../src/index.js"
import { configureSharedStack } from "./_lib/stack.js"

export const title = "Convert one string"
export const summary = "Configure the map loader, transliterate Ukrainian by BGN/PCGN 2019."

export const expected = "Anton Olehovych"

export async function run(): Promise<string> {
  configureSharedStack()
  return transliterateAsync("bgnpcgn-ukr-Cyrl-Latn-2019", "Антон Олегович")
}
