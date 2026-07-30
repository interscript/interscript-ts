/**
 * Benchmark suite — performance regression detection.
 *
 * Run with: npm run test:bench
 * Each benchmark reports ops/sec for a representative workload.
 * Failures (significant slowdown vs baseline) flag in CI.
 */

import { describe, bench } from "vitest"
import {
  parallelReplace,
  compileParallelTree,
  parallelReplaceTree,
  levenshtein,
  regexpEscape,
} from "../src/stdlib.js"
import { configure, reset, transliterate } from "../src/index.js"
import { filesystemStrategy } from "../src/loaders.node.js"
import { resolve } from "node:path"

const MAPS_DIR = resolve(process.cwd(), "test/fixtures/maps")
configure({ strategies: [filesystemStrategy(MAPS_DIR)] })

describe("stdlib primitives", () => {
  const SAMPLE = "привет мир ".repeat(100)

  bench(
    "parallelReplace — 10 pairs, 1000-char input",
    () => {
      parallelReplace(SAMPLE, [
        ["п", "p"],
        ["р", "r"],
        ["и", "i"],
        ["в", "v"],
        ["е", "e"],
        ["т", "t"],
        [" ", "_"],
        ["м", "m"],
        ["и", "i"],
        ["р", "r"],
      ])
    },
    { iterations: 100 },
  )

  bench("regexpEscape — 100-char input with special chars", () => {
    const input = ".*+?^${}()|[]\\".repeat(10)
    regexpEscape(input)
  })

  bench("levenshtein — 50-char strings", () => {
    const a = "привет мир, как дела сегодня".repeat(2)
    const b = "privet mir, kak dela segodnya".repeat(2)
    levenshtein(a, b)
  })
})

describe("trie compilation + reuse", () => {
  const pairs = Array.from({ length: 100 }, (_, i) => [
    String.fromCharCode(0x410 + i),
    `letter_${i}`,
  ]) as [string, string][]

  bench("compileParallelTree — 100 pairs", () => {
    compileParallelTree(pairs)
  })

  const tree = compileParallelTree(pairs)
  bench("parallelReplaceTree — reuse compiled trie", () => {
    parallelReplaceTree("АБВГДЕЖЗИКЛМНОП", tree)
  })
})

describe("end-to-end transliteration", () => {
  reset()
  configure({ strategies: [filesystemStrategy(MAPS_DIR)] })

  bench(
    "transliterate bgnpcgn-ukr (Антон)",
    () => {
      transliterate("bgnpcgn-ukr-Cyrl-Latn-2019", "Антон")
    },
    { iterations: 50 },
  )

  bench(
    "transliterate bgnpcgn-ukr — 1000-char input",
    () => {
      transliterate("bgnpcgn-ukr-Cyrl-Latn-2019", "Антон ".repeat(200))
    },
    { iterations: 20 },
  )

  bench(
    "transliterate bgnpcgn-deu (parallel rules)",
    () => {
      transliterate("bgnpcgn-deu-Latn-Latn-2000", "Tschüß! " .repeat(50))
    },
    { iterations: 20 },
  )
})
