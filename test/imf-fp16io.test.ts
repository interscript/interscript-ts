/**
 * The fp16 graph-I/O contract guard (issue #111). The original fp16
 * exports shipped float16 graph I/O (last_hidden_state /
 * encoder_hidden_states / logits all float16). Python ORT consumes
 * fp16 I/O natively, so the reference decoder and the frozen vectors
 * never saw it — but onnxruntime-node cannot: on runtimes with native
 * Float16Array (Node >= 24) every float16 feed is converted to a
 * Float16Array view whose bytes the N-API binding reads as zero, and
 * session.run fails with the opaque "not enough space: expected N,
 * got 0". On pre-Float16Array runtimes the same feed stays
 * Uint16Array-backed and decodes fine (verified: Node 20/22 ok, Node
 * 24/26 broken).
 *
 * The runtime therefore rejects the unconsumable condition explicitly,
 * naming the artifact contract: graphs must expose fp32 I/O
 * (interscript-models tools/normalize_fp16_io.py, WO79 — the shipped
 * fp16 artifacts have been IO-normalized since 2026-10-21).
 *
 * The fixture is tiny-imf.zip with float16 wrapped across both graph
 * boundaries (Cast nodes, recomputed member digests) — the pre-WO79
 * export shape in ~1KB instead of 700MB.
 */

import { describe, expect, it } from "vitest"
import { IMFModel } from "../src/ml/imf/index.js"

const fixtureZip = "test/fixtures/tiny-fp16io.zip"

/** Node >= 24 ships native Float16Array; ORT converts fp16 feeds to
 * Float16Array views the onnxruntime-node binding cannot consume. */
const float16FeedsUnconsumable =
  typeof (globalThis as { Float16Array?: unknown }).Float16Array !== "undefined"

describe("fp16 graph-I/O artifacts (issue #111)", () => {
  it(
    float16FeedsUnconsumable
      ? "rejects with the artifact-contract error, not the opaque binding failure"
      : "decodes on runtimes whose binding consumes Uint16Array-backed fp16 feeds",
    async () => {
      const model = await IMFModel.load(fixtureZip)
      try {
        if (float16FeedsUnconsumable) {
          await expect(model.translate("rok", 64)).rejects.toThrow(
            /float16 graph I\/O.*fp32 graph I\/O.*normalize_fp16_io/s,
          )
        } else {
          const out = await model.translate("rok", 64)
          expect(typeof out).toBe("string")
        }
      } finally {
        await model.dispose()
      }
    },
    60_000,
  )
})
