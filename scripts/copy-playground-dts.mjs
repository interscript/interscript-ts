// tsc does not copy bare .d.ts inputs to outDir; the playground
// ambient declarations ship in dist by explicit copy.
import { copyFileSync } from "node:fs"

copyFileSync("src/playground.d.ts", "dist/playground.d.ts")
