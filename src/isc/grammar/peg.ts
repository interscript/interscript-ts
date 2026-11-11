/**
 * PEG interpreter for grammar tables produced by parg-reader.ts.
 *
 * Reproduces the parsanol (parslet-lineage) execution and tree-building
 * semantics exactly:
 *
 *   - PEG ordered choice with full backtracking ACROSS alternatives, but
 *     possessive repetition (a failed iteration never unwinds earlier ones)
 *   - zero-width lookaheads (`!x` negative, `&x` positive)
 *   - values are: Slice (matched text + offset), capture hash, array, null
 *   - flattening (CanFlatten): a sequence folds its parts — string-likes
 *     coalesce, a string-like meeting a hash/array is dropped, hashes merge
 *     (later keys win), arrays concat; a repetition containing hashes keeps
 *     only the hashes (bare strings are discarded), one containing arrays
 *     flattens the arrays, a purely textual one joins into one Slice; an
 *     unnamed optional that matched nothing yields ""
 *
 * The result is the parslet-shaped capture tree the interscript-ruby
 * artifact parser produces (tree equality is proven by the corpus tree-diff
 * harness), which the action layer (actions.ts) then turns into an
 * IscDocument.
 */

/** A matched span of input (parsanol Slice: offset + content). */
export class Slice {
  constructor(
    readonly offset: number,
    readonly content: string,
  ) {}
}

export type RuleTable = Record<string, PegNode>

export type PegNode =
  | { k: "lit"; s: string }
  | { k: "class"; ranges: Array<[number, number]> }
  | { k: "seq"; a: PegNode[] }
  | { k: "alt"; a: PegNode[] }
  | { k: "rep"; a: PegNode; min: number; max: number | null; maybe?: boolean }
  | { k: "pred"; positive: boolean; a: PegNode }
  | { k: "cap"; name: string; a: PegNode }
  | { k: "ref"; name: string }

function isHash(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Slice)
}

function isStringlike(v: unknown): v is string | Slice {
  return typeof v === "string" || v instanceof Slice
}

function sliceContent(v: unknown): string {
  return v instanceof Slice ? v.content : (v as string)
}

// ---------------------------------------------------------------------------
// Flattening — direct port of Parsanol::CanFlatten.
// ---------------------------------------------------------------------------

export function flatten(value: unknown, named = false): unknown {
  if (!Array.isArray(value)) return value
  const tag = value[0] as string

  if (value.length === 2) {
    const f = flatten(value[1])
    if (tag === "seq") return f
    if (tag === "maybe") return named ? f : f || ""
    if (tag === "rep") return flattenRepetition([f], named)
  }

  const n = value.length - 1
  const result: unknown[] = new Array(n)
  for (let i = 0; i < n; i++) result[i] = flatten(value[i + 1])

  if (tag === "seq") return flattenSequence(result)
  if (tag === "maybe") return named ? result[0] : result[0] || ""
  if (tag === "rep") return flattenRepetition(result, named)
  throw new Error(`BUG: unknown flatten tag ${JSON.stringify(tag)}`)
}

function flattenSequence(list: unknown[]): unknown {
  // foldl: skip leading nils, merge the rest left-to-right.
  let i = 0
  const len = list.length
  while (i < len && list[i] === null) i++
  if (i >= len) return ""
  let acc = list[i]
  i++
  for (; i < len; i++) {
    const e = list[i]
    if (e !== null) acc = mergeFold(acc, e)
  }
  return acc
}

function mergeFold(l: unknown, r: unknown): unknown {
  const lHash = isHash(l)
  const rHash = isHash(r)
  const lStr = isStringlike(l)
  const rStr = isStringlike(r)

  // equal pairs: merge
  if (lHash && rHash) return { ...(l as Record<string, unknown>), ...(r as Record<string, unknown>) }
  if (Array.isArray(l) && Array.isArray(r)) return [...(l as unknown[]), ...(r as unknown[])]
  if (l instanceof Slice && r instanceof Slice) {
    return new Slice(l.offset, l.content + r.content)
  }
  if (typeof l === "string" && typeof r === "string") return l + r
  if (lStr && rStr) {
    // Mixing a plain string with a Slice keeps the slice (its offset).
    return r instanceof Slice ? r : l
  }
  // unequal pairs: a string-like meeting a structured value drops itself
  if (rStr) return l
  if (lStr) return r
  // hash/array hoisting
  if (isHash(r)) return [...(l as unknown[]), r]
  if (isHash(l)) return [l, ...(r as unknown[])]
  throw new Error(`BUG: unhandled merge_fold case (${typeof l} / ${typeof r})`)
}

function flattenRepetition(list: unknown[], named: boolean): unknown {
  let hasHash = false
  let hasArray = false
  for (const e of list) {
    if (isHash(e)) hasHash = true
    else if (Array.isArray(e)) hasArray = true
  }
  if (hasHash) {
    const hashes: unknown[] = []
    for (const e of list) if (isHash(e)) hashes.push(e)
    return hashes
  }
  if (hasArray) {
    const flat: unknown[] = []
    for (const e of list) if (Array.isArray(e)) flat.push(...e)
    return flat
  }
  if (named && list.length === 0) return []
  // All-string repetition: join into one slice.
  let first: Slice | null = null
  let content: string | null = null
  for (const e of list) {
    if (e === null) continue
    if (first === null && e instanceof Slice) first = e
    const piece = sliceContent(e)
    content = content === null ? piece : content + piece
  }
  if (content === null) return ""
  if (first !== null) return new Slice(first.offset, content)
  return content
}

// ---------------------------------------------------------------------------
// Interpreter
// ---------------------------------------------------------------------------

interface Ok {
  ok: true
  value: unknown
  pos: number
}
interface Fail {
  ok: false
}
type R = Ok | Fail

const FAIL: Fail = { ok: false }

export class PegError extends Error {
  /** Furthest position the parse reached, for error reporting. */
  readonly at: number
  constructor(message: string, at: number) {
    super(message)
    this.name = "PegError"
    this.at = at
  }
}

export class PegInterpreter {
  private readonly memo = new Map<string, R>()
  private farthest = 0
  /** Guards against runaway recursion (malformed grammars). */
  private depth = 0
  private static readonly MAX_DEPTH = 200

  constructor(
    private readonly rules: RuleTable,
    private readonly src: string,
  ) {}

  /** Parse from `start`, requiring the ROOT rule plus full input consumption. */
  parseRoot(root: string, start = 0): { value: unknown; end: number } {
    const r = this.applyRule(root, start)
    if (!r.ok || r.pos !== this.src.length) {
      const at = r.ok ? r.pos : this.farthest
      throw new PegError(this.describeFailure(root, at), at)
    }
    return { value: flatten(r.value), end: r.pos }
  }

  private describeFailure(root: string, at: number): string {
    const line = this.src.slice(0, at).split("\n").length
    const col = at - this.src.lastIndexOf("\n", at)
    return `Failed to match ${root} at line ${line} char ${col}`
  }

  private note(pos: number): void {
    if (pos > this.farthest) this.farthest = pos
  }

  private applyRule(name: string, pos: number): R {
    const key = name + ":" + pos
    const hit = this.memo.get(key)
    if (hit !== undefined) return hit
    const node = this.rules[name]
    if (node === undefined) throw new PegError(`unknown rule ${JSON.stringify(name)}`, pos)
    if (++this.depth > PegInterpreter.MAX_DEPTH) {
      this.depth--
      throw new PegError(`recursion limit exceeded in rule ${JSON.stringify(name)}`, pos)
    }
    const r = this.apply(node, pos, false)
    this.depth--
    this.memo.set(key, r)
    return r
  }

  private apply(node: PegNode, pos: number, consumeAll: boolean): R {
    switch (node.k) {
      case "lit": {
        if (this.src.startsWith(node.s, pos)) {
          this.note(pos + node.s.length)
          return { ok: true, value: new Slice(pos, node.s), pos: pos + node.s.length }
        }
        return FAIL
      }
      case "class": {
        // Character classes match ONE UTF-16 code unit. Every class in the
        // ISC grammar is BMP; the catch-all `chr` (%x00-10FFFF) also admits
        // surrogate halves, which textual repetitions rejoin into identical
        // strings — so unit-wise matching never changes tree content.
        const unit = this.src.charCodeAt(pos)
        if (Number.isNaN(unit)) return FAIL
        for (const [lo, hi] of node.ranges) {
          if (unit >= lo && unit <= hi) {
            this.note(pos + 1)
            return { ok: true, value: new Slice(pos, this.src.slice(pos, pos + 1)), pos: pos + 1 }
          }
        }
        return FAIL
      }
      case "seq": {
        let cur = pos
        const parts: unknown[] = ["seq"]
        for (let i = 0; i < node.a.length; i++) {
          const isLast = i === node.a.length - 1
          const r = this.apply(node.a[i]!, cur, consumeAll && isLast)
          if (!r.ok) return FAIL
          parts.push(r.value)
          cur = r.pos
        }
        return { ok: true, value: parts, pos: cur }
      }
      case "alt": {
        for (const branch of node.a) {
          const r = this.apply(branch, pos, consumeAll)
          if (r.ok) return r
        }
        return FAIL
      }
      case "rep": {
        const items: unknown[] = [node.maybe ? "maybe" : "rep"]
        let cur = pos
        let count = 0
        while (node.max === null || count < node.max) {
          const r = this.apply(node.a, cur, false)
          if (!r.ok) break
          items.push(r.value)
          cur = r.pos
          count++
        }
        if (count < node.min) {
          this.note(cur)
          return FAIL
        }
        return { ok: true, value: items, pos: cur }
      }
      case "pred": {
        const r = this.apply(node.a, pos, false)
        const matched = r.ok
        if (node.positive ? !matched : matched) return FAIL
        // Zero-width: position unchanged, value nil.
        return { ok: true, value: null, pos }
      }
      case "cap": {
        const r = this.apply(node.a, pos, consumeAll)
        if (!r.ok) return FAIL
        return {
          ok: true,
          value: { [node.name]: flatten(r.value, true) },
          pos: r.pos,
        }
      }
      case "ref":
        return this.applyRule(node.name, pos)
    }
  }
}
