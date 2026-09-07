/**
 * The CDN entry points the docs promise — pinned, loadable, and
 * actually JavaScript. Network test, same allowance as the examples
 * suite; catches a broken publish before the docs lie.
 */
import { describe, expect, it } from "vitest"

const VERSION = "5.3.0"
const ENTRIES = [
  `https://esm.sh/interscript@${VERSION}`,
  `https://esm.sh/interscript@${VERSION}/ml`,
]

describe("cdn delivery entries", () => {
  for (const url of ENTRIES) {
    it(`${url} responds with a module`, { timeout: 30_000 }, async () => {
      const response = await fetch(url)
      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toContain("javascript")
      const body = await response.text()
      expect(body).not.toContain("Cannot find")
    })
  }
})
