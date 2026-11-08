/**
 * ISC-WF-1 W1/W2 — ruleset expansion (§3) and use-with-override merge (§4).
 *
 * Expansion happens at COMPILE time: `expandDocument()` rewrites a parsed
 * document so that every `use` directive is replaced by the referenced
 * ruleset's items at its position (a macro expansion, not a sub-run).
 * The compiled IR stays flat — expanded rules only, no ruleset nodes.
 *
 * Merge semantics (§4.2), at each expansion site:
 *   1. A rule of the expansion is REPLACED if an override row exists with
 *      the same from under byte-exact equality (no normalization). If
 *      several rules share that from, ALL are replaced.
 *   2. The effective expansion = kept rules (in order) then override rows
 *      (in order). Override rows are complete: they replace `to` and any
 *      constraints wholesale, and may carry their own `when` guard.
 *
 * Expansion is recursive; a chain that revisits a ruleset is a load
 * error (IscLoadError, §3.2 / §6.4).
 */

import type { IscDocument, IscItem, IscRule, IscStage, IscStageItem } from "./types.js"
import { IscLoadError } from "./types.js"

/** Resolves a dependency target (system code) to its parsed document. */
export type DependencyDocResolver = (target: string) => IscDocument | undefined

export interface ExpandOptions {
  /**
   * Resolver for dependency documents, needed by `use <alias>.<ruleset>`.
   * Only declared dependencies are consulted — no implicit corpus-wide
   * lookups (§3.3). Absent when the map has no cross-dependency uses.
   */
  readonly resolveDependency?: DependencyDocResolver
}

/** Expand every `use` in the document's stages; rulesets themselves never execute. */
export function expandDocument(doc: IscDocument, opts: ExpandOptions = {}): IscDocument {
  const scope: ExpandScope = {
    doc,
    docKey: doc.systemCode,
    resolveDep: opts.resolveDependency,
    chain: [],
  }
  const stages: IscStage[] = doc.stages.map((s) => ({ ...s, body: expandItems(s.body, scope) }))
  return { ...doc, stages }
}

interface ExpandScope {
  /** Document that owns the rulesets currently being expanded. */
  readonly doc: IscDocument
  /** Identity of that document for cycle detection (its system code). */
  readonly docKey: string
  readonly resolveDep: DependencyDocResolver | undefined
  /** Active expansion chain — revisiting a chain member is a cycle. */
  readonly chain: readonly string[]
}

function expandItems(items: readonly IscStageItem[], scope: ExpandScope): IscStageItem[] {
  const out: IscStageItem[] = []
  for (const item of items) {
    if (item.kind === "use") {
      out.push(...expandUse(item, scope))
    } else {
      // parallel/sequence blocks contain plain rules only (`use` is a
      // stage-level item), so no recursion into blocks is needed.
      out.push(item)
    }
  }
  return out
}

function expandUse(
  item: Extract<IscStageItem, { kind: "use" }>,
  scope: ExpandScope,
): IscStageItem[] {
  // Resolve the owning document: same map, or a declared dependency.
  let owner = scope.doc
  let ownerKey = scope.docKey
  if (item.dependency) {
    const dep = scope.doc.dependencies.find((d) => d.aliasName === item.dependency)
    const target = dep?.target
    if (!target) {
      throw new IscLoadError(`use: unknown dependency alias "${item.dependency}"`)
    }
    const depDoc = scope.resolveDep?.(target)
    if (!depDoc) {
      throw new IscLoadError(
        `use: cannot resolve dependency "${target}" (needed for ruleset "${item.name}")`,
      )
    }
    owner = depDoc
    ownerKey = target
  }

  const key = `${ownerKey}::${item.name}`
  if (scope.chain.includes(key)) {
    throw new IscLoadError(`use cycle: ${[...scope.chain, key].join(" -> ")}`)
  }
  const ruleset = (owner.rulesets ?? []).find((r) => r.name === item.name)
  if (!ruleset) {
    throw new IscLoadError(
      `use: unknown ruleset "${item.name}"${item.dependency ? ` in dependency "${item.dependency}"` : ""}`,
    )
  }

  // Nested `use` items resolve against the OWNER's rulesets and the
  // owner's own dependency aliases; the resolver itself is global
  // (keyed by dependency target system code).
  const inner: ExpandScope = {
    doc: owner,
    docKey: ownerKey,
    resolveDep: scope.resolveDep,
    chain: [...scope.chain, key],
  }
  const expanded = expandItems(ruleset.body, inner)

  // W2 — use with override (§4.2): partition the full expansion
  // (including nested expansions) by exact from-equality.
  if (item.override && item.override.length > 0) {
    return applyOverride(expanded, item.override)
  }
  return expanded
}

/**
 * Remove every rule whose from matches an override row (from anywhere in
 * the expansion — bare rules and rules inside parallel/sequence blocks),
 * then append the override rows at the expansion site.
 */
function applyOverride(
  expanded: readonly IscStageItem[],
  overrides: readonly IscRule[],
): IscStageItem[] {
  const overrideKeys = new Set(overrides.map(ruleFromKey))

  const keepRule = (r: IscRule): boolean => !overrideKeys.has(ruleFromKey(r))

  const kept: IscStageItem[] = []
  for (const item of expanded) {
    if (item.kind === "bare_rule") {
      if (keepRule(item.rule)) kept.push(item)
    } else if (item.kind === "parallel" || item.kind === "sequence") {
      kept.push({ ...item, rules: item.rules.filter(keepRule) })
    } else {
      kept.push(item)
    }
  }

  const added: IscStageItem[] = overrides.map((rule) => ({ kind: "bare_rule", rule }))
  return [...kept, ...added]
}

/**
 * Structural key of a rule's from-item — the compiled-form analog of the
 * spec's "byte-exact string equality" on from-strings (§4.2). Two rules
 * written identically produce identical keys; no Unicode normalization.
 */
function ruleFromKey(rule: IscRule): string {
  return itemKey(rule.from)
}

function itemKey(item: IscItem): string {
  switch (item.type) {
    case "string":
      return `s:${JSON.stringify(item.value)}`
    case "none":
      return "none"
    case "primitive":
      return `p:${item.name}`
    case "function":
      return `f:${item.name}`
    case "alias_ref":
      return `a:${item.name}`
    case "capture":
      return `c:${item.index}`
    case "capture_group":
      return `g(${itemKey(item.inner)})`
    case "concat":
      return `+(${item.parts.map(itemKey).join(",")})`
    case "set":
      return `any(${item.items.map(itemKey).join(",")})`
    case "range":
      return `r:${item.lo}..${item.hi}`
    case "maybe":
      return `?(${itemKey(item.inner)})`
    case "some":
      return `*(${itemKey(item.inner)})`
  }
}

/**
 * Dependency targets a document needs for its `use <alias>.<ruleset>`
 * directives (declared dependencies only). Used by loaders that must
 * pre-fetch dependency sources before the synchronous expansion runs.
 */
export function requiredDependencyDocs(doc: IscDocument): string[] {
  const aliases = new Map<string, string>()
  for (const d of doc.dependencies) {
    if (d.aliasName) aliases.set(d.aliasName, d.target)
  }
  const targets = new Set<string>()
  const scan = (items: readonly IscStageItem[]): void => {
    for (const item of items) {
      if (item.kind === "use" && item.dependency) {
        const target = aliases.get(item.dependency)
        if (target) targets.add(target)
      }
    }
  }
  for (const s of doc.stages) scan(s.body)
  for (const r of doc.rulesets ?? []) scan(r.body)
  return [...targets]
}
