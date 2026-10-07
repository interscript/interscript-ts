/**
 * Plane model kind: the run-018/021/022 artifact family (ts port).
 *
 * One ONNX graph maps (input_ids, plane_ids) -> per-position class
 * logits; decode is a host-side K-pass loop conditioning on the
 * previous argmax; per-character class = majority vote over the char's
 * byte-token predictions. Byte table: id = byte + 3 (canonical ByT5,
 * see imf/tokens). Zip contract: metadata.yaml (kind: plane, k_passes,
 * member sha256s) + plane.onnx + classes.json, every member
 * sha-verified before the session is created — mirroring the Python
 * and Ruby runtimes exactly.
 */

import { unzipSync } from "fflate"
import { load as loadYaml } from "js-yaml"

import type { InferenceSession, MLModel, Tensor } from "../../types.js"
import { createSession } from "../../session/index.js"
import { encode as encodeByt5 } from "../../imf/tokens.js"

export class PlaneError extends Error {}

export interface PlaneOptions {
  readonly preserveDiacritics?: boolean
}

interface PlaneManifest {
  readonly id: string
  readonly kPasses: number
  readonly members: Readonly<Record<string, string>>
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256", new Uint8Array(data).buffer as ArrayBuffer)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

function parseManifest(zipBytes: Uint8Array): {
  manifest: PlaneManifest
  files: Record<string, Uint8Array>
} {
  const files = unzipSync(zipBytes)
  const metaBytes = files["metadata.yaml"]
  if (!metaBytes) throw new PlaneError("plane zip: metadata.yaml missing")
  const raw = loadYaml(new TextDecoder().decode(metaBytes)) as Record<string, unknown>
  if (raw["kind"] !== "plane") {
    throw new PlaneError(`plane zip: kind=${String(raw["kind"])}, expected 'plane'`)
  }
  const members = (raw["members"] ?? {}) as Record<string, string>
  for (const member of ["plane.onnx", "classes.json"]) {
    if (!files[member]) throw new PlaneError(`plane zip: ${member} missing`)
    if (!members[member]) throw new PlaneError(`plane zip: ${member} has no sha256 in metadata`)
  }
  return {
    manifest: {
      id: String(raw["id"] ?? ""),
      kPasses: Number(raw["k_passes"] ?? 2),
      members,
    },
    files,
  }
}

function int64Tensor(name: string, values: readonly number[]): Tensor {
  const data = new BigInt64Array(values.length)
  for (let i = 0; i < values.length; i++) data[i] = BigInt(values[i]!)
  return { name, data, dims: [1, values.length], type: "int64" }
}

function argmaxRow(logits: Float32Array, offset: number, width: number): number {
  let best = 0
  let bestV = -Infinity
  for (let i = 0; i < width; i++) {
    const v = logits[offset + i]!
    if (v > bestV) { bestV = v; best = i }
  }
  return best
}

export class PlaneModel implements MLModel {
  readonly kind = "plane" as const
  readonly classes: readonly string[]
  readonly kPasses: number
  private readonly session: InferenceSession
  private readonly markChars: ReadonlySet<string>
  private readonly classToId: ReadonlyMap<string, number>

  private constructor(
    session: InferenceSession, classes: readonly string[], kPasses: number,
  ) {
    this.session = session
    this.classes = classes
    this.kPasses = kPasses
    this.markChars = new Set(classes.flatMap((c) => Array.from(c)))
    this.classToId = new Map(classes.map((c, i) => [c, i]))
  }

  static async fromZip(zipBytes: Uint8Array): Promise<PlaneModel> {
    const { manifest, files } = parseManifest(zipBytes)
    for (const member of ["plane.onnx", "classes.json"]) {
      const got = await sha256Hex(files[member]!)
      if (got !== manifest.members[member]) {
        throw new PlaneError(`plane zip: ${member} sha256 mismatch (${got})`)
      }
    }
    const classes = JSON.parse(new TextDecoder().decode(files["classes.json"])) as string[]
    const session = await createSession(files["plane.onnx"]!)
    return new PlaneModel(session, classes, manifest.kPasses)
  }

  dispose(): Promise<void> {
    return this.session.dispose()
  }

  /** Split labeled text into skeleton + per-base classes (marks follow
   * their base letter; leading marks bind to a NUL anchor that render
   * drops). Cluster order preserved as written — the Hebrew canon rule. */
  private splitPlanes(text: string): { skeleton: string[]; classes: string[] } {
    const skeleton: string[] = []
    const classes: string[] = []
    let current: string[] = []
    const close = (): void => {
      if (current.length === 0) return
      if (skeleton.length === 0) {
        skeleton.push("\x00")
        classes.push(current.join(""))
      } else {
        classes[classes.length - 1] = classes[classes.length - 1]! + current.join("")
      }
      current = []
    }
    for (const ch of text) {
      if (this.markChars.has(ch)) { current.push(ch); continue }
      close()
      skeleton.push(ch)
      classes.push("")
    }
    close()
    return { skeleton, classes }
  }

  private async decodePinned(
    skeleton: string[], pinned: ReadonlyArray<string | undefined>,
  ): Promise<number[]> {
    const ids = encodeByt5(skeleton.join(""))
    ids.pop() // trailing EOS: one token per byte
    const pinPerToken: number[] = []
    const mask = this.classes.length
    skeleton.forEach((ch, i) => {
      const cls = pinned[i]
      const pid = cls === undefined || cls === "" ? mask : this.classToId.get(cls) ?? mask
      for (let b = 0; b < byteLen(ch); b++) pinPerToken.push(pid)
    })
    const pinnedIdx: number[] = []
    pinPerToken.forEach((p, i) => { if (p !== mask) pinnedIdx.push(i) })

    let plane = ids.map(() => mask)
    pinnedIdx.forEach((i) => { plane[i] = pinPerToken[i]! })
    for (let pass = 0; pass < this.kPasses; pass++) {
      const out = await this.session.run({
        input_ids: int64Tensor("input_ids", ids),
        plane_ids: int64Tensor("plane_ids", plane),
      })
      const logits = out[this.session.outputNames[0]!]!
      const width = logits.dims[logits.dims.length - 1]!
      const data = logits.data as Float32Array
      const next: number[] = []
      for (let t = 0; t < ids.length; t++) {
        next.push(argmaxRow(data, t * width, width))
      }
      pinnedIdx.forEach((i) => { next[i] = pinPerToken[i]! })
      plane = next
    }
    return plane
  }

  async transform(input: string, opts: PlaneOptions = {}): Promise<string> {
    if (!opts.preserveDiacritics) {
      const preds = await this.decodePinned(Array.from(input), [])
      return render(
        Array.from(input),
        Array.from(input).map(() => ""),
        preds,
        this.classes,
      )
    }
    const { skeleton, classes } = this.splitPlanes(input)
    const preds = await this.decodePinned(skeleton, classes)
    return render(skeleton, classes, preds, this.classes)
  }
}

function byteLen(ch: string): number {
  return new TextEncoder().encode(ch).length
}

function render(
  skeleton: string[], classes: readonly string[],
  preds: readonly number[], allClasses: readonly string[],
): string {
  const mask = allClasses.length
  let pos = 0
  const out: string[] = []
  skeleton.forEach((ch, i) => {
    const n = byteLen(ch)
    let cls = classes[i] ?? ""
    if (cls === "") {
      const votes: number[] = []
      for (let b = pos; b < Math.min(pos + n, preds.length); b++) votes.push(preds[b]!)
      if (votes.length > 0) {
        const counts = new Map<number, number>()
        votes.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1))
        let best = votes[0]!
        let bestC = -1
        counts.forEach((c, v) => { if (c > bestC) { bestC = c; best = v } })
        cls = best < mask ? allClasses[best]! : ""
      }
    }
    if (ch === "\x00") out.push(cls)
    else out.push(ch + cls)
    pos += n
  })
  return out.join("")
}

/** Convenience: resolve a model id via the index and load it. */
export async function createPlaneModel(zipBytes: Uint8Array): Promise<PlaneModel> {
  return PlaneModel.fromZip(zipBytes)
}
