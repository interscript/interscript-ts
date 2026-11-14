/**
 * Reverse mode — port of interscript-rs `src/reverse.rs`, which mirrors
 * `Interscript::Node::*#reverse` (interscript-ruby origin/main,
 * spec'd by spec/reversibility_spec.rb).
 *
 * The reversed document runs through the NORMAL executor: the
 * inversion lives entirely in the produced document. What rs does at
 * the node level, this module does at the compiled-map level:
 *
 *   - stages reverse (children in REVERSE order, each rule reversed);
 *   - sub rules swap from/to, hoist boundary-like aliases across the
 *     transfer, and exchange capture groups/refs;
 *   - `to upcase`/`to downcase` swap via Item#downcase/#upcase parity;
 *   - funcalls map through the Ruby `Stdlib.reverse_function` table;
 *   - the document name goes through `Document.reverse_name`;
 *   - metadata swaps source_script/destination_script;
 *   - aliases, languages, tests (absent from the IR) pass through.
 *
 * Documented ruby-crash deviations (rs `Error::Unsupported`, mirrored
 * here as MapLogicError with the same information):
 *   - a repeat item under a `to upcase`/`to downcase` sub
 *     (ruby: NoMethodError),
 *   - a boundary hoist consuming the whole from group
 *     (ruby: NoMethodError on `children=`),
 *   - a funcall outside the reverse_function map (ruby: nil.to_sym
 *     TypeError when the reversed funcall executes),
 *   - an unhandled item kind in the transfer walk (ruby: raise
 *     "Type ... unhandled!").
 *
 * Compiled-IR deltas vs the rs node model (behavior identical):
 *   - the compiled IR carries no `reverse_run`; a rule whose reversed
 *     `from` is empty and has no assertions — which ruby marks
 *     reverse_run: true so the executor skips it — is DROPPED here
 *     (ruby's own JSON-IR compilers omit reverse_run rules too);
 *   - dependency documents are names in the IR, so rs's recursion into
 *     embedded dependency documents lives on the runtime entry point
 *     (`InterscriptRuntime#reverse`), not on this pure function;
 *   - capture groups carry no ids: the regex engine numbers them in
 *     regex order at compile time, which is exactly the numbering
 *     rs's `assign_group_ids` reproduces; refs keep their numbers;
 *   - `priority` (absent from the rs model) negates on reverse per
 *     ruby `Sub#reverse`.
 */

import type {
  CompiledMap,
  FuncallInline,
  FuncallRule,
  Item,
  ParallelRule,
  Rule,
  SequentialRule,
  Stage,
  StringItem,
  SubRule,
} from "./types.js"
import { MapLogicError } from "./errors.js"

/**
 * `Interscript::Stdlib.reverse_function`: the inverse funcall used by
 * `Funcall#reverse`. `upcase` has no entry (the Ruby map omits it, so
 * reversing an upcase funcall crashes there) — and any other funcall
 * name is equally unmapped, mirroring rs's `FuncallName::reverse_name`.
 */
const REVERSE_FUNCTION: Readonly<Record<string, string>> = Object.freeze({
  // Those two are best-effort, but probably wrong (per Ruby).
  title_case: "downcase",
  downcase: "title_case",

  compose: "decompose",
  decompose: "compose",

  separate: "unseparate",
  unseparate: "separate",
})

/**
 * `Interscript::Stdlib.boundary_like_alias?` restricted to the prims
 * rs treats as boundary-like (`Boundary`, `NonWordBoundary`,
 * `LineStart`, `LineEnd` — the ISC grammar has no string_start /
 * string_end spellings). Names as the ISC parser emits them.
 */
const BOUNDARY_LIKE_ALIASES: ReadonlySet<string> = new Set([
  "boundary",
  "non_boundary",
  "non_word_boundary",
  "line_start",
  "line_end",
])

/** The compiled-IR form of ruby's `none` (converter lowering). */
const EMPTY_STRING: StringItem = { kind: "string", value: "" }

/**
 * `Interscript::Node::Document.reverse_name`: split on `-`, swap
 * positions 2/3 (source/target code) when there are at least 4
 * segments; otherwise strip a `-reverse` suffix, otherwise append one.
 */
export function reverseName(name: string): string {
  const parts = name.split("-")
  if (parts.length >= 4) {
    const swapped = parts.slice()
    const tmp = swapped[2]!
    swapped[2] = swapped[3]!
    swapped[3] = tmp
    const joined = swapped.join("-")
    if (joined !== name) return joined
  }
  const stripped = name.split("-reverse").join("")
  return stripped !== name ? stripped : `${name}-reverse`
}

/**
 * `Interscript::Node::Document#reverse` over the compiled form.
 * Aliases are NOT reversed (`rdoc.aliases = self.aliases`); dependency
 * names pass through (see the module docstring for rs's dependency
 * recursion and where it lives instead).
 */
export function reverseMap(map: CompiledMap): CompiledMap {
  const stages = map.stages.map(reverseStage)
  return {
    schemaVersion: 1,
    systemCode: reverseName(map.systemCode),
    dependencies: [...map.dependencies],
    ...(map.languages ? { languages: [...map.languages] } : {}),
    ...(map.metadata ? { metadata: reverseMetadata(map.metadata) } : {}),
    stages,
    aliases: map.aliases,
    functions: map.functions,
  }
}

/**
 * `MetaData#reverse` swaps source_script/destination_script (each side
 * only when the other is present — rs `reverse_metadata`).
 */
function reverseMetadata(metadata: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const src = metadata["source_script"]
  const dst = metadata["destination_script"]
  const out = { ...metadata }
  if ("source_script" in out && dst !== undefined) out["source_script"] = dst
  if ("destination_script" in out && src !== undefined) out["destination_script"] = src
  return out
}

/**
 * `Interscript::Node::Stage#reverse` / `Group#reverse`: children in
 * REVERSE order, each reversed, reverse_run toggled. (The ISC grammar
 * cannot express `dont_reverse`, so stages always reverse.)
 */
function reverseStage(stage: Stage): Stage {
  const rules: Rule[] = []
  for (let i = stage.rules.length - 1; i >= 0; i--) {
    const reversed = reverseRule(stage.rules[i]!)
    // A sub whose reversed `from` is empty is dropped, not emitted
    // (see the module docstring — ruby marks it reverse_run: true).
    if (reversed !== null) rules.push(reversed)
  }
  return { kind: "stage", name: stage.name, rules }
}

/** `null` = the reversed rule must not execute (ruby reverse_run: true). */
function reverseRule(rule: Rule): Rule | null {
  switch (rule.kind) {
    case "sub":
      return reverseSub(rule)

    case "run":
      // rs toggles reverse_run; the compiled IR carries none → identity.
      return rule

    case "funcall": {
      // `Interscript::Node::Rule::Funcall#reverse`: the name maps
      // through `Stdlib.reverse_function`; kwargs carry over.
      const target = REVERSE_FUNCTION[rule.name]
      if (!target) {
        throw new MapLogicError(
          `funcall ${rule.name} has no reverse (the Ruby reverse_function map omits it)`,
        )
      }
      const out: FuncallRule = {
        kind: "funcall",
        name: target,
        ...(rule.kwargs ? { kwargs: rule.kwargs } : {}),
      }
      return out
    }

    case "parallel":
    case "sequential": {
      const rules: Rule[] = []
      for (let i = rule.rules.length - 1; i >= 0; i--) {
        const reversed = reverseRule(rule.rules[i]!)
        if (reversed !== null) rules.push(reversed)
      }
      const out: ParallelRule | SequentialRule =
        rule.kind === "parallel" ? { kind: "parallel", rules } : { kind: "sequential", rules }
      return out
    }
  }
}

/**
 * `Interscript::Node::Rule::Sub#reverse`.
 * Returns `null` when the reversed rule must not execute: a rule whose
 * reversed `from` is empty (and carries no assertions) would match
 * EVERYWHERE — ruby's Sub#reverse marks those reverse_run: true so the
 * executor skips them, and the compiled-IR equivalent is absence.
 */
function reverseSub(rule: SubRule): SubRule | null {
  if (!rule.from) throw new MapLogicError("sub rule missing 'from'")

  let xfrom: Item
  let xto: Item | FuncallInline
  const to = rule.to

  if (to && to.kind === "funcall_inline") {
    // `sub from, to upcase` reverses to `sub from.downcase, to downcase`
    // (Item#downcase / Item#upcase parity, and vice versa).
    if (to.name === "upcase") {
      xfrom = itemCase(rule.from, false)
      xto = { kind: "funcall_inline", name: "downcase" }
    } else if (to.name === "downcase") {
      xfrom = itemCase(rule.from, true)
      xto = { kind: "funcall_inline", name: "upcase" }
    } else {
      // rs builder: only upcase/downcase functions become SubTo
      // targets; any other inline funcall walks the transfer and hits
      // its unhandled arm.
      const [f, t] = reverseTransfer(rule.from, to)
      xfrom = f
      xto = t
    }
  } else {
    const [f, t] = reverseTransfer(rule.from, to ?? EMPTY_STRING)
    xfrom = f
    xto = t
  }

  // Constraints pass through UNCHANGED (ruby keeps
  // before/after/not_before/not_after as-is); `priority` negates
  // (ruby Sub#reverse); `when` guards carry over unchanged (ISC-WF-1
  // W3 — the language selection filters the same rows on either
  // surface).
  const reversed: SubRule = {
    kind: "sub",
    from: xfrom,
    to: xto,
    ...(rule.before !== undefined ? { before: rule.before } : {}),
    ...(rule.notBefore !== undefined ? { notBefore: rule.notBefore } : {}),
    ...(rule.after !== undefined ? { after: rule.after } : {}),
    ...(rule.notAfter !== undefined ? { notAfter: rule.notAfter } : {}),
    ...(rule.priority !== undefined && rule.priority !== null ? { priority: -rule.priority } : {}),
    ...(rule.when !== undefined && rule.when.length > 0 ? { when: rule.when } : {}),
  }

  const hasAssertions = Boolean(rule.before || rule.notBefore || rule.after || rule.notAfter)
  if (hasAssertions || !isEmptyFrom(xfrom)) return reversed
  return null
}

/**
 * The ruby empty-from test: `xfrom == "" || String("")` (plus ruby's
 * `Alias(:none)` arm, unreachable in the compiled IR — the converter
 * lowers `none` to an empty string item).
 */
function isEmptyFrom(item: Item): boolean {
  return item.kind === "string" && item.value === ""
}

// ---------------------------------------------------------------------------
// Item#downcase / Item#upcase (Sub#reverse to upcase/downcase case)
// ---------------------------------------------------------------------------

/** `Item#downcase`. */
export function itemDowncase(item: Item): Item {
  return itemCase(item, false)
}

/** `Item#upcase`. */
export function itemUpcase(item: Item): Item {
  return itemCase(item, true)
}

/**
 * `Item#downcase`/`Item#upcase`: string data case-maps; groups and
 * captures recurse; aliases (incl. boundary prims) and refs are
 * identity; `any` rebuilds from per-entry case-mapped children; a
 * char-class range rebuilds as the set of its per-char entries
 * (`Any.new(data.map(&:downcase))` parity).
 */
function itemCase(item: Item, up: boolean): Item {
  const apply = (s: string): string => (up ? s.toUpperCase() : s.toLowerCase())
  switch (item.kind) {
    case "string":
      return { kind: "string", value: apply(item.value) }
    // Item::Alias#downcase/#upcase = self; refs too.
    case "alias":
    case "capture_ref":
      return item
    case "capture_group":
      return { kind: "capture_group", data: itemCase(item.data, up) }
    case "group":
      return { kind: "group", items: item.items.map((c) => itemCase(c, up)) }
    case "any":
      return { kind: "any", of: item.of.map((c) => itemCase(c, up)) }
    case "any_char_class": {
      if (item.range) {
        const [lo, hi] = item.range
        const entries: Item[] = []
        for (let cp = lo.codePointAt(0)!; ; cp++) {
          entries.push({ kind: "string", value: apply(String.fromCodePoint(cp)) })
          if (cp === hi.codePointAt(0)!) break
        }
        return { kind: "any", of: entries }
      }
      if (item.chars) {
        return { kind: "any", of: item.chars.map((c) => ({ kind: "string", value: apply(c) })) }
      }
      return item
    }
    // Ruby Item::Repeat has no downcase/upcase: NoMethodError.
    case "repeat":
      throw new MapLogicError(
        "repeat item in a to-upcase/downcase sub (the Ruby reverse raises NoMethodError)",
      )
    case "stage_ref":
      throw new MapLogicError(
        `unhandled item kind ${item.kind} in a to-upcase/downcase sub (the Ruby reverse raises NoMethodError)`,
      )
  }
}

// ---------------------------------------------------------------------------
// Sub#reverse_transfer: boundary hoisting + capture/ref exchange
// ---------------------------------------------------------------------------

function isBoundaryLike(item: Item): boolean {
  return item.kind === "alias" && BOUNDARY_LIKE_ALIASES.has(item.name)
}

/** Ruby `Group#compact` over an already-collected children list:
 * drop none/"" children; 0 -> none (the IR empty string), 1 -> the child. */
function compactItems(children: Item[]): Item {
  const kept = children.filter((c) => !(c.kind === "string" && c.value === ""))
  if (kept.length === 0) return { ...EMPTY_STRING }
  if (kept.length === 1) return kept[0]!
  return { kind: "group", items: kept }
}

/** Ruby `Group.new + a + b ...` then `compact`: a fresh group whose
 * children are the leading items plus `last` — flattened when `last`
 * is itself a group (`Group#+` merges children). */
function groupPlusCompact(prefix: Item[], last: Item): Item {
  const children = prefix.slice()
  if (last.kind === "group") children.push(...last.items)
  else children.push(last)
  return compactItems(children)
}

/**
 * `Interscript::Node::Rule::Sub#reverse_transfer`: boundary-like
 * aliases at the from edges move onto the to side; then the
 * capture/ref exchange runs. Returns (reversed_from, reversed_to) —
 * the ruby multi-assign `xto, xfrom = reverse_transfer(from, to)`
 * swaps the results.
 */
function reverseTransfer(from: Item, to: Item | FuncallInline): [Item, Item] {
  let f = from
  let t: Item | FuncallInline = to

  if (f.kind === "group") {
    // Ruby reads first/last BEFORE either mutation.
    const parts = f.items
    const first = parts[0]
    const last = parts[parts.length - 1]

    // first child boundary-like -> prepended to `to`
    if (first && isBoundaryLike(first)) {
      t = groupPlusCompact([first], t as Item)
      f = compactItems(parts.slice(1))
    }
    // last child boundary-like -> appended to `to`. Ruby mutates
    // `from.children` here, which requires `from` to still be a Group;
    // a first-hoist that consumed the whole group crashes there
    // (NoMethodError).
    if (last && isBoundaryLike(last)) {
      if (f.kind !== "group") {
        throw new MapLogicError(
          "boundary hoist consumed the whole from group " +
            "(the Ruby reverse raises NoMethodError)",
        )
      }
      const shorter = f.items.slice(0, -1)
      t = groupPlusCompact([t as Item], last)
      f = compactItems(shorter)
    }
  } else {
    // Whole-from boundary alias: `_end`-suffixed names append after
    // `to`, everything else prepends before it; from becomes `none`.
    // Ruby tests `from.name.end_with?("_end")` — among the ISC prims
    // only line_end qualifies (string_end is not in the grammar).
    if (isBoundaryLike(f)) {
      const boundary = f
      t =
        boundary.kind === "alias" && boundary.name === "line_end"
          ? groupPlusCompact([t as Item], boundary)
          : groupPlusCompact([boundary], t as Item)
      f = { ...EMPTY_STRING }
    }
  }

  // --- capture/ref exchange ---
  const state: TransferState = { left: [], right: new Set() }
  const visitedFrom = transferVisit(f, "from", state)
  const visitedTo = transferVisit(t, "to", state)
  // xto, xfrom = reverse_transfer(from, to)
  return [visitedTo, visitedFrom]
}

interface TransferState {
  /** Ruby state[:left]: every capture group seen, in visit order;
   * minted ref ids index into it (1-based). */
  left: Item[]
  /** Ruby state[:right]: ref ids already substituted on the `to`
   * side (a second occurrence stays a literal ref). */
  right: Set<number>
}

/**
 * `reverse_transfer_visit`. Refs stay positional numbers — the regex
 * engine numbers the reversed rule's groups in regex order at compile
 * time, the same numbers ruby's `build_regexp` assigns at build time.
 */
function transferVisit(
  node: Item | FuncallInline,
  side: "from" | "to",
  state: TransferState,
): Item {
  switch (node.kind) {
    case "alias":
      // Alias :kor_maybedash -> CaptureRef(left.length). (rs's builder
      // expands the alias to its capture(maybe("-")) tree before
      // reverse sees it, where the CaptureGroup branch handles it with
      // identical numbering — this branch guards direct alias items
      // and documents the Ruby special case.)
      if (node.name === "kor_maybedash") {
        state.left.push(node)
        return { kind: "capture_ref", id: state.left.length }
      }
      return node

    case "string":
      return node

    case "capture_ref":
      if (side === "from") return node
      // refs on the to side: the first occurrence substitutes the
      // matching from-side group; further occurrences stay refs.
      if (state.right.has(node.id)) return node
      state.right.add(node.id)
      {
        const group = state.left[node.id - 1]
        if (!group) throw new MapLogicError("Capture count doesn't match")
        return group
      }

    case "capture_group": {
      state.left.push(node)
      const out: Item = { kind: "capture_ref", id: state.left.length }
      // Visit but don't care (inner groups still register).
      transferVisit(node.data, side, state)
      return out
    }

    case "any":
      return { kind: "any", of: node.of.map((c) => transferVisit(c, side, state)) }

    case "group":
      return { kind: "group", items: node.items.map((c) => transferVisit(c, side, state)) }

    // Repeat: only the data is visited; the repeat kind survives.
    case "repeat":
      return { ...node, item: transferVisit(node.item, side, state) }

    case "any_char_class":
      return node

    case "stage_ref":
    case "funcall_inline":
      throw new MapLogicError(
        `Type ${node.kind} unhandled in reverse_transfer_visit ` +
          '(the Ruby raises "Type ... unhandled!")',
      )
  }
}
