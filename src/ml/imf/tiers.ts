/** Client tier selection (TODO.client-work 04).
 *
 * Model ids follow the index convention: `-int4` / `-int8` suffixed
 * variants of a base id. Devices reporting little RAM (or no
 * deviceMemory hint, i.e. iOS Safari) get the smallest variant;
 * everything else gets int8 — measured faster per token than int4
 * despite the bigger artifact (bench E1).
 */

export interface TierCandidate {
  readonly id: string
  /** approximate artifact size hint from the index, bytes */
  readonly size?: number
}

/** Prefer int8 when the device can afford it; otherwise the smallest
 * candidate. `deviceMemoryGB` comes from
 * (navigator as any).deviceMemory — undefined on Safari. */
export function pickTier(
  candidates: readonly TierCandidate[] | readonly string[],
  deviceMemoryGB?: number,
): string {
  const entries: TierCandidate[] = candidates.map((c) => (typeof c === "string" ? { id: c } : c))
  if (entries.length === 0) throw new Error("no tier candidates")
  const roomy = deviceMemoryGB === undefined ? true : deviceMemoryGB >= 4
  const int8 = entries.find((e) => /-int8$/.test(e.id))
  if (roomy && int8) return int8.id
  const bySize = [...entries].sort((a, b) => (a.size ?? 0) - (b.size ?? 0))
  return bySize[0]!.id
}

/** Fire a tiny encode+decode once so the first real request doesn't
 * pay runtime warm-up (wasm compile, allocator growth). */
export async function warmUp(model: {
  translate(input: string, maxLen?: number): Promise<string>
}): Promise<void> {
  await model.translate("ك", 8).catch(() => undefined)
}
