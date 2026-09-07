/**
 * The cataloger pipeline: transliterate a pasted column of names. The
 * loader caches each map after first use, so the whole column is one
 * map fetch.
 */
import { transliterateAsync } from "../src/index.js"
import { configureSharedStack } from "./_lib/stack.js"

export const title = "Batch a column of names"
export const summary = "Tab-separated input in, transliterated column out — the MARC batch shape."

export const expected = ["Anton Olehovych", "Solomiia", "Kyiv"].join("\n")

const COLUMN = ["Антон Олегович", "Соломія", "Київ"]

export async function run(): Promise<string> {
  configureSharedStack()
  const converted = new Array<string>(COLUMN.length)
  for (const [i, name] of COLUMN.entries()) {
    converted[i] = await transliterateAsync("bgnpcgn-ukr-Cyrl-Latn-2019", name)
  }
  return converted.join("\n")
}
