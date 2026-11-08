/**
 * ISC document types — mirror the Ruby document hash shape.
 *
 * These types represent the PARSED ISC document, not the runtime
 * CompiledMap. A converter (iscToCompiledMap) bridges the two.
 */

export interface IscDocument {
  readonly systemCode: string
  readonly metadata: Readonly<Record<string, unknown>>
  readonly tests: readonly IscTest[]
  readonly aliases: ReadonlyArray<{ name: string; value: IscItem }>
  readonly stages: readonly IscStage[]
  readonly dependencies: ReadonlyArray<{ target: string; aliasName?: string }>
  /** ISC-WF-1 W1 — named rulesets declared at map top level. */
  readonly rulesets?: readonly IscRuleset[]
  /** ISC-WF-1 W3 — languages the map serves (declared in the system block). */
  readonly languages?: readonly string[]
}

/** ISC-WF-1 W1 — a named, reusable block of stage items. */
export interface IscRuleset {
  readonly name: string
  readonly body: readonly IscStageItem[]
}

export interface IscTest {
  readonly input: string
  readonly expected: string
  readonly note?: string
}

export interface IscStage {
  readonly name: string
  readonly body: readonly IscStageItem[]
}

export type IscStageItem =
  | { kind: "parallel"; rules: readonly IscRule[] }
  | { kind: "sequence"; rules: readonly IscRule[] }
  | { kind: "bare_rule"; rule: IscRule }
  | { kind: "run"; dependency?: string; stage: string }
  | { kind: "separate"; separator?: IscItem }
  | { kind: "compose" }
  | { kind: "decompose" }
  | { kind: "string_case"; op: string }
  | { kind: "funcall"; name: string; kwargs: Readonly<Record<string, string>> }
  /**
   * ISC-WF-1 W1/W2 — `use <ident>` (or `use <alias>.<ident>`), optionally
   * with an `override { ... }` block. Resolved by expandDocument() at
   * compile time; never reaches the IR.
   */
  | {
      kind: "use"
      name: string
      dependency?: string
      override?: readonly IscRule[]
    }

export interface IscRule {
  readonly from: IscItem
  readonly to: IscItem
  readonly constraints: readonly IscConstraint[]
  /** ISC-WF-1 W3 — languages this rule applies to (`sub a b when kur`). */
  readonly when?: readonly string[]
}

export interface IscConstraint {
  readonly kind: string
  readonly item: IscItem
}

export type IscItem =
  | { type: "string"; value: string }
  | { type: "none" }
  | { type: "primitive"; name: string }
  | { type: "function"; name: string }
  | { type: "alias_ref"; name: string }
  | { type: "capture"; index: number }
  | { type: "capture_group"; inner: IscItem }
  | { type: "concat"; parts: readonly IscItem[] }
  | { type: "set"; items: readonly IscItem[] }
  | { type: "range"; lo: string; hi: string }
  | { type: "maybe"; inner: IscItem }
  | { type: "some"; inner: IscItem }

export class IscParseError extends Error {
  constructor(
    message: string,
    readonly position: number,
    readonly line: number,
    readonly col: number,
  ) {
    super(`ISC parse error at line ${line}:${col}: ${message}`)
    this.name = "IscParseError"
  }
}

/**
 * ISC-WF-1 load error — raised when a map's `use` directives cannot be
 * resolved: unknown ruleset, unresolvable dependency, or an expansion
 * cycle (§3.2, §6.4). Distinct from IscParseError because expansion
 * happens after parsing, on whole documents rather than tokens.
 */
export class IscLoadError extends Error {
  constructor(message: string) {
    super(`ISC load error: ${message}`)
    this.name = "IscLoadError"
  }
}
