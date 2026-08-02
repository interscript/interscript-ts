# 01 — ISC parser in TypeScript (direct .isc loading)

## Priority: P1

## Problem
The TS runtime only loads compiled JSON IR (produced by Ruby's JsonIR
compiler). It cannot parse `.isc` source files directly. This creates a
build-time dependency on Ruby for every map update.

For full language independence (the user's stated goal), the TS runtime
needs its own ISC parser.

## Current Architecture
```
.imp → Ruby DSL → Node → JsonIR → .json → TS runtime
.isc → Ruby ISC parser → (no bridge to Node yet)
```

## Target Architecture
```
.isc → Ruby ISC parser → Node → JsonIR → .json → TS runtime
.isc → TS ISC parser ──────────────────────────→ TS runtime (direct)
```

## Implementation

### Grammar
Port the Parslet grammar to Peggy (PEG parser generator for JS):

```
// grammar/isc.pegjs
isc_source
  = _ system:system_block _ { return system }

system_block
  = "system" _ code:quoted_string _? "{" body:block_item* _? "}" { ... }
```

### Structure
```
packages/isc-parser/
  grammar/isc.pegjs          # Peggy grammar
  src/parser.ts              # Wrapper API
  src/document-builder.ts    # Tree → typed model
  test/parser.test.ts        # Unit tests
  test/parity.test.ts        # Cross-validate with Ruby output
```

### API
```typescript
export function parseIsc(source: string, filename?: string): IscDocument
export function loadIscFile(path: string): Promise<IscDocument>
```

### Strategy Integration
Add an `iscStrategy` to the loader:
```typescript
const strategy = iscFileStrategy({ baseDir: "/maps" })
configure({ strategies: [strategy] })
```

This lets the runtime load `.isc` files directly without pre-compilation.

## Verification
- Parse all 289 .isc files with the TS parser
- Compare document model with Ruby parser output
- Run transliteration: output must match Ruby 100%
