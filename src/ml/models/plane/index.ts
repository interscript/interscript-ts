/**
 * Plane model registration — side-effect import.
 *
 * Importing this module registers the "plane" factory with the ML
 * registry. Done in `src/ml/index.ts` so end users don't need to.
 */

import { registerModel } from "../../registry.js"
import { PlaneModel } from "./plane-model.js"

registerModel("plane", async (params) => {
  const zip = params.artifacts["plane.zip"]
  if (!(zip instanceof Uint8Array)) {
    throw new Error("plane factory: artifacts must carry plane.zip bytes")
  }
  return PlaneModel.fromZip(zip)
})

export { PlaneModel, PlaneError, createPlaneModel } from "./plane-model.js"
export type { PlaneOptions } from "./plane-model.js"
