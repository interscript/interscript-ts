/**
 * ISC parser — grammar-driven entry point.
 *
 * Parses .isc source text into an IscDocument. The syntax lives in the
 * parsanol grammar (grammar/grammar-source.ts, synced from
 * interscript-ruby's canonical lib/interscript/isc/grammar/isc.parg); a
 * table-driven PEG interpreter (grammar/peg.ts) executes it and the
 * action layer (grammar/actions.ts) lowers the capture tree into an
 * IscDocument with the same semantics the former hand-written
 * recursive-descent parser (replaced in WO17 step 4b) implemented.
 *
 * Public API is unchanged:
 *
 *   const doc = parseIsc(source, "map.isc")
 *   // doc.systemCode, doc.metadata, doc.tests, doc.stages, ...
 *
 * Grammar-vs-document identity with the replaced hand parser is proven
 * file-by-file over the whole maps corpus (434/434 through the maps
 * canonical-schema comparison), and the .parg capture trees match the
 * interscript-ruby artifact parser tree-for-tree on the same corpus.
 */

export { parseIsc } from "./grammar/isc-parser.js"
