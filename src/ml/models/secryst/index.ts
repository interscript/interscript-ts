/**
 * Secryst model registration — side-effect import.
 *
 * Importing this module registers the "secryst" factory with the ML
 * registry. Done in `src/ml/index.ts` so end users don't need to.
 */

import { registerModel } from "../../registry.js"
import { createSecrystModel } from "./translator.js"
import type { SecrystModel } from "./translator.js"

registerModel("secryst", async (params) => createSecrystModel(params))

export type { SecrystModel } from "./translator.js"
export { Vocab, parseVocabYaml, buildVocabs } from "./vocab.js"
export { causalMask, paddingMask, buildMasks } from "./masks.js"
