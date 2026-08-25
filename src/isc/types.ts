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

export interface IscRule {
  readonly from: IscItem
  readonly to: IscItem
  readonly constraints: readonly IscConstraint[]
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
