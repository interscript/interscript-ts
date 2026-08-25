/**
 * Converts an IscDocument (parsed from .isc source) to a CompiledMapJson
 * (the runtime representation consumed by the existing TS runtime).
 *
 * This bridges the ISC parser output to the existing runtime without
 * modifying any runtime code (OCP).
 */

import type { IscDocument, IscItem, IscRule, IscStageItem } from "./types.js"
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

export function iscToCompiledMap(doc: IscDocument): CompiledMapJson {
  const aliases: Record<string, Item> = {}
  for (const a of doc.aliases) {
    aliases[a.name] = convertItem(a.value)
  }
  // Build alias → target system code map for run-rule resolution.
  const depAliases = new Map<string, string>()
  for (const d of doc.dependencies) {
    if (d.aliasName) depAliases.set(d.aliasName, d.target)
  }
  const resolveDep = (name: string): string => depAliases.get(name) ?? name
  const stages = doc.stages.map((s) => convertStage(s, resolveDep))

  if (Object.keys(doc.metadata).length === 0) {
    return {
      schemaVersion: 1,
      systemCode: doc.systemCode,
      dependencies: doc.dependencies.map((d) => d.target),
      stages,
      aliases,
      functions: {},
    }
  }
  return {
    schemaVersion: 1,
    systemCode: doc.systemCode,
    dependencies: doc.dependencies.map((d) => d.target),
    metadata: doc.metadata,
    stages,
    aliases,
    functions: {},
  }
}

type DepResolver = (name: string) => string

function convertStage(stage: { name: string; body: readonly IscStageItem[] }, resolveDep: DepResolver): Stage {
  return {
    kind: "stage",
    name: stage.name,
    rules: stage.body.map((item) => convertStageItem(item, resolveDep)),
  }
}

function convertStageItem(item: IscStageItem, resolveDep: DepResolver): Rule {
  switch (item.kind) {
    case "parallel": {
      const r: ParallelRule = { kind: "parallel", rules: item.rules.map(convertRule) }
      return r
    }
    case "sequence": {
      const r: SequentialRule = { kind: "sequential", rules: item.rules.map(convertRule) }
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
        const r: FuncallRule = { kind: "funcall", name: "separate", kwargs: { separator: item.separator.value } }
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
  const to: Item | FuncallInline = toItem.type === "function"
    ? { kind: "funcall_inline", name: toItem.name }
    : convertItem(toItem)

  const r: SubRule = {
    kind: "sub",
    from: convertItem(rule.from),
    to,
    ...(before !== undefined ? { before } : {}),
    ...(after !== undefined ? { after } : {}),
    ...(notBefore !== undefined ? { notBefore } : {}),
    ...(notAfter !== undefined ? { notAfter } : {}),
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
