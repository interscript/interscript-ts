/**
 * ISC module — parse .isc source files directly, no JSON IR needed.
 *
 * Public API:
 *   import { parseIsc } from "interscript-ts/isc"
 *   const doc = parseIsc(source, "map.isc")
 *
 *   import { iscStrategy } from "interscript-ts/isc"
 *   configure({ strategies: [iscStrategy({ baseUrl: "/maps" })] })
 */

export { parseIsc } from "./parser.js"
export { iscToCompiledMap } from "./converter.js"
export { iscStrategy, iscBundledStrategy } from "./loader.js"
export type {
  IscDocument,
  IscItem,
  IscRule,
  IscStage,
  IscStageItem,
  IscTest,
  IscConstraint,
} from "./types.js"
export { IscParseError } from "./types.js"
