/**
 * Domain model for Interscript — TypeScript-native port of the Ruby AST.
 *
 * Design principles (per OCP):
 *   - AST nodes are discriminated unions, not class hierarchies. Adding a
 *     new node kind = adding a new variant + a new executor registration.
 *     Existing executors never need to change.
 *   - Each type maps to exactly one Ruby AST concept (MECE).
 *   - Public types live here so consumers can pattern-match without
 *     depending on internal file layout.
 */

/** Identifier of a transliteration system, e.g. "bgnpcgn-ukr-Cyrl-Latn-2019". */
export type SystemCode = string

/** Metadata about a transliteration map. */
export interface MapInfo {
  systemCode: SystemCode
  displayName?: string
  authority?: string
  sourceScript?: string
  destinationScript?: string
}

/** Result of a detect() call — one candidate system with its distance. */
export interface DetectionResult {
  mapName: SystemCode
  distance: number
}

/** Options for detect(). */
export interface DetectOptions {
  mapPattern?: string
}

/**
 * JSON IR shape emitted by `Interscript::Compiler::JsonIR` (Ruby).
 *
 * `aliases` and `functions` are serialised as plain JSON objects (not
 * Maps) because JSON has no Map type. The runtime reconstructs them
 * into Maps at load time via `normaliseMap()`.
 */
export interface CompiledMapJson {
  readonly schemaVersion: 1
  readonly systemCode: SystemCode
  readonly dependencies: readonly SystemCode[]
  readonly metadata?: Readonly<Record<string, unknown>>
  readonly stages: readonly Stage[]
  readonly aliases: Readonly<Record<string, Item>>
  readonly functions: Readonly<Record<string, unknown>>
}

/**
 * Runtime form of a compiled map.
 *
 * Public consumers should treat this as opaque; the loader produces it
 * from `CompiledMapJson` via `normaliseMap()`.
 */
export interface CompiledMap {
  readonly schemaVersion: 1
  readonly systemCode: SystemCode
  readonly dependencies: readonly SystemCode[]
  readonly metadata?: Readonly<Record<string, unknown>>
  readonly stages: readonly Stage[]
  readonly aliases: ReadonlyMap<string, Item>
  readonly functions: ReadonlyMap<string, FunctionDef>
}

/** Mutable builder form — produced by `normaliseMap`, frozen before use. */
export type CompiledMapBuilder = {
  -readonly [K in keyof CompiledMap]: CompiledMap[K]
}

export interface FunctionDef {
  readonly name: string
  /** Native function reference. JSON IR serialises names; runtime resolves. */
  readonly impl?: (input: string, opts?: Record<string, unknown>) => string
}

/** A stage is a sequence of rules applied in order to a string. */
export interface Stage {
  readonly kind: "stage"
  readonly name: string
  readonly rules: readonly Rule[]
}

/**
 * Discriminated union of all rule kinds.
 * Adding a new rule kind = adding a variant here + an executor.
 */
export type Rule = SubRule | RunRule | FuncallRule | ParallelRule | SequentialRule

export interface SubRule {
  readonly kind: "sub"
  readonly from?: Item
  readonly to?: Item | FuncallInline
  readonly before?: Item
  readonly after?: Item
  readonly notBefore?: Item
  readonly notAfter?: Item
  readonly priority?: number
}

export interface RunRule {
  readonly kind: "run"
  readonly stage: string
  readonly docName?: string
}

export interface FuncallRule {
  readonly kind: "funcall"
  readonly name: string
  readonly kwargs?: Readonly<Record<string, unknown>>
}

/** Parallel rule group — all subs inside apply in a single pass. */
export interface ParallelRule {
  readonly kind: "parallel"
  readonly rules: readonly Rule[]
}

/** Sequential rule group — applies rules in order, like a sub-stage. */
export interface SequentialRule {
  readonly kind: "sequential"
  readonly rules: readonly Rule[]
}

/** Inline function call used as a SubRule's `to` (e.g. `:upcase`). */
export interface FuncallInline {
  readonly kind: "funcall_inline"
  readonly name: string
}

/** Items are the building blocks of pattern/replace expressions. */
export type Item =
  | StringItem
  | CaptureGroupItem
  | CaptureRefItem
  | AliasItem
  | AnyItem
  | AnyCharClassItem
  | GroupItem
  | RepeatItem
  | StageItem

export interface StringItem {
  readonly kind: "string"
  readonly value: string
}

/** A capture group `(...)` — defines a new capture. */
export interface CaptureGroupItem {
  readonly kind: "capture_group"
  readonly data: Item
}

/** A back-reference to a previously-defined capture group (`\1`). */
export interface CaptureRefItem {
  readonly kind: "capture_ref"
  readonly id: number
}

export interface AliasItem {
  readonly kind: "alias"
  readonly name: string
  readonly map?: string
}

export interface AnyItem {
  readonly kind: "any"
  readonly of: readonly Item[]
}

/**
 * Character class — `[a-z]`, `[abc]`, etc. Mirrors Ruby's Any node when
 * constructed from a String or Range payload. Kept distinct from
 * `AnyItem` because Ruby's interpreter compiles them differently:
 * `Any(["a","b"])` → `(?:a|b)`, `Any("ab")` → `[ab]`, `Any("a".."z")` → `[a-z]`.
 */
export interface AnyCharClassItem {
  readonly kind: "any_char_class"
  readonly range?: readonly [string, string]
  readonly chars?: readonly string[]
}

export interface GroupItem {
  readonly kind: "group"
  readonly items: readonly Item[]
}

export interface RepeatItem {
  readonly kind: "repeat"
  readonly item: Item
  readonly min: number
  readonly max: number | null
}

export interface StageItem {
  readonly kind: "stage_ref"
  readonly name: string
}
