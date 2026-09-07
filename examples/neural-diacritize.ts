/**
 * The neural path: resolve a diacritization model through the index and
 * decode client-side. Model bytes are large — `run()` executes only when
 * INTERSCRIPT_PLAYGROUND_LIVE=1 (the website demo exercises this path
 * end to end); CI asserts the recipe's contract instead.
 */
import { imf } from "../src/ml/index.js"

export const title = "Diacritize with a neural model"
export const summary =
  "Resolve ara-diac-small-2.1 through the models.yaml index, load the IMF zip, decode with progress."

export const MODEL_ID = "ara-diac-small-2.1-int8"
export const INPUT = "كتاب"

export interface Recipe {
  modelId: string
  input: string
  live: boolean
}

export function describe(): Recipe {
  return { modelId: MODEL_ID, input: INPUT, live: process.env.INTERSCRIPT_PLAYGROUND_LIVE === "1" }
}

export async function run(): Promise<string> {
  const recipe = describe()
  if (!recipe.live) {
    throw new Error("neural example requires INTERSCRIPT_PLAYGROUND_LIVE=1 (downloads ~264 MB)")
  }
  const resolved = await imf.resolve(MODEL_ID)
  const model = await imf.IMFModel.fromZipBytes(resolved.bytes)
  try {
    return await model.translate(INPUT, 2048, { onProgress: () => {} })
  } finally {
    await model.dispose()
  }
}
