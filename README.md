# Interscript-TS

TypeScript runtime for [Interscript](https://www.interscript.org) — interoperable script conversion systems.

This package is a TypeScript-native port of the [Ruby runtime](https://github.com/interscript/interscript-ruby), designed for modern Node.js and bundler environments.

## Status

🚧 **Under active development.** Initial public API + interpreter scaffold. See [TODO.complete](https://github.com/interscript/interscript/tree/main/TODO.complete) for the roadmap.

## Installation

```bash
npm install interscript-ts
```

## Usage

```typescript
import { transliterate, configure } from "interscript-ts"

// Configure a map loader (see LoadStrategy docs)
configure({ strategies: [/* ... */] })

const result = transliterate("bgnpcgn-ukr-Cyrl-Latn-2019", "Антон")
console.log(result) // "Anton"
```

## Architecture

- **Discriminated unions** for AST nodes — TS-idiomatic, supports OCP via exhaustiveness checks
- **Strategy pattern** for map loading (npm / fs / URL / custom)
- **Registry pattern** for rule executors — new rule kinds added without modifying existing code
- **Pure functional** interpreter — state in `ExecutionContext`, easy to test in isolation

See [Architecture notes](docs/architecture.md) for details.

## Development

```bash
npm ci
npm test
npm run lint
npm run build
```

## License

BSD-2-Clause — Ribose Inc.
