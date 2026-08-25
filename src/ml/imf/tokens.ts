/**
 * The canonical ByT5 byte table (shared contract with the Python and
 * Ruby runtimes): byte b -> token id b+3, trailing EOS; pad=0, unk=2.
 * Token ids are NOT raw byte values — feeding TextEncoder output
 * directly as ids silently produces garbage on real checkpoints.
 */

export const BYTE_OFFSET = 3
export const PAD_ID = 0
export const EOS_ID = 1
export const UNK_ID = 2

const encoder = new TextEncoder()
const decoder = new TextDecoder("utf-8", { fatal: false })

export function encode(text: string): number[] {
  const bytes = encoder.encode(text)
  const ids: number[] = new Array(bytes.length + 1)
  for (let i = 0; i < bytes.length; i++) ids[i] = bytes[i]! + BYTE_OFFSET
  ids[bytes.length] = EOS_ID
  return ids
}

export function decode(tokenIds: readonly number[]): string {
  const out: number[] = []
  for (const token of tokenIds) {
    if (token === EOS_ID) break
    if (token === PAD_ID || token === UNK_ID) continue
    out.push((token - BYTE_OFFSET) % 256)
  }
  return decoder.decode(new Uint8Array(out))
}
