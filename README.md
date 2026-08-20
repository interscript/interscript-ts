# Interscript-TS

[![CI](https://github.com/interscript/interscript-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/interscript/interscript-ts/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/interscript-ts)](https://www.npmjs.com/package/interscript-ts)

TypeScript runtime for [Interscript](https://www.interscript.org) — interoperable script conversion systems.

A TypeScript-native port of the [Ruby runtime](https://github.com/interscript/interscript-ruby), designed for modern Node.js, bundlers, and the browser. Consumes JSON IR (intermediate representation) emitted by the Ruby gem's `Compiler::JsonIR`.

## Status

🟡 **v0.1 — preview.** 4/5 sample maps achieve byte-exact Ruby parity. See [TODO.complete/42](https://github.com/interscript/interscript/blob/main/TODO.complete/42-parallel-rule-semantics.md) for the remaining gap.

## Installation

```bash
npm install interscript-ts
```

## Quick start

```typescript
import { transliterate, configure, bundledStrategy } from "interscript-ts"

// Load IR maps from a JSON dictionary (e.g. fetched, bundled, or read from disk)
configure({
  strategies: [bundledStrategy({
    "bgnpcgn-ukr-Cyrl-Latn-2019": { /* IR */ },
  })],
})

transliterate("bgnpcgn-ukr-Cyrl-Latn-2019", "Антон")  // → "Anton"
transliterate("bgnpcgn-deu-Latn-Latn-2000", "Tschüß!") // → "Tschueß!"
transliterate("odni-rus-Cyrl-Latn-2015", "привет")     // → "privet"
transliterate("alalc-amh-Ethi-Latn-2011", "ኢትዮጵያ")    // → "ʼiteyop̣eyā"
```

## Filesystem loader (Node)

```typescript
import { configure, transliterate, filesystemStrategy } from "interscript-ts"

configure({ strategies: [filesystemStrategy("./maps")] })
// reads `./maps/<systemCode>.json` on demand, caches
```

## CLI

```bash
npx interscript-ts -s bgnpcgn-ukr-Cyrl-Latn-2019 -i input.txt --maps-dir ./maps
```

Reads stdin if `-i` is omitted; writes stdout if `-o` is omitted.

## Architecture

| Principle | Implementation |
|-----------|----------------|
| **OCP** | Discriminated unions for AST; new node kinds add via variants + executor registry entries |
| **MECE** | One responsibility per module: `errors`, `types`, `stdlib`, `loader`, `loaders`, `detector`, `runtime/{context,compile-item,executor,interpreter}` |
| **DRY** | `compileItem` shared by all executors; `ExecutionContext` shared state |
| **Model-driven** | `types.ts` defines domain (Stage, Rule, Item); everything else references it |
| **Performance** | Trie-based parallel replace (O(n) single pass), cached maps, lazy alias resolution |

### Public API

| Ruby | TypeScript |
|------|------------|
| `Interscript.transliterate(systemCode, string)` | `transliterate(systemCode, input, stage?)` |
| `Interscript.load(systemCode)` | `loadMap(systemCode)` |
| `Interscript.detect(input, output)` | `detect(input, output, opts?)` |

### Generating JSON IR

The Ruby gem ships `Compiler::JsonIR` (PR [#757](https://github.com/interscript/interscript-ruby/pull/757)):

```bash
cd interscript-ruby
bundle exec rake compile:json_ir[target_directory]
```

Or programmatically:

```ruby
require "interscript/compiler/json_ir"
Interscript::Compiler::JsonIR.call(Interscript.parse(map_name)).code
```

## Development

```bash
npm ci
npm test              # 118 unit + property + edge tests
npm run test:coverage # 80% thresholds enforced
npm run test:bench    # benchmark suite (regression detection)
npm run test:parity   # Ruby parity tests (requires fixtures)
npm run lint
npm run build
```

Generate fresh parity fixtures (requires Ruby + interscript gem):

```bash
npm run gen:parity
```

## Test coverage

- **Unit:** stdlib, interpreter, executor, compile-item, loader, errors, detector
- **Property:** deterministic PRNG; round-trip, idempotence, longest-match invariants
- **Edge cases:** empty input, 10k chars, astral plane, determinism
- **Parity:** byte-exact comparison with Ruby interpreter across 5 sample maps
- **Bench:** trie reuse, parallel replace, end-to-end transliteration

## License

BSD-2-Clause — Ribose Inc.

## See also

- [Interscript Ruby](https://github.com/interscript/interscript-ruby) — reference runtime
- [Interscript maps](https://github.com/interscript/maps) — map corpus
- [Interscript.org](https://www.interscript.org) — main site
