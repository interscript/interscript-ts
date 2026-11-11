/**
 * Action layer — turns the parslet-shaped capture tree produced by the
 * PEG interpreter (peg.ts) into an IscDocument.
 *
 * Every action mirrors the hand parser's (src/isc/parser.ts) semantic
 * action for the same construct, so the generated parser is a drop-in
 * replacement: identical documents for identical source. Where the hand
 * parser deviates from the grammar (each case is corpus-proven to be a
 * legacy ts/py-side rendering the ruby artifact does not share), the
 * deviation is reproduced here and flagged with a DEVIATION comment —
 * grammar fidelity loses to swap-safety, on purpose, until the owners
 * decide to align the runtimes.
 */

import type { IscDocument, IscItem, IscRule, IscStage, IscStageItem, IscTest } from "../types.js"
import { IscParseError } from "../types.js"
import { Slice } from "./peg.js"

type Tree = unknown
type Hash = Record<string, unknown>

function hash(v: Tree): Hash {
  if (v === null || typeof v !== "object" || Array.isArray(v) || v instanceof Slice) {
    throw new Error(`grammar/action mismatch: expected a capture hash, got ${JSON.stringify(v)}`)
  }
  return v as Hash
}

function array(v: Tree): Tree[] {
  if (!Array.isArray(v))
    throw new Error(`grammar/action mismatch: expected an array, got ${JSON.stringify(v)}`)
  return v
}

/** Text of a captured identifier (a merged slice). */
function identifier(tree: Tree): string {
  const id = hash(tree).identifier
  return id instanceof Slice ? id.content : (id as string)
}

/**
 * A `run map.a-b.stage.x` dependency name: the hyphen extension captures
 * `identifier *("-" identifier)`, so a hyphenated name arrives as an
 * array of identifier hashes (the "-" literals are dropped by flatten);
 * a plain name is a single hash. Rejoin on "-".
 */
function dependencyName(tree: Tree): string {
  if (Array.isArray(tree)) {
    return tree.map((t) => identifier(t)).join("-")
  }
  return identifier(tree)
}

/** Text of a captured literal keyword (primitive/function/case names...). */
function text(v: unknown): string {
  return v instanceof Slice ? v.content : (v as string)
}

export class TreeToDocument {
  constructor(private readonly src: string) {}

  run(tree: Tree): IscDocument {
    const system = hash(hash(tree).system)
    const systemCode = this.string(hash(system.system_code))

    let metadata: Record<string, unknown> = {}
    let tests: IscTest[] = []
    let aliases: Array<{ name: string; value: IscItem }> = []
    const stages: IscStage[] = []
    const rulesets: Array<{ name: string; body: IscStageItem[] }> = []
    const dependencies: Array<{ target: string; aliasName?: string }> = []
    const languages = new Set<string>()

    for (const entry of array(system.body ?? [])) {
      const h = hash(entry)
      if (h.metadata !== undefined) {
        metadata = { ...metadata, ...this.metadataFields(array(h.metadata)) }
        continue
      }
      if (h.tests !== undefined) {
        tests = array(h.tests).map((t) => this.test(t))
        continue
      }
      if (h.aliases !== undefined) {
        aliases = array(h.aliases).map((a) => {
          const ah = hash(a)
          return { name: identifier(ah.name), value: this.item(ah.value) }
        })
        continue
      }
      if (h.stage_name !== undefined && h.stage !== undefined) {
        stages.push({ name: identifier(h.stage_name), body: this.stageBody(array(h.stage)) })
        continue
      }
      if (h.ruleset_name !== undefined && h.ruleset !== undefined) {
        rulesets.push({ name: identifier(h.ruleset_name), body: this.stageBody(array(h.ruleset)) })
        continue
      }
      if (h.target !== undefined) {
        const alias = h.alias !== undefined ? identifier(h.alias) : undefined
        dependencies.push({
          target: this.string(h.target),
          ...(alias !== undefined ? { aliasName: alias } : {}),
        })
        continue
      }
      if (h.languages !== undefined) {
        // one declared language collapses to a bare hash (flatten's fold)
        for (const l of this.itemList(h.languages) ?? []) {
          languages.add(identifier(hash(hash(l).language)))
        }
        continue
      }
      throw new Error(`unknown system body item ${JSON.stringify(Object.keys(h))}`)
    }

    return {
      systemCode,
      metadata,
      tests,
      aliases,
      stages,
      dependencies,
      ...(rulesets.length > 0 ? { rulesets } : {}),
      ...(languages.size > 0 ? { languages: [...languages] } : {}),
    }
  }

  // -- string literals ------------------------------------------------------

  /** Decode a captured string-literal tree ({string: parts-or-slice}). */
  private string(tree: Tree): string {
    const { string: parts } = hash(tree)
    if (!Array.isArray(parts)) {
      // single-quoted form: the whole body coalesced into one slice
      return parts instanceof Slice ? parts.content : (parts as string)
    }
    let out = ""
    for (const part of parts) {
      const h = hash(part)
      if (h.run !== undefined) out += (h.run as Slice).content
      else if (h.newline !== undefined) out += "\n"
      else if (h.carriage_return !== undefined) out += "\r"
      else if (h.tab !== undefined) out += "\t"
      else if (h.dquote !== undefined) out += '"'
      else if (h.backslash !== undefined) out += "\\"
      else if (h.u_lone !== undefined) out += "U"
      else if (h.unicode !== undefined) {
        const digits = (h.unicode as Slice).content
        // DEVIATION (hand-parser parity): the grammar cannot distinguish
        // `\uXXXX` from `\UXXXX` (both captures are named :unicode), but the
        // hand parser only decodes lowercase \u and renders a capital \U as
        // a literal "U" followed by the raw digits. The slice offset tells
        // us which spelling the source used (the escape letter sits one
        // position before the digits). Six corpus maps use `\U`; mirroring
        // the hand parser keeps their documents — and therefore their
        // transliteration output — byte-identical across the swap. The ruby
        // artifact parser decodes both spellings; aligning ts/py/ruby on the
        // grammar behavior is an owner decision, not this parser's to make.
        if (this.src.charCodeAt((h.unicode as Slice).offset - 1) === 0x55) {
          out += "U" + digits
        } else {
          out += String.fromCharCode(parseInt(digits, 16))
        }
      } else {
        throw new Error(`unknown string part ${JSON.stringify(Object.keys(h))}`)
      }
    }
    return out
  }

  // -- items ----------------------------------------------------------------

  /** A captured `item` — one atom, or an array of atoms (juxtaposition/+). */
  private item(tree: Tree): IscItem {
    const v = hash(tree).concatenation
    const atoms = (Array.isArray(v) ? v : [v]).map((a) => this.atom(a))
    const single = atoms.length === 1 ? atoms[0] : undefined
    return single ?? { type: "concat", parts: atoms }
  }

  /** A single captured `item_atom`. */
  private atom(tree: Tree): IscItem {
    const h = hash(tree)
    if (h.string !== undefined) return { type: "string", value: this.string(tree) }
    if (h.none !== undefined) return { type: "none" }
    if (h.primitive !== undefined) return { type: "primitive", name: text(h.primitive) }
    if (h.any_char !== undefined) return { type: "function", name: "any_character" }
    if (h.function !== undefined) return { type: "function", name: text(h.function) }
    if (h.any !== undefined) return this.any(hash(h.any))
    if (h.capture_inner !== undefined)
      return { type: "capture_group", inner: this.item(h.capture_inner) }
    if (h.maybe_inner !== undefined) return { type: "maybe", inner: this.item(h.maybe_inner) }
    if (h.some_inner !== undefined) return { type: "some", inner: this.item(h.some_inner) }
    if (h.ref !== undefined) {
      const digit = hash(h.ref).digit
      return { type: "capture", index: Number(digit instanceof Slice ? digit.content : digit) }
    }
    if (h.alias !== undefined) {
      const a = hash(h.alias)
      // Qualified alias references inside items (`a.b`) never occur in the
      // corpus and the hand parser has no qualified form; keep the dotted
      // spelling when the grammar captures one.
      const q = a.qualified_name !== undefined ? "." + identifier(a.qualified_name) : ""
      return { type: "alias_ref", name: identifier(a) + q }
    }
    throw new Error(`unknown item atom ${JSON.stringify(Object.keys(h))}`)
  }

  private any(h: Hash): IscItem {
    if (h.single !== undefined) {
      // any("abc") — the hand parser splits a plain string into per-char items.
      const v = this.string(h.single)
      return { type: "set", items: [...v].map((c) => ({ type: "string", value: c }) as IscItem) }
    }
    if (h.lo !== undefined && h.hi !== undefined) {
      return { type: "range", lo: this.string(h.lo), hi: this.string(h.hi) }
    }
    if (h.list !== undefined) {
      // one list item collapses to a bare concatenation hash
      const listItems = Array.isArray(h.list) ? h.list : [h.list]
      return { type: "set", items: listItems.map((t) => this.item(t)) }
    }
    if (h.alias_ref !== undefined) {
      return { type: "set", items: [this.atom({ alias: h.alias_ref })] }
    }
    if (h.any_item !== undefined) {
      // The DSL's `item` fallback inside any(...) — kept for hand-parser
      // parity (see the any_ctor extension in isc-parser.ts).
      return { type: "set", items: [this.item(h.any_item)] }
    }
    throw new Error(`unknown any() shape ${JSON.stringify(Object.keys(h))}`)
  }

  // -- rules ----------------------------------------------------------------

  private rule(tree: Tree): IscRule {
    const h = hash(tree)
    const constraints = (this.itemList(h.constraints) ?? []).map((c) => {
      const entry = Object.entries(hash(c))[0]
      if (entry === undefined) throw new Error("empty constraint capture")
      const [kind, inner] = entry
      return { kind, item: this.item(inner) }
    })
    const whenList = this.itemList(h.when)
    const when =
      whenList !== undefined ? whenList.map((w) => identifier(hash(hash(w).when_lang))) : undefined
    // Compact rules capture raw item_atoms (`sub "a" "b"`); block rules
    // capture full items (`from "a"` — a concatenation tree). The
    // concatenation key tells them apart.
    const fromItem =
      hash(h.from).concatenation !== undefined ? this.item(h.from) : this.atom(h.from)
    const toItem = hash(h.to).concatenation !== undefined ? this.item(h.to) : this.atom(h.to)
    return {
      from: fromItem,
      to: toItem,
      constraints,
      ...(when !== undefined && when.length > 0 ? { when } : {}),
    }
  }

  /**
   * A captured repetition's value: an array, or a single merged hash when
   * exactly one iteration produced a capture (flatten's sequence fold
   * drops the array wrapper). Absent -> undefined.
   */
  private itemList(v: Tree | undefined): Tree[] | undefined {
    if (v === undefined) return undefined
    return Array.isArray(v) ? v : [v]
  }

  /** rule_items for parallel/sequence/override blocks: skip comment/noop rows. */
  private ruleList(trees: Tree[]): IscRule[] {
    return trees
      .filter((t) => {
        const h = hash(t)
        return h.comment === undefined && h.noop === undefined
      })
      .map((t) => this.rule(t))
  }

  // -- stage bodies ---------------------------------------------------------

  private stageBody(trees: Tree[]): IscStageItem[] {
    const out: IscStageItem[] = []
    for (const tree of trees) {
      const h = hash(tree)
      if (h.comment !== undefined || h.noop !== undefined) continue
      if (h.bare_rule !== undefined) {
        out.push({ kind: "bare_rule", rule: this.rule(h.bare_rule) })
        continue
      }
      if (h.parallel !== undefined) {
        out.push({ kind: "parallel", rules: this.ruleList(array(h.parallel)) })
        continue
      }
      if (h.sequence !== undefined) {
        out.push({ kind: "sequence", rules: this.ruleList(array(h.sequence)) })
        continue
      }
      if (h.dep !== undefined && h.stage !== undefined) {
        out.push({ kind: "run", dependency: dependencyName(h.dep), stage: identifier(h.stage) })
        continue
      }
      if (h.run_stage_only !== undefined) {
        out.push({ kind: "run", stage: identifier(hash(h.run_stage_only).stage) })
        continue
      }
      if (h.separate !== undefined) {
        out.push({
          kind: "separate",
          ...(h.separator !== undefined ? { separator: this.atom(h.separator) } : {}),
        })
        continue
      }
      if (h.case !== undefined) {
        // title_case's kwargs (case_kwargs) are captured by the grammar but
        // ignored by the hand parser — mirrored here.
        out.push({ kind: "string_case", op: text(h.case) })
        continue
      }
      if (h.compose !== undefined) {
        out.push({ kind: text(h.compose) as "compose" | "decompose" })
        continue
      }
      if (h.funcall_name !== undefined) {
        const kwargs: Record<string, string> = {}
        if (h.funcall_kwargs !== undefined) {
          // kwarg_list: one captured kwarg collapses to the bare hash;
          // several arrive as an array of {kwarg: ...} hashes.
          const list: unknown = hash(h.funcall_kwargs).kwarg
          const entries: Hash[] = Array.isArray(list)
            ? list.map((e) => hash(e).kwarg as Hash)
            : [hash(list) as Hash]
          for (const kw of entries) {
            kwargs[identifier(kw.kwarg_name)] = this.string(kw.kwarg_value)
          }
        }
        out.push({ kind: "funcall", name: text(h.funcall_name), kwargs })
        continue
      }
      if (h.use !== undefined) {
        const u = hash(h.use)
        const name = identifier(hash(u.use_alias))
        const qualified = u.qualified_name !== undefined ? identifier(u.qualified_name) : undefined
        const overrides =
          u.use_overrides !== undefined ? this.ruleList(array(u.use_overrides)) : undefined
        // Hand parser: `use a.b` names the ruleset b, reached through dependency a.
        out.push({
          kind: "use",
          name: qualified ?? name,
          ...(qualified !== undefined ? { dependency: name } : {}),
          ...(overrides !== undefined ? { override: overrides } : {}),
        })
        continue
      }
      throw new Error(`unknown stage item ${JSON.stringify(Object.keys(h))}`)
    }
    return out
  }

  // -- metadata -------------------------------------------------------------

  private metadataFields(trees: Tree[]): Record<string, unknown> {
    const metadata: Record<string, unknown> = {}
    for (const tree of trees) {
      const h = hash(tree)
      if (h.field_name !== undefined) {
        const key = identifier(h.field_name)
        if (h.field_value !== undefined)
          metadata[key] = this.fieldValue(h.field_value, h.field_name)
        else if (h.field_block !== undefined) metadata[key] = this.rawText(h.field_block)
        else metadata[key] = ""
        continue
      }
      if (h.description !== undefined) {
        metadata.description = this.rawText(h.description)
        continue
      }
      if (h.notes !== undefined) {
        const notes = array(h.notes).map((n) => this.string(hash(n).note))
        // DEVIATION (hand-parser parity): the grammar captures an empty
        // notes block as []; the hand parser's raw-text fallback yields "".
        // The corpus never distinguishes them, but the ts unit suite pins "".
        metadata.notes = notes.length === 0 ? "" : notes
        continue
      }
      if (h.specification !== undefined || h.provenance !== undefined) {
        const key = h.specification !== undefined ? "specification" : "provenance"
        const values = array(h.specification ?? h.provenance).map((v) => this.string(hash(v)[key]))
        metadata[key] = values.length === 1 ? values[0] : values
        continue
      }
      if (h.relations !== undefined) {
        metadata.relations = array(h.relations).map((r) => {
          const rh = hash(r)
          return {
            type: text(rh.type),
            system: this.string(rh.system),
            ...(rh.note !== undefined ? { note: this.string(rh.note) } : {}),
          }
        })
        continue
      }
      if (h.system_status !== undefined) {
        metadata.system_status = text(h.system_status)
        continue
      }
      if (h.code_status !== undefined) {
        metadata.code_status = text(h.code_status)
        continue
      }
      // String-valued named fields: authority / name / identifying /
      // source_spelling / target_spelling — the hand parser reaches the
      // same values through the generic-field path.
      for (const key of [
        "authority",
        "name",
        "identifying",
        "source_spelling",
        "target_spelling",
      ]) {
        if (h[key] !== undefined) {
          metadata[key] = this.string(h[key])
          break
        }
      }
    }
    return metadata
  }

  /**
   * The hand parser's parseRawText: a brace-block's raw text with `\{`
   * and `\}` unescaped, trimmed. An empty block folds to [] (a named
   * zero-iteration repetition) and reads as "".
   */
  private rawText(v: unknown): string {
    let content: string
    if (v instanceof Slice) content = v.content
    else if (typeof v === "string") content = v
    else if (Array.isArray(v) && v.length === 0) return ""
    else throw new Error(`unknown raw text ${JSON.stringify(v)}`)
    return content.replace(/\\([{}])/g, "$1").trim()
  }

  /**
   * DEVIATION (hand-parser parity): the hand parser only treats a
   * double-quoted value as a quoted string — anything else (single-quoted
   * values, bare words) falls through to its read-to-newline fallback,
   * keeping quotes/spelling verbatim, trimmed. The grammar decodes
   * single-quoted values properly, so dispatch on the SOURCE spelling at
   * the position the hand parser would read from (just past the field
   * name and its inline whitespace): `"` decodes, everything else takes
   * the raw line.
   */
  private fieldValue(tree: Tree, fieldName?: Tree): string {
    const h = hash(tree)
    if (h.raw !== undefined) return text(h.raw).trim()
    // String-valued: dispatch on the source spelling at the value start.
    const start = this.valueStart(h, fieldName)
    if (start !== null && this.src[start] !== '"') {
      return this.rawLineFrom(start).trim()
    }
    return this.string(tree)
  }

  /**
   * The position the hand parser's value reader starts from: right after
   * the field name plus inline whitespace. Anchored on the value slice
   * when there is one (the opening quote sits just before it), otherwise
   * on the field name.
   */
  private valueStart(h: Hash, fieldName?: Tree): number | null {
    const parts = h.string
    if (Array.isArray(parts)) {
      if (
        parts.length > 0 &&
        parts[0] !== null &&
        typeof parts[0] === "object" &&
        !Array.isArray(parts[0])
      ) {
        const run = hash(parts[0]).run
        if (run instanceof Slice) return run.offset - 1
      }
      if (parts.length === 0 && fieldName !== undefined) {
        const id = hash(fieldName).identifier
        if (id instanceof Slice) {
          let p = id.offset + id.content.length
          while (this.src[p] === " " || this.src[p] === "\t") p++
          return p
        }
      }
      return null
    }
    if (parts instanceof Slice) return parts.offset - 1
    return null
  }

  /** The hand parser's parseToNewline: from `pos` to the next newline. */
  private rawLineFrom(pos: number): string {
    const nl = this.src.indexOf("\n", pos)
    return this.src.slice(pos, nl === -1 ? undefined : nl)
  }

  private test(tree: Tree): IscTest {
    const th = hash(tree)
    const row: { input: string; expected: string; note?: string } = {
      input: this.string(th.input),
      expected: this.string(th.expected),
    }
    if (th.note !== undefined) row.note = this.string(th.note)
    return row
  }
}

/** Line/column from an offset (the hand parser's error math). */
export function lineCol(src: string, pos: number): { line: number; col: number } {
  const line = src.slice(0, pos).split("\n").length
  const col = pos - src.lastIndexOf("\n", pos)
  return { line, col }
}

/** Build an IscParseError the way the hand parser reports failures. */
export function parseError(
  src: string,
  message: string,
  at: number,
  filename?: string,
): IscParseError {
  const { line, col } = lineCol(src, at)
  const loc = filename ? `${filename}: ` : ""
  return new IscParseError(`${loc}${message}`, at, line, col)
}
