/**
 * Specs for the Secryst ML module — vocab parsing, mask construction,
 * and the translator pipeline (mock session).
 */

import { describe, it, expect } from "vitest"
import { Vocab, parseVocabYaml, buildVocabs } from "../../src/ml/models/secryst/vocab.js"
import { causalMask, paddingMask, buildMasks } from "../../src/ml/models/secryst/masks.js"

describe("Secryst vocab", () => {
  const sampleYaml = `input:
  - "<sos>"
  - "<eos>"
  - "a"
  - "b"
  - "c"
target:
  - "<sos>"
  - "<eos>"
  - "x"
  - "y"
  - "z"`

  it("parses YAML into input + target arrays", () => {
    const data = parseVocabYaml(sampleYaml)
    expect(data.input).toEqual(["<sos>", "<eos>", "a", "b", "c"])
    expect(data.target).toEqual(["<sos>", "<eos>", "x", "y", "z"])
  })

  it("builds Vocab instances with correct stoi/itos", () => {
    const data = parseVocabYaml(sampleYaml)
    const { input, target } = buildVocabs(data)
    expect(input.encode("a")).toBe(2)
    expect(input.decode(2)).toBe("a")
    expect(target.encode("x")).toBe(2)
    expect(target.decode(2)).toBe("x")
  })

  it("returns -1 for unknown tokens", () => {
    const v = new Vocab(["a", "b"])
    expect(v.encode("z")).toBe(-1)
  })

  it("encodeSequence converts a string to IDs", () => {
    const v = new Vocab(["a", "b", "c"])
    expect(v.encodeSequence("abc")).toEqual([0, 1, 2])
  })

  it("decodeSequence converts IDs back to string", () => {
    const v = new Vocab(["a", "b", "c"])
    expect(v.decodeSequence([0, 1, 2])).toBe("abc")
  })

  it("handles special tokens", () => {
    const v = new Vocab(["a"], ["<sos>", "<eos>"])
    expect(v.encode("<sos>")).toBe(0)
    expect(v.encode("<eos>")).toBe(1)
    expect(v.encode("a")).toBe(2)
  })
})

describe("Secryst attention masks", () => {
  it("causalMask blocks future positions", () => {
    const mask = causalMask(3)
    // Row 0: can only see position 0
    expect(mask[0]).toBe(1)  // [0,0]
    expect(mask[1]).toBe(0)  // [0,1]
    expect(mask[2]).toBe(0)  // [0,2]
    // Row 1: can see 0 and 1
    expect(mask[3]).toBe(1)  // [1,0]
    expect(mask[4]).toBe(1)  // [1,1]
    expect(mask[5]).toBe(0)  // [1,2]
    // Row 2: can see 0, 1, 2
    expect(mask[6]).toBe(1)
    expect(mask[7]).toBe(1)
    expect(mask[8]).toBe(1)
  })

  it("paddingMask marks pad tokens as 0", () => {
    // Pad ID = 1 in secryst
    const mask = paddingMask([0, 1, 2, 1])
    expect(mask).toEqual(new Uint8Array([1, 0, 1, 0]))
  })

  it("buildMasks produces all 4 mask tensors", () => {
    const masks = buildMasks(3, 2, [0, 1, 2], [3, 1])
    expect(masks.tgt_mask).toBeDefined()
    expect(masks.src_key_padding_mask).toBeDefined()
    expect(masks.tgt_key_padding_mask).toBeDefined()
    expect(masks.memory_key_padding_mask).toBeDefined()
    expect(masks.tgt_mask.dims).toEqual([2, 2])
    expect(masks.src_key_padding_mask.dims).toEqual([1, 3])
  })
})
