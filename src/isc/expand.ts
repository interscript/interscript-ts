/**
 * ISC-WF-1 W1/W2 — ruleset expansion (§3) and use-with-override merge (§4).
 *
 * Expansion happens at COMPILE time: `expandDocument()` rewrites a parsed
 * document so that every `use` directive is replaced by the referenced
 * ruleset's items at its position (a macro expansion, not a sub-run).
 * The compiled IR stays flat — expanded rules only, no ruleset nodes.
 *
 * WO18 G5 (§3.2): `use` may also sit INSIDE a parallel/sequence block.
 * Items inside a block participate in that block's single pass, so the
 * expansion inherits the enclosing pass structure — the referenced
 * ruleset's rule content flattens into the enclosing collection. A
 * referenced ruleset carrying non-rule items (funcalls, stage runs)
 * cannot join a pass — named load error. Overrides merge per-rule on
 * the flat list (child-wins; the rows land at the expansion tail).
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

import type { IscDocument, IscItem, IscRule, IscStage, IscStageItem, IscUseItem } from "./types.js"
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
  // WO18 G7 (py canon): a ruleset declared twice is a load error —
  // keep-first silently hides map bugs and first-`.find` lookup makes
  // the executed body declaration-order dependent.
  const seenRs = new Set<string>()
  for (const rs of doc.rulesets ?? []) {
    if (!seenRs.has(rs.name)) seenRs.add(rs.name)
    else throw new IscLoadError(`ruleset "${rs.name}" declared more than once in ${doc.systemCode}`)
  }
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
    } else if (item.kind === "parallel" || item.kind === "sequence") {
      // WO18 G5 (§3.2): block bodies are rule_line lists — `use` items
      // inside them expand flat into the block's rule list.
      out.push({ ...item, rules: item.rules.flatMap((r) => expandBlockRow(r, scope)) })
    } else {
      out.push(item)
    }
  }
  return out
}

const isUseItem = (row: IscRule | IscUseItem): row is IscUseItem => !("from" in row)

/** One rule_line row of a parallel/sequence block (§3.2): `use` rows
 * flatten the referenced ruleset's rules into the block; rule rows pass
 * through. Both return arrays so the caller can splice uniformly. */
function expandBlockRow(row: IscRule | IscUseItem, scope: ExpandScope): IscRule[] {
  return isUseItem(row) ? expandUseFlat(row, scope) : [row]
}

/** Shared target resolution for a `use` site: owner document, cycle
 * guard, memo ruleset lookup; returns the target's structural expansion
 * and the inner scope its nested uses resolve against. */
function resolveRulesetExpansion(
  item: Extract<IscStageItem, { kind: "use" }>,
  scope: ExpandScope,
): { expanded: IscStageItem[]; inner: ExpandScope } {
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
  return { expanded: expandItems(ruleset.body, inner), inner }
}

/** Stage/ruleset-body-position `use` (§3.1): the expansion splices the
 * target's items in position, document order, override rows merged
 * structurally (§4.2, incl. the §4.2.6 trailing-parallel join). */
function expandUse(
  item: Extract<IscStageItem, { kind: "use" }>,
  scope: ExpandScope,
): IscStageItem[] {
  const { expanded, inner } = resolveRulesetExpansion(item, scope)
  if (item.override !== undefined && item.override.length > 0) {
    return applyOverride(expanded, expandOverrideRows(item.override, inner))
  }
  return expanded
}

/** WO18 G5 — block-position `use` (§3.2): inside a block the expansion
 * inherits the enclosing pass structure — the target's rule content
 * flattens into the pass; overrides merge per-rule on the flat list
 * (child-wins, tail rows). */
function expandUseFlat(
  item: Extract<IscStageItem, { kind: "use" }>,
  scope: ExpandScope,
): IscRule[] {
  const { expanded, inner } = resolveRulesetExpansion(item, scope)
  let rules = flattenPassItems(expanded)
  if (item.override !== undefined && item.override.length > 0) {
    rules = mergeOverrideRules(rules, expandOverrideRows(item.override, inner))
  }
  return rules
}

/**
 * WO18 G5 (§3.2): flatten a structural expansion into the ordered rule
 * list of an enclosing pass. Pass blocks contribute their (already
 * expanded) rules in position; non-rule items (funcalls, stage runs)
 * cannot join a pass — named load error (interscript-rs flatten_rules).
 */
function flattenPassItems(items: readonly IscStageItem[]): IscRule[] {
  const out: IscRule[] = []
  for (const item of items) {
    if (item.kind === "parallel" || item.kind === "sequence") {
      // expandItems() already flattened `use` rows inside blocks, so the
      // list is rules-only at this point.
      out.push(...(item.rules as readonly IscRule[]))
    } else if (item.kind === "bare_rule") {
      out.push(item.rule)
    } else {
      throw new IscLoadError(
        "use inside a parallel/sequence block: the referenced ruleset carries " +
          "non-rule items (funcalls/stage runs) that cannot join the pass",
      )
    }
  }
  return out
}

/** Override rows are rule_line items, so they may themselves be `use`
 * directives (rs extract_rule_list recursion); their content flattens
 * into the override rule list. */
function expandOverrideRows(
  rows: readonly (IscRule | IscUseItem)[],
  scope: ExpandScope,
): IscRule[] {
  return rows.flatMap((row) => (isUseItem(row) ? expandUseFlat(row, scope) : [row]))
}

/**
 * §4.2 merge over a FLAT rule list (the block-position use): matching
 * rules drop wherever they sit (child-wins on exact from-equality);
 * the override rows land at the expansion tail. No trailing-parallel
 * join here — the caller re-wraps the list into the enclosing block.
 */
function mergeOverrideRules(rules: readonly IscRule[], overrides: readonly IscRule[]): IscRule[] {
  const overrideKeys = new Set(overrides.map(ruleFromKey))
  const kept = rules.filter((r) => !overrideKeys.has(ruleFromKey(r)))
  return [...kept, ...overrides]
}

/**
 * Remove every rule whose from matches an override row (from anywhere in
 * the expansion — bare rules and rules inside parallel/sequence blocks),
 * then add the override rows: joined INTO a trailing parallel block when
 * the expansion ends with one (§4.2.5 — the whole expansion shares that
 * single longest-match pass), otherwise appended at the expansion site.
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
      // post-expansion block rule lists are rules-only
      kept.push({ ...item, rules: (item.rules as readonly IscRule[]).filter(keepRule) })
    } else {
      kept.push(item)
    }
  }

  const tail = kept[kept.length - 1]
  if (tail && tail.kind === "parallel") {
    kept[kept.length - 1] = { ...tail, rules: [...tail.rules, ...overrides] }
    return kept
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
      } else if (item.kind === "parallel" || item.kind === "sequence") {
        // `use` rows inside blocks may carry dependency qualifiers too
        for (const row of item.rules) {
          // IscRule is structural (no kind tag): shape-discriminate
          if (!("from" in row) && row.dependency) {
            const target = aliases.get(row.dependency)
            if (target) targets.add(target)
          }
        }
      }
    }
  }
  for (const s of doc.stages) scan(s.body)
  for (const r of doc.rulesets ?? []) scan(r.body)
  return [...targets]
}
