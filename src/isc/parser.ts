/**
 * ISC parser — recursive descent parser for ISC format.
 *
 * Parses .isc source text into an IscDocument. No external dependencies.
 * Each construct has its own parse method (OCP: new construct = new method).
 *
 * The grammar mirrors the Ruby Parslet grammar in interscript-ruby.
 *
 *   const doc = parseIsc(source, "map.isc")
 *   // doc.systemCode, doc.metadata, doc.tests, doc.stages, ...
 */

import type {
  IscDocument,
  IscItem,
  IscRule,
  IscStage,
  IscStageItem,
  IscTest,
  IscConstraint,
} from "./types.js"
import { IscParseError } from "./types.js"

const PRIMITIVES = new Set([
  "boundary", "line_start", "line_end", "word_boundary",
  "space", "non_boundary",
])

const FUNCTIONS = new Set([
  "upcase", "downcase", "title_case", "reverse", "strip", "swapcase",
])

const CONSTRAINTS = new Set(["before", "after", "not_before", "not_after"])

export function parseIsc(source: string, filename?: string): IscDocument {
  return new Parser(source, filename).parse()
}

class Parser {
  private src: string
  private pos = 0
  private filename: string | undefined

  constructor(src: string, filename?: string) {
    this.src = src
    this.filename = filename
  }

  parse(): IscDocument {
    this.skipWs()
    this.expect("system")
    this.skipWs()
    const systemCode = this.parseQuotedString()
    this.skipWs()
    this.expect("{")
    const body = this.parseBlockItems()
    this.skipWs()
    this.expect("}")
    this.skipWs()

    let metadata: Record<string, unknown> = {}
    let tests: IscTest[] = []
    let aliases: Array<{ name: string; value: IscItem }> = []
    let stages: IscStage[] = []
    let dependencies: Array<{ target: string; aliasName?: string }> = []

    for (const item of body) {
      if (item.metadata) metadata = { ...metadata, ...item.metadata }
      else if (item.tests) tests = item.tests
      else if (item.aliases) aliases = item.aliases
      else if (item.stage) stages.push(item.stage)
      else if (item.dependency) dependencies.push(item.dependency)
    }

    return { systemCode, metadata, tests, aliases, stages, dependencies }
  }

  // -- Block items --

  private parseBlockItems(): ParsedBlockItem[] {
    const items: ParsedBlockItem[] = []
    for (;;) {
      this.skipWs()
      if (this.peek() === "}" || this.pos >= this.src.length) break

      const keyword = this.peekWord()
      if (keyword === "metadata") items.push(this.parseMetadata())
      else if (keyword === "tests") items.push(this.parseTests())
      else if (keyword === "aliases") items.push(this.parseAliases())
      else if (keyword === "stage") items.push(this.parseStage())
      else if (keyword === "dependency") items.push(this.parseDependency())
      else this.error(`Unexpected keyword: ${keyword}`)
    }
    return items
  }

  // -- Metadata --

  private parseMetadata(): ParsedBlockItem {
    this.expect("metadata")
    this.skipWs()
    this.expect("{")
    const metadata: Record<string, unknown> = {}

    for (;;) {
      this.skipWs()
      if (this.peek() === "}") break

      // Check for description block
      if (this.peekWord() === "description") {
        this.consume("description")
        this.skipInlineWs()
        if (this.peek() === "{") {
          this.expect("{")
          const text = this.parseRawText()
          this.expect("}")
          metadata.description = text
        } else if (this.peek() === '"') {
          metadata.description = this.parseQuotedString()
        } else {
          metadata.description = this.parseToNewline().trim()
        }
        continue
      }

      // Check for notes block
      if (this.peekWord() === "notes") {
        this.consume("notes")
        this.skipInlineWs()
        if (this.peek() === "{") {
          this.expect("{")
          // Detect form: if first non-ws token is `note`, use note-list form.
          // Otherwise, treat block body as raw free-text.
          const saved = this.pos
          this.skipWs()
          const isNoteList = this.peekWord() === "note"
          this.pos = saved

          if (isNoteList) {
            const notes: string[] = []
            for (;;) {
              this.skipWs()
              if (this.peek() === "}") break
              this.expect("note")
              this.skipWs()
              notes.push(this.parseQuotedString())
            }
            this.expect("}")
            metadata.notes = notes
          } else {
            const text = this.parseRawText()
            this.expect("}")
            metadata.notes = text
          }
        }
        continue
      }

      // Generic field: key value
      const key = this.parseIdentifier()
      this.skipInlineWs()
      if (this.peek() === "\n" || this.peek() === "}") {
        metadata[key] = ""
        continue
      }
      if (this.peek() === "{") {
        this.expect("{")
        const blockText = this.parseRawText()
        this.expect("}")
        metadata[key] = blockText
      } else if (this.peek() === '"') {
        metadata[key] = this.parseQuotedString()
      } else {
        metadata[key] = this.parseToNewline().trim()
      }
    }
    this.expect("}")
    return { metadata }
  }

  // -- Tests --

  private parseTests(): ParsedBlockItem {
    this.expect("tests")
    this.skipWs()
    this.expect("{")
    const tests: IscTest[] = []

    for (;;) {
      this.skipWs()
      if (this.peek() === "}") break
      if (this.peek() === "#") { this.skipLine(); continue }

      const input = this.parseStringLiteral()
      this.skipWs()
      this.expect("->")
      this.skipWs()
      const expected = this.parseStringLiteral()
      this.skipWs()

      if (this.peekWord() === "note") {
        this.consume("note")
        this.skipWs()
        const note = this.parseStringLiteral()
        tests.push({ input, expected, note })
      } else {
        tests.push({ input, expected })
      }
    }
    this.expect("}")
    return { tests }
  }

  // -- Aliases --

  private parseAliases(): ParsedBlockItem {
    this.expect("aliases")
    this.skipWs()
    this.expect("{")
    const aliases: Array<{ name: string; value: IscItem }> = []

    for (;;) {
      this.skipWs()
      if (this.peek() === "}") break
      if (this.peek() === "#") { this.skipLine(); continue }

      const name = this.parseIdentifier()
      this.skipWs()
      this.expect("=")
      this.skipWs()
      const value = this.parseItem()
      aliases.push({ name, value })
    }
    this.expect("}")
    return { aliases }
  }

  // -- Stage --

  private parseStage(): ParsedBlockItem {
    this.expect("stage")
    this.skipWs()
    const name = this.parseIdentifier()
    this.skipWs()
    this.expect("{")
    const body: IscStageItem[] = []

    for (;;) {
      this.skipWs()
      if (this.peek() === "}") break
      if (this.peek() === "#") { this.skipLine(); continue }

      const keyword = this.peekWord()
      if (keyword === "parallel" || keyword === "sequence") {
        this.consume(keyword)
        this.skipWs()
        this.expect("{")
        const rules: IscRule[] = []
        for (;;) {
          this.skipWs()
          if (this.peek() === "}") break
          if (this.peek() === "#") { this.skipLine(); continue }
          if (this.peekWord() === "sub") {
            rules.push(this.parseRule())
          } else {
            // Ruby Parslet silently drops unrecognized tokens in rule blocks.
            this.skipLine()
          }
        }
        this.expect("}")
        body.push({ kind: keyword, rules } as IscStageItem)
      } else if (keyword === "run") {
        this.consume("run")
        this.skipWs()
        let dep: string | undefined
        let stageName: string
        if (this.peekWord() === "map") {
          this.consume("map")
          this.expect(".")
          dep = this.parseIdentifier()
          this.expect(".")
          this.expect("stage")
          this.expect(".")
          stageName = this.parseIdentifier()
        } else if (this.peekWord() === "stage") {
          this.consume("stage")
          this.expect(".")
          stageName = this.parseIdentifier()
        } else {
          this.error("Expected map. or stage. after run")
        }
        body.push(dep
          ? { kind: "run", dependency: dep, stage: stageName }
          : { kind: "run", stage: stageName })
      } else if (keyword === "separate") {
        this.consume("separate")
        this.skipWs()
        if (this.peekWord() === "separator") {
          this.consume("separator")
          this.skipWs()
          const separator = this.parseItemAtom()
          body.push({ kind: "separate", separator })
        } else {
          body.push({ kind: "separate" })
        }
      } else if (keyword === "compose") {
        this.consume(keyword)
        body.push({ kind: "compose" })
      } else if (keyword === "decompose") {
        this.consume(keyword)
        body.push({ kind: "decompose" })
      } else if (keyword === "rababa") {
        this.consume("rababa")
        this.skipInlineWs()
        const kwargs: Record<string, string> = {}
        // Parse `name: "value"` pairs separated by commas/whitespace.
        while (this.peek() !== "}" && this.peek() !== "" && this.peek() !== "\n") {
          const argName = this.parseIdentifier()
          if (!argName) break
          this.skipInlineWs()
          this.expect(":")
          this.skipInlineWs()
          const argVal = this.parseStringLiteral()
          kwargs[argName] = argVal
          this.skipInlineWs()
          if (this.peek() === ",") this.pos++
          this.skipInlineWs()
        }
        body.push({ kind: "funcall", name: "rababa", kwargs })
      } else if (FUNCTIONS.has(keyword)) {
        this.consume(keyword)
        body.push({ kind: "string_case", op: keyword })
      } else if (keyword === "sub") {
        const rule = this.parseRule()
        body.push({ kind: "bare_rule", rule })
      } else {
        // Ruby Parslet silently drops unrecognized tokens in stage body.
        // Skip to end of line for parity.
        this.skipLine()
      }
    }
    this.expect("}")
    return { stage: { name, body } }
  }

  // -- Rules --

  private parseRule(): IscRule {
    this.expect("sub")
    this.skipWs()

    // Block form: sub { from ... to ... }
    if (this.peek() === "{") {
      this.expect("{")
      let from: IscItem = { type: "none" }
      let to: IscItem = { type: "none" }
      const constraints: IscConstraint[] = []

      for (;;) {
        this.skipWs()
        if (this.peek() === "}") break

        const word = this.peekWord()
        if (word === "from") {
          this.consume("from")
          this.skipWs()
          from = this.parseItem()
        } else if (word === "to") {
          this.consume("to")
          this.skipWs()
          to = this.parseItem()
        } else if (CONSTRAINTS.has(word)) {
          this.consume(word)
          this.skipWs()
          constraints.push({ kind: word, item: this.parseItem() })
        } else {
          this.error(`Unexpected keyword in sub block: ${word}`)
        }
      }
      this.expect("}")
      return { from, to, constraints }
    }

    // Compact form: sub <from> <to> <constraints>
    const from = this.parseItemAtom()
    this.skipWs()
    const to = this.parseItemAtom()
    const constraints: IscConstraint[] = []

    for (;;) {
      this.skipWs()
      const word = this.peekWord()
      if (!CONSTRAINTS.has(word)) break
      this.consume(word)
      this.skipWs()
      constraints.push({ kind: word, item: this.parseItemAtom() })
    }

    return { from, to, constraints }
  }

  // -- Items --

  private parseItem(): IscItem {
    const first = this.parseItemAtom()
    const parts: IscItem[] = [first]

    for (;;) {
      this.skipInlineWs()
      if (this.peek() === "+") {
        this.pos++
        this.skipInlineWs()
        parts.push(this.parseItemAtom())
      } else if (this.isItemAtomStart() && !this.isKeyword()) {
        parts.push(this.parseItemAtom())
      } else {
        break
      }
    }

    if (parts.length === 1) return parts[0]!
    return { type: "concat", parts }
  }

  private parseItemAtom(): IscItem {
    const c = this.peek()

    if (c === '"' || c === "'") return { type: "string", value: this.parseStringLiteral() }

    const word = this.peekWord()
    if (!word) this.error("Expected item atom")

    if (word === "none") { this.consume("none"); return { type: "none" } }
    if (word === "any_character") { this.consume("any_character"); return { type: "function", name: "any_character" } }

    if (word === "any") {
      this.consume("any")
      this.expect("(")
      this.skipWs()
      const inner = this.peek()
      // any("...".."...") or any('...'..'...') — range from string literals
      if (inner === '"' || inner === "'") {
        const lo = this.parseStringLiteral()
        this.skipWs()
        // Check for range: "lo".."hi"
        if (this.src.startsWith("..", this.pos)) {
          this.pos += 2
          this.skipWs()
          const hi = this.parseStringLiteral()
          this.skipWs()
          this.expect(")")
          return { type: "range", lo, hi }
        }
        this.expect(")")
        // any("abc") — split into per-char string items
        return { type: "set", items: [...lo].map((c) => ({ type: "string", value: c }) as IscItem) }
      }
      if (inner === "[") {
        this.expect("[")
        const items: IscItem[] = []
        for (;;) {
          this.skipWs()
          if (this.peek() === "]") break
          items.push(this.parseItem())
          this.skipWs()
          if (this.peek() === ",") this.pos++
        }
        this.expect("]")
        this.skipWs()
        this.expect(")")
        return { type: "set", items }
      }
      // any(item), any(item + item), any(alias_name), any(range_start..range_end)
      const item = this.parseItem()
      this.skipWs()
      this.expect(")")
      return { type: "set", items: [item] }
    }

    if (word === "capture") {
      this.consume("capture")
      this.expect("(")
      this.skipWs()
      const inner = this.parseItem()
      this.skipWs()
      this.expect(")")
      return { type: "capture_group", inner }
    }

    if (word === "maybe") {
      this.consume("maybe")
      this.expect("(")
      this.skipWs()
      const inner = this.parseItem()
      this.skipWs()
      this.expect(")")
      return { type: "maybe", inner }
    }

    if (word === "some") {
      this.consume("some")
      this.expect("(")
      this.skipWs()
      const inner = this.parseItem()
      this.skipWs()
      this.expect(")")
      return { type: "some", inner }
    }

    if (word === "ref") {
      this.consume("ref")
      this.expect("(")
      this.skipWs()
      const num = this.parseNumber()
      this.skipWs()
      this.expect(")")
      return { type: "capture", index: num }
    }

    if (PRIMITIVES.has(word)) {
      this.consume(word)
      return { type: "primitive", name: word }
    }

    if (FUNCTIONS.has(word)) {
      this.consume(word)
      return { type: "function", name: word }
    }

    // Alias reference
    this.consume(word)
    return { type: "alias_ref", name: word }
  }

  // -- Dependency --

  private parseDependency(): ParsedBlockItem {
    this.expect("dependency")
    this.skipWs()
    const target = this.parseQuotedString()
    this.skipInlineWs()
    if (this.peekWord() === "as") {
      this.consume("as")
      this.skipWs()
      const aliasName = this.parseIdentifier()
      return { dependency: { target, aliasName } }
    }
    return { dependency: { target } }
  }

  // -- Primitives --

  private parseStringLiteral(): string {
    const c = this.peek()
    if (c === '"') return this.parseQuotedString()
    if (c === "'") return this.parseSingleQuotedString()
    this.error(`Expected string but got "${this.src.slice(this.pos, this.pos + 20)}"`)
  }

  private parseQuotedString(): string {
    this.expect('"')
    let result = ""
    while (this.pos < this.src.length) {
      const c = this.charAt(this.pos++)
      if (c === '"') return result
      if (c === "\\") {
        const next = this.charAt(this.pos++)
        if (next === "n") result += "\n"
        else if (next === "t") result += "\t"
        else if (next === "r") result += "\r"
        else if (next === '"') result += '"'
        else if (next === "\\") result += "\\"
        else if (next === "u") {
          const hex = this.src.slice(this.pos, this.pos + 4)
          this.pos += 4
          result += String.fromCharCode(parseInt(hex, 16))
        } else if (next === "{") result += "{"
        else if (next === "}") result += "}"
        else result += next
      } else {
        result += c
      }
    }
    this.error("Unterminated string")
  }

  private parseSingleQuotedString(): string {
    this.expect("'")
    let result = ""
    while (this.pos < this.src.length && this.charAt(this.pos) !== "'") {
      result += this.charAt(this.pos++)
    }
    this.expect("'")
    return result
  }

  private parseRawText(): string {
    let result = ""
    let depth = 0
    while (this.pos < this.src.length) {
      const c = this.charAt(this.pos)
      if (c === "\\") {
        const next = this.charAt(this.pos + 1)
        if (next === "{") {
          result += "{"
          this.pos += 2
          continue
        }
        if (next === "}") {
          result += "}"
          this.pos += 2
          continue
        }
      }
      if (c === "}" && depth === 0) break
      if (c === "{") depth++
      if (c === "}") depth--
      result += c
      this.pos++
    }
    return result.trim()
  }

  private parseIdentifier(): string {
    this.skipWs()
    const start = this.pos
    while (this.pos < this.src.length && /[\w-]/.test(this.charAt(this.pos))) {
      this.pos++
    }
    if (this.pos === start) this.error("Expected identifier")
    return this.src.slice(start, this.pos)
  }

  private parseNumber(): number {
    const start = this.pos
    while (this.pos < this.src.length && /\d/.test(this.charAt(this.pos))) {
      this.pos++
    }
    return parseInt(this.src.slice(start, this.pos), 10)
  }

  private parseToNewline(): string {
    const start = this.pos
    while (this.pos < this.src.length && this.charAt(this.pos) !== "\n") {
      this.pos++
    }
    return this.src.slice(start, this.pos)
  }

  // -- Helpers --

  private charAt(i: number): string {
    return this.src[i] ?? ""
  }

  private peek(): string {
    return this.charAt(this.pos)
  }

  private peekWord(): string {
    const start = this.pos
    while (this.pos < this.src.length && /[\w_]/.test(this.charAt(this.pos))) {
      this.pos++
    }
    const word = this.src.slice(start, this.pos)
    this.pos = start
    return word
  }

  private expect(s: string): void {
    this.skipWs()
    if (!this.src.startsWith(s, this.pos)) {
      this.error(`Expected "${s}" but got "${this.src.slice(this.pos, this.pos + 20)}"`)
    }
    this.pos += s.length
  }

  private consume(word: string): void {
    if (!this.src.startsWith(word, this.pos)) {
      this.error(`Expected "${word}"`)
    }
    this.pos += word.length
  }

  private skipWs(): void {
    while (this.pos < this.src.length) {
      const c = this.charAt(this.pos)
      if (/\s/.test(c)) { this.pos++; continue }
      if (c === "#") { this.skipLine(); continue }
      break
    }
  }

  private skipInlineWs(): void {
    while (this.pos < this.src.length && /[ \t]/.test(this.charAt(this.pos))) {
      this.pos++
    }
  }

  private skipLine(): void {
    while (this.pos < this.src.length && this.charAt(this.pos) !== "\n") {
      this.pos++
    }
    if (this.pos < this.src.length) this.pos++
  }

  private skipToNewline(): void {
    while (this.pos < this.src.length && this.charAt(this.pos) !== "\n") {
      this.pos++
    }
  }

  private isItemAtomStart(): boolean {
    const c = this.peek()
    return c === '"' || c === "'" || /[\w]/.test(c)
  }

  private isKeyword(): boolean {
    const word = this.peekWord()
    return ["to", "from", "before", "after", "not_before", "not_after", "}", "note"].includes(word)
  }

  private error(msg: string): never {
    const line = this.src.slice(0, this.pos).split("\n").length
    const col = this.pos - this.src.lastIndexOf("\n", this.pos)
    const fullMsg = this.filename ? `${this.filename}: ${msg}` : msg
    throw new IscParseError(fullMsg, this.pos, line, col)
  }
}

interface ParsedBlockItem {
  metadata?: Record<string, unknown>
  tests?: IscTest[]
  aliases?: Array<{ name: string; value: IscItem }>
  stage?: IscStage
  dependency?: { target: string; aliasName?: string }
}
