/**
 * Converts an IscDocument (parsed from .isc source) to a CompiledMapJson
 * (the runtime representation consumed by the existing TS runtime).
 *
 * This bridges the ISC parser output to the existing runtime without
 * modifying any runtime code (OCP).
 *
 * ISC-WF-1 (docs/isc-wf-1.md):
 *   - W1/W2 (rulesets, use+override) resolve here at compile time via
 *     expandDocument(). The emitted IR stays FLAT — expanded rules only,
 *     no ruleset or use nodes survive into interscript.maps.ir.v1.
 *   - The IR gains exactly two additive fields: optional document-level
 *     `languages: string[]` (W3 declaration) and optional rule-level
 *     `when: string[]` (W3 guards). Maps using none of the constructs
 *     serialize byte-identically to the pre-WF-1 format (additivity, §1).
 *   - W3 guard semantics (inertness, guard-applicable-wins precedence)
 *     are RUNTIME concerns — see runtime/executor.ts.
 */

import type { IscDocument, IscItem, IscRule, IscStageItem } from "./types.js"
import { IscLoadError } from "./types.js"
import { expandDocument, type DependencyDocResolver } from "./expand.js"
import type {
  AliasItem,
  AnyCharClassItem,
  AnyItem,
  CaptureGroupItem,
  CaptureRefItem,
  CompiledMapJson,
  FuncallInline,
  FuncallRule,
  GroupItem,
  Item,
  ParallelRule,
  RepeatItem,
  Rule,
  RunRule,
  SequentialRule,
  Stage,
  StringItem,
  SubRule,
} from "../types.js"

export interface IscToCompiledMapOptions {
  /**
   * Resolver for dependency documents, needed when the map (or one of
   * its dependencies) expands a ruleset across a dependency boundary
   * (`use <alias>.<ruleset>`). Declared dependencies only.
   */
  readonly resolveDependency?: DependencyDocResolver
}

export function iscToCompiledMap(
  doc: IscDocument,
  opts: IscToCompiledMapOptions = {},
): CompiledMapJson {
  // W1/W2: resolve ruleset uses before converting. A no-op for maps
  // without `use` directives (legacy corpus — additivity preserved).
  const expanded = expandDocument(
    doc,
    opts.resolveDependency ? { resolveDependency: opts.resolveDependency } : {},
  )

  const aliases: Record<string, Item> = {}
  for (const a of expanded.aliases) {
    aliases[a.name] = convertItem(a.value)
  }
  // Build alias → target system code map for run-rule resolution.
  const depAliases = new Map<string, string>()
  for (const d of expanded.dependencies) {
    if (d.aliasName) depAliases.set(d.aliasName, d.target)
  }
  const resolveDep = (name: string): string => depAliases.get(name) ?? name
  const stages = expanded.stages.map((s) => convertStage(s, resolveDep))

  const base = {
    schemaVersion: 1 as const,
    systemCode: expanded.systemCode,
    dependencies: expanded.dependencies.map((d) => d.target),
    // IR WF-1 extension: languages declared by the map (absent when the
    // map declares none, preserving the legacy JSON shape byte-for-byte).
    ...(expanded.languages && expanded.languages.length > 0
      ? { languages: [...expanded.languages] }
      : {}),
  }

  if (Object.keys(expanded.metadata).length === 0) {
    return {
      ...base,
      stages,
      aliases,
      functions: {},
    }
  }
  return {
    ...base,
    metadata: expanded.metadata,
    stages,
    aliases,
    functions: {},
  }
}

type DepResolver = (name: string) => string

function convertStage(
  stage: { name: string; body: readonly IscStageItem[] },
  resolveDep: DepResolver,
): Stage {
  return {
    kind: "stage",
    name: stage.name,
    rules: stage.body.map((item) => convertStageItem(item, resolveDep)),
  }
}

function convertStageItem(item: IscStageItem, resolveDep: DepResolver): Rule {
  switch (item.kind) {
    case "use":
      // Unreachable: expandDocument() resolves every `use` before
      // conversion — the IR stays flat (no ruleset/use nodes).
      throw new IscLoadError(
        `unexpanded use "${item.dependency ? `${item.dependency}.` : ""}${item.name}" reached the converter`,
      )
    case "parallel": {
      // Post-expansion, block rule lists are rules only (WO18 G5: `use`
      // rows flattened during expandDocument()).
      const rules = item.rules as readonly IscRule[]
      const r: ParallelRule = { kind: "parallel", rules: rules.map(convertRule) }
      return r
    }
    case "sequence": {
      const rules = item.rules as readonly IscRule[]
      const r: SequentialRule = { kind: "sequential", rules: rules.map(convertRule) }
      return r
    }
    case "bare_rule":
      return convertRule(item.rule)
    case "run": {
      const r: RunRule = item.dependency
        ? { kind: "run", stage: item.stage, docName: resolveDep(item.dependency) }
        : { kind: "run", stage: item.stage }
      return r
    }
    case "separate": {
      if (item.separator && item.separator.type === "string") {
        const r: FuncallRule = {
          kind: "funcall",
          name: "separate",
          kwargs: { separator: item.separator.value },
        }
        return r
      }
      const r: FuncallRule = { kind: "funcall", name: "separate" }
      return r
    }
    case "compose": {
      const r: FuncallRule = { kind: "funcall", name: "compose" }
      return r
    }
    case "decompose": {
      const r: FuncallRule = { kind: "funcall", name: "decompose" }
      return r
    }
    case "string_case": {
      const r: FuncallRule = { kind: "funcall", name: item.op }
      return r
    }
    case "funcall": {
      const r: FuncallRule = { kind: "funcall", name: item.name, kwargs: item.kwargs }
      return r
    }
  }
}

function convertRule(rule: IscRule): SubRule {
  const before = findConstraint(rule, "before")
  const after = findConstraint(rule, "after")
  const notBefore = findConstraint(rule, "not_before")
  const notAfter = findConstraint(rule, "not_after")

  // `to` may be a function (upcase/downcase/title_case/etc.) — represented
  // as FuncallInline rather than an Item.
  const toItem = rule.to
  const to: Item | FuncallInline =
    toItem.type === "function" ? { kind: "funcall_inline", name: toItem.name } : convertItem(toItem)

  const r: SubRule = {
    kind: "sub",
    from: convertItem(rule.from),
    to,
    ...(before !== undefined ? { before } : {}),
    ...(after !== undefined ? { after } : {}),
    ...(notBefore !== undefined ? { notBefore } : {}),
    ...(notAfter !== undefined ? { notAfter } : {}),
    // IR WF-1 extension: language guard (absent on unguarded rules,
    // preserving the legacy JSON shape).
    ...(rule.when && rule.when.length > 0 ? { when: [...rule.when] } : {}),
  }
  return r
}

function findConstraint(rule: IscRule, kind: string): Item | undefined {
  const c = rule.constraints.find((x) => x.kind === kind)
  return c ? convertItem(c.item) : undefined
}

function convertItem(item: IscItem): Item {
  switch (item.type) {
    case "string": {
      const r: StringItem = { kind: "string", value: item.value }
      return r
    }
    case "none": {
      const r: StringItem = { kind: "string", value: "" }
      return r
    }
    case "primitive": {
      const r: AliasItem = { kind: "alias", name: item.name }
      return r
    }
    case "function": {
      // Functions in non-`to` positions are unexpected — fall back to alias
      // lookup so a clear error surfaces at runtime.
      const r: AliasItem = { kind: "alias", name: item.name }
      return r
    }
    case "alias_ref": {
      const r: AliasItem = { kind: "alias", name: item.name }
      return r
    }
    case "capture": {
      const r: CaptureRefItem = { kind: "capture_ref", id: item.index }
      return r
    }
    case "capture_group": {
      const r: CaptureGroupItem = { kind: "capture_group", data: convertItem(item.inner) }
      return r
    }
    case "concat": {
      const parts = item.parts.map(convertItem)
      if (parts.length === 1) return parts[0]!
      const r: GroupItem = { kind: "group", items: parts }
      return r
    }
    case "set": {
      const r: AnyItem = { kind: "any", of: item.items.map(convertItem) }
      return r
    }
    case "range": {
      const r: AnyCharClassItem = { kind: "any_char_class", range: [item.lo, item.hi] }
      return r
    }
    case "maybe": {
      const r: RepeatItem = { kind: "repeat", item: convertItem(item.inner), min: 0, max: 1 }
      return r
    }
    case "some": {
      const r: RepeatItem = { kind: "repeat", item: convertItem(item.inner), min: 1, max: null }
      return r
    }
  }
}
