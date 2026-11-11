/**
 * Reader for the parsanol grammar language (PARG) — the text format the
 * canonical ISC grammar (isc.parg) is written in.
 *
 * This is a TypeScript port of the relevant subset of Parsanol::PARG
 * (lexer.rb + parser.rb + compiler.rb's parse_hex), pinned to the
 * constructs the ISC grammar uses:
 *
 *   - the `grammar <name> version "..." { ... }` envelope
 *   - `entry <name>: <rule>` declarations
 *   - rules: `name = expression`, terminated by newline (ABNF/PEG mix:
 *     ordered choice `/`, sequences, `[x]` optional, `n*m` repetition,
 *     `!x`/`&x` lookaheads, `expr as name` captures, string literals,
 *     `%xNN-NN` character ranges, rule references)
 *
 * Anything outside that subset (states, tables, preprocess, render,
 * derive, brace rule bodies, `%i`/`%s` literals, categories) raises a
 * ParseError naming the construct — the reader fails loudly instead of
 * silently misparsing a grammar it does not understand.
 *
 * The AST node kinds mirror the compiled atom graph (see peg.ts for the
 * interpreter and the flattening semantics it reproduces):
 *
 *   { k: "lit",   s }                      literal string
 *   { k: "class", ranges: [lo, hi][] }     single character class
 *   { k: "seq",   a: Node[] }              ordered sequence
 *   { k: "alt",   a: Node[] }              ordered choice (PEG)
 *   { k: "rep",   a, min, max, maybe? }    repetition (max null = open)
 *   { k: "pred",  positive, a }            lookahead, zero-width
 *   { k: "cap",   name, a }                named capture
 *   { k: "ref",   name }                   rule reference
 */

export type PargNode =
  | { k: "lit"; s: string }
  | { k: "class"; ranges: Array<[number, number]> }
  | { k: "seq"; a: PargNode[] }
  | { k: "alt"; a: PargNode[] }
  | { k: "rep"; a: PargNode; min: number; max: number | null; maybe?: boolean }
  | { k: "pred"; positive: boolean; a: PargNode }
  | { k: "cap"; name: string; a: PargNode }
  | { k: "ref"; name: string }

export interface PargGrammar {
  name: string
  version: string
  /** entry name -> root rule name (the ISC grammar declares `entry isc: isc_source`) */
  entries: Record<string, string>
  /** rule name -> AST */
  rules: Record<string, PargNode>
  /** declaration order, for diagnostics */
  order: string[]
}

export class PargParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PargParseError"
  }
}

// ---------------------------------------------------------------------------
// Lexer — token classes mirror Parsanol::PARG::Lexer (comments and
// whitespace dropped, newlines kept as separators).
// ---------------------------------------------------------------------------

interface Token {
  type: "newline" | "str" | "sstr" | "hex" | "num" | "ident" | "punct"
  value: string
  /** offset into the source text, for diagnostics */
  offset: number
}

const HEX_RE = /%x[0-9A-Fa-f]{2,6}(?:-[0-9A-Fa-f]{2,6}|(?:\.[0-9A-Fa-f]{2,6})+)?/y
const STR_RE = /"(?:[^"\\]|\\.)*"/y
const SSTR_RE = /%s"(?:[^"\\]|\\.)*"/y
const NUM_RE = /\d+/y
const IDENT_RE = /[A-Za-z_][A-Za-z0-9_]*/y
const PUNCT_RE = /[=/()[\]{}*!&:,.<-]/y

function lex(text: string): Token[] {
  const tokens: Token[] = []
  let pos = 0
  const n = text.length
  while (pos < n) {
    const c = text[pos]
    if (c === "\n" || (c === "\r" && text[pos + 1] === "\n")) {
      tokens.push({ type: "newline", value: "\n", offset: pos })
      pos += c === "\r" ? 2 : 1
      continue
    }
    if (c === " " || c === "\t") {
      pos++
      continue
    }
    if (c === "#") {
      while (pos < n && text[pos] !== "\n") pos++
      continue
    }
    if (c === "%") {
      if (text.startsWith('%s"', pos)) {
        SSTR_RE.lastIndex = pos
        const m = SSTR_RE.exec(text)
        if (!m || m.index !== pos)
          throw new PargParseError(`unterminated %s"..." literal at offset ${pos}`)
        tokens.push({ type: "sstr", value: m[0].slice(3, -1), offset: pos })
        pos = SSTR_RE.lastIndex
        continue
      }
      if (text.startsWith('%i"', pos)) {
        throw new PargParseError(
          `%i"..." case-insensitive literals are not supported by this reader (offset ${pos})`,
        )
      }
      if (text.startsWith("%p{", pos)) {
        throw new PargParseError(
          `%p{...} category classes are not supported by this reader (offset ${pos})`,
        )
      }
      HEX_RE.lastIndex = pos
      const m = HEX_RE.exec(text)
      if (m && m.index === pos) {
        tokens.push({ type: "hex", value: m[0].slice(2), offset: pos })
        pos = HEX_RE.lastIndex
        continue
      }
      throw new PargParseError(`unexpected %-construct at offset ${pos}`)
    }
    if (c === '"') {
      STR_RE.lastIndex = pos
      const m = STR_RE.exec(text)
      if (!m || m.index !== pos)
        throw new PargParseError(`unterminated string literal at offset ${pos}`)
      tokens.push({ type: "str", value: m[0].slice(1, -1), offset: pos })
      pos = STR_RE.lastIndex
      continue
    }
    if (c !== undefined && c >= "0" && c <= "9") {
      NUM_RE.lastIndex = pos
      const m = NUM_RE.exec(text)
      tokens.push({ type: "num", value: m![0], offset: pos })
      pos = NUM_RE.lastIndex
      continue
    }
    if (c !== undefined && /[A-Za-z_]/.test(c)) {
      IDENT_RE.lastIndex = pos
      const m = IDENT_RE.exec(text)
      tokens.push({ type: "ident", value: m![0], offset: pos })
      pos = IDENT_RE.lastIndex
      continue
    }
    PUNCT_RE.lastIndex = pos
    const m = PUNCT_RE.exec(text)
    if (m && m.index === pos) {
      tokens.push({ type: "punct", value: m[0], offset: pos })
      pos++
      continue
    }
    throw new PargParseError(`unexpected character ${JSON.stringify(c)} at offset ${pos}`)
  }
  return tokens
}

/** Unquote a literal body: \n \t \r are escapes, anything else is itself. */
function unquote(raw: string): string {
  let out = ""
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    if (c !== "\\") {
      out += c
      continue
    }
    const next = raw[++i] ?? ""
    if (next === "n") out += "\n"
    else if (next === "t") out += "\t"
    else if (next === "r") out += "\r"
    else out += next
  }
  return out
}

// ---------------------------------------------------------------------------
// Parser — mirrors Parsanol::PARG::Parser productions for the supported
// subset. Sequences end at a newline (outside `(...)` grouping, which the
// ISC grammar never spans), `/`, `)`, `]` or `}`.
// ---------------------------------------------------------------------------

class PargParser {
  private tokens: Token[]
  private pos = 0
  readonly grammar: PargGrammar = { name: "", version: "", entries: {}, rules: {}, order: [] }

  constructor(text: string) {
    this.tokens = lex(text)
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos]
  }

  private advance(): Token {
    const t = this.tokens[this.pos++]
    if (t === undefined) throw new PargParseError("unexpected end of grammar")
    return t
  }

  private expect(type: Token["type"], value?: string): Token {
    const t = this.advance()
    if (t.type !== type || (value !== undefined && t.value !== value)) {
      const found = `${t.type}:${JSON.stringify(t.value)}`
      throw new PargParseError(
        `expected ${value ? JSON.stringify(value) : type}, got ${found} at offset ${t.offset}`,
      )
    }
    return t
  }

  private skipNewlines(): void {
    while (this.peek()?.type === "newline") this.pos++
  }

  parse(): PargGrammar {
    this.skipNewlines()
    while (this.pos < this.tokens.length) {
      const section = this.advance()
      if (section.type !== "ident") {
        throw new PargParseError(
          `expected a section (grammar/entry), got ${section.type} at offset ${section.offset}`,
        )
      }
      if (section.value === "grammar") this.parseGrammar()
      else if (section.value === "entry") this.parseEntry()
      else {
        throw new PargParseError(
          `unsupported PARG section "${section.value}" at offset ${section.offset} ` +
            `(this reader implements grammar/entry only)`,
        )
      }
      this.skipNewlines()
    }
    if (this.grammar.entries === null) throw new PargParseError("grammar declares no entry")
    return this.grammar
  }

  private parseGrammar(): void {
    this.grammar.name = this.expect("ident").value
    this.expect("ident", "version")
    this.grammar.version = unquote(this.expect("str").value)
    // `edition` is accepted and ignored when present (RS vendored copy
    // carries `edition "v1"`; the canonical ISC grammar omits it).
    if (this.peek()?.type === "ident" && this.peek()!.value === "edition") {
      this.advance()
      const t = this.advance()
      if (t.type !== "str" && t.type !== "num") {
        throw new PargParseError(`expected edition value after "edition" at offset ${t.offset}`)
      }
    }
    this.expect("punct", "{")
    this.skipNewlines()
    while (!(this.peek()?.type === "punct" && this.peek()!.value === "}")) {
      if (this.peek() === undefined) throw new PargParseError("unterminated grammar block")
      if (this.peek()!.type === "ident" && this.peek()!.value === "entry") {
        this.advance()
        this.parseEntry()
        this.skipNewlines()
        continue
      }
      this.parseRule()
      this.skipNewlines()
    }
    this.expect("punct", "}")
  }

  private parseEntry(): void {
    const name = this.expect("ident").value
    this.expect("punct", ":")
    const t = this.expect("ident")
    this.grammar.entries[name] = t.value
  }

  private parseRule(): void {
    const name = this.expect("ident").value
    this.expect("punct", "=")
    if (this.grammar.rules[name] !== undefined) {
      throw new PargParseError(`duplicate rule ${JSON.stringify(name)}`)
    }
    this.grammar.rules[name] = this.parseChoice()
    this.grammar.order.push(name)
  }

  private stopElement(): boolean {
    const t = this.peek()
    if (t === undefined) return true
    if (t.type === "newline") return true
    return (
      t.type === "punct" &&
      (t.value === "/" || t.value === ")" || t.value === "]" || t.value === "}")
    )
  }

  private parseChoice(): PargNode {
    const branches = [this.parseSeq()]
    for (;;) {
      const t = this.peek()
      if (t?.type === "punct" && t.value === "/") {
        this.advance()
        branches.push(this.parseSeq())
      } else break
    }
    const first = branches[0]
    return branches.length === 1 && first !== undefined ? first : { k: "alt", a: branches }
  }

  private parseSeq(): PargNode {
    if (this.stopElement()) {
      const t = this.peek()
      throw new PargParseError(`empty sequence at offset ${t?.offset ?? -1}`)
    }
    const items = [this.parseElement()]
    while (!this.stopElement()) {
      items.push(this.parseElement())
    }
    const head = items[0]
    return items.length === 1 && head !== undefined ? head : { k: "seq", a: items }
  }

  private parseElement(): PargNode {
    const t = this.peek()
    if (t === undefined) throw new PargParseError("unexpected end of input inside sequence")
    if (t.type === "num") {
      this.advance()
      const min = Number(t.value)
      if (this.peek()?.type === "punct" && this.peek()!.value === "*") {
        this.advance()
        const max = this.peek()?.type === "num" ? Number(this.advance().value) : null
        return this.capturePostfix({ k: "rep", a: this.parseRepBody(), min, max })
      }
      return this.capturePostfix({ k: "rep", a: this.parseRepBody(), min, max: min })
    }
    if (t.type === "punct" && t.value === "*") {
      this.advance()
      const max = this.peek()?.type === "num" ? Number(this.advance().value) : null
      return this.capturePostfix({ k: "rep", a: this.parseRepBody(), min: 0, max })
    }
    return this.parsePostfixed()
  }

  /** A repetition's body is a guarded primary; it takes no `as` postfix. */
  private parseRepBody(): PargNode {
    const [sign, node] = this.parseGuardSign()
    if (sign === null) return node
    return { k: "pred", positive: sign, a: node }
  }

  private parseGuardSign(): [boolean | null, PargNode] {
    const t = this.peek()
    if (t?.type === "punct" && (t.value === "!" || t.value === "&")) {
      this.advance()
      return [t.value === "&", this.parsePrimary()]
    }
    return [null, this.parsePrimary()]
  }

  private capturePostfix(node: PargNode): PargNode {
    const t = this.peek()
    if (t?.type === "ident" && t.value === "as") {
      this.advance()
      const name = this.expect("ident").value
      return { k: "cap", name, a: node }
    }
    return node
  }

  private parsePostfixed(): PargNode {
    const [sign, node] = this.parseGuardSign()
    if (sign === null) return this.capturePostfix(node)
    // The capture binds the guard, not the guarded primary (parsanol-ruby#380).
    return this.capturePostfix({ k: "pred", positive: sign, a: node })
  }

  private parsePrimary(): PargNode {
    const t = this.advance()
    switch (t.type) {
      case "str":
        return { k: "lit", s: unquote(t.value) }
      case "sstr":
        return { k: "lit", s: t.value }
      case "hex":
        return this.parseHex(t.value)
      case "punct":
        if (t.value === "(") {
          const node = this.parseChoice()
          this.expect("punct", ")")
          return node
        }
        if (t.value === "[") {
          const node = this.parseChoice()
          this.expect("punct", "]")
          return { k: "rep", a: node, min: 0, max: 1, maybe: true }
        }
        throw new PargParseError(
          `unexpected ${JSON.stringify(t.value)} in expression at offset ${t.offset}`,
        )
      case "ident": {
        if (t.value === "until") {
          throw new PargParseError(`"until" is not supported by this reader (offset ${t.offset})`)
        }
        if (t.value === "alt" || t.value === "state" || t.value === "set" || t.value === "switch") {
          throw new PargParseError(
            `"${t.value}" is not supported by this reader (offset ${t.offset})`,
          )
        }
        return { k: "ref", name: t.value }
      }
      default:
        throw new PargParseError(
          `unexpected token ${t.type}:${JSON.stringify(t.value)} at offset ${t.offset}`,
        )
    }
  }

  /** `%xNN-NN` range, `%xNN.NN` sequence of single-char classes, `%xNN` single. */
  private parseHex(spec: string): PargNode {
    if (spec.includes("-")) {
      const [lo, hi] = spec.split("-")
      if (lo === undefined || hi === undefined) {
        throw new PargParseError(`malformed hex range %x${spec}`)
      }
      return { k: "class", ranges: [[parseInt(lo, 16), parseInt(hi, 16)]] }
    }
    if (spec.includes(".")) {
      const parts = spec.split(".").map((h) => {
        const code = parseInt(h, 16)
        return { k: "class", ranges: [[code, code]] } as PargNode
      })
      const first = parts[0]
      return parts.length === 1 && first !== undefined ? first : { k: "seq", a: parts }
    }
    const code = parseInt(spec, 16)
    return { k: "class", ranges: [[code, code]] }
  }
}

/** Read a PARG text into a grammar table. */
export function parseParg(text: string): PargGrammar {
  return new PargParser(text).parse()
}
