/**
 * Engram address hashing — the TypeScript side of the portable
 * contract (TODO.impl/10 export probe): the hash must produce
 * IDENTICAL addresses to ml-models src/gpu/engram.py, because
 * addresses are an IMF graph input computed per runtime. The fixture
 * in test/fixtures/engram-addresses.json is generated from the Python
 * implementation; the parity test pins this port to it.
 */

export const FNV_OFFSET = 0x811c9dc5
export const FNV_PRIME = 0x01000193
export const DEFAULT_ORDERS = [2, 3, 4] as const

function fnv1a(data: readonly number[], seed: number): number {
  let h = (FNV_OFFSET ^ seed) >>> 0
  for (const b of data) {
    // Math.imul: 32-bit multiply — plain * exceeds 2^53 and loses
    // low bits the hash depends on
    h = Math.imul(h ^ b, FNV_PRIME) >>> 0
  }
  return h >>> 0
}

/** Addresses for the byte n-grams ENDING at each position, hashed as
 * (id - 3) mod 256 — the canonical byte table. Positions without a
 * full n-gram address 0 (the null row). */
export function ngramAddresses(
  seq: readonly number[],
  orders: readonly number[] = DEFAULT_ORDERS,
): number[][] {
  const out: number[][] = []
  for (let end = 0; end < seq.length; end++) {
    const row: number[] = []
    for (const order of orders) {
      if (end + 1 >= order) {
        const gram: number[] = []
        for (let i = end + 1 - order; i <= end; i++) {
          gram.push((seq[i]! - 3) & 0xff)
        }
        const h = fnv1a(gram, orders.indexOf(order) + 1)
        row.push(h === 0 ? 1 : h)
      } else {
        row.push(0)
      }
    }
    out.push(row)
  }
  return out
}
