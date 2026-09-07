/**
 * The browser-shaped map-loading stack every example shares — the same
 * strategy order the website runtime uses (ISC form first, compiled
 * JSON fallback for the .iml-only libraries).
 */
import { configure, httpStrategy, iscStrategy, reset } from "../../src/index.js"

export const MAPS_BASE = "https://interscript.org/maps"

export function configureSharedStack(): void {
  reset()
  configure({
    strategies: [
      iscStrategy({ baseUrl: MAPS_BASE }),
      httpStrategy({ baseUrl: MAPS_BASE, cacheKeyPrefix: "isx-libs:" }),
    ],
  })
}
