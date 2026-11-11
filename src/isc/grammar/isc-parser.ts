/**
 * Generated ISC parser — the parsanol grammar (grammar-source.ts) drives a
 * table-driven PEG interpreter (parg-reader.ts + peg.ts) and the resulting
 * capture tree is lowered to an IscDocument by the action layer
 * (actions.ts).
 *
 * This module replaces the hand-written recursive-descent parser while
 * keeping its public API byte-compatible: `parseIsc(source, filename)`
 * returning an IscDocument and throwing IscParseError on syntax errors.
 *
 * Single-sourcing contract: the grammar TEXT embedded in grammar-source.ts
 * is the semantic source of truth (synced from interscript-ruby's
 * lib/interscript/isc/grammar/isc.parg via scripts/sync-isc-grammar.mjs).
 * The three documented grammar-table extensions below (GRAMMAR_EXTENSIONS)
 * restore hand-parser/py behaviors the canonical .parg rejects — each is
 * spelled in the grammar language, named, and corpus-proven dormant.
 */

import type { IscDocument } from "../types.js"
import { parseError, TreeToDocument } from "./actions.js"
import { ISC_PARG_SOURCE } from "./grammar-source.js"
import { parseParg, type PargGrammar } from "./parg-reader.js"
import { PegError, PegInterpreter, type RuleTable } from "./peg.js"

interface Compiled {
  grammar: PargGrammar
  rules: RuleTable
  entry: string
}

let compiled: Compiled | undefined

/**
 * Grammar-table extensions — the three places where the former hand
 * parser (and the python runtime) accept syntax the canonical .parg
 * rejects, pinned by the ts unit suite and absent from the corpus. Each
 * extension is spelled in the grammar language itself and merged into
 * the rule table, so the .parg remains the only semantic source and
 * every extension is one visible, named block:
 *
 * 1. `any_arg` — restore the ruby DSL's final `item as :any_item`
 *    fallback (concerns/items.rb any_constructor), which the canonical
 *    .parg dropped; the interscript-rs vendored copy keeps it.
 *    (`any(space)`, `any(space + line_end)` — parser.test.ts pins both.)
 * 2. `block_rule` — accept the `when` guard AFTER the closing brace of
 *    the block form. The ruby DSL places the guard inside the braces;
 *    the ts and py runtimes both place it outside, and the ts suite pins
 *    the outside form (wf1.test.ts). The outside branch is tried first
 *    (it is the greedy one; its mandatory `}` keeps it from shadowing
 *    the inside form).
 * 3. `run_dep` — allow hyphenated dependency names (`run map.some-dep.…`,
 *    wf1.test.ts). The grammar's identifier is [A-Za-z_][A-Za-z0-9_]*;
 *    the former hand parser's identifier admitted `-` in structural
 *    positions. Only the dependency slot is widened; the corpus is
 *    hyphen-free in every identifier position.
 *
 * Ruby rejects (1)'s absence aside, the outside-when and hyphen-dep
 * forms are cross-runtime divergences (ruby parses neither); aligning
 * ruby/ts/py on one placement is an owner decision. None of the three
 * extensions fires on any corpus map (proven: the corpus tree-diff and
 * document-diff harnesses both pass with them in place, and corpus
 * trees were byte-identical before they were added).
 */
const GRAMMAR_EXTENSIONS = `
grammar IscExtensions version "0.0.0" {
  any_arg = range_arg / set_arg / alias_arg / ((item) as any_item)
  block_rule = ("sub" [ws] "{" [ws] "from" whitespace ((item) as from) [ws] "to" whitespace ((item) as to) ((*(whitespace constraint)) as constraints) [ws] "}" [(when_guard)]) / ("sub" [ws] "{" [ws] "from" whitespace ((item) as from) [ws] "to" whitespace ((item) as to) ((*(whitespace constraint)) as constraints) [(when_guard)] [ws] "}")
  run_dep = "map." (((identifier *("-" identifier)) / identifier) as dep) ".stage." (identifier as stage)
}
`

function compileGrammar(): Compiled {
  if (compiled !== undefined) return compiled
  const grammar = parseParg(ISC_PARG_SOURCE)
  const rules: RuleTable = { ...grammar.rules }
  // Shape-guarded merge: if a future .parg edit renames any of the three
  // rules, the merge throws instead of silently misparsing.
  const ext = parseParg(GRAMMAR_EXTENSIONS)
  for (const name of ["any_arg", "block_rule", "run_dep"]) {
    const replacement = ext.rules[name]
    if (rules[name] === undefined || replacement === undefined) {
      throw new Error(`grammar extension target ${name} missing from isc.parg — recheck GRAMMAR_EXTENSIONS`)
    }
    rules[name] = replacement
  }
  compiled = { grammar, rules, entry: grammar.entries["isc"] ?? "isc_source" }
  return compiled
}

/**
 * Parse ISC source text into an IscDocument.
 *
 *   const doc = parseIsc(source, "map.isc")
 *
 * Throws IscParseError (with filename/line/col, like the hand parser) on
 * syntax errors.
 */
export function parseIsc(source: string, filename?: string): IscDocument {
  const { rules, entry } = compileGrammar()
  try {
    const interp = new PegInterpreter(rules, source)
    const { value } = interp.parseRoot(entry)
    return new TreeToDocument(source).run(value)
  } catch (e) {
    if (e instanceof PegError) {
      // Report at the furthest position the parse reached — the same
      // contract as the hand parser's deepest-error reporting.
      const at = Math.min(e.at, Math.max(source.length - 1, 0))
      throw parseError(source, e.message, at < 0 ? 0 : at, filename)
    }
    throw e
  }
}
