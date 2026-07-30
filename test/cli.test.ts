import { describe, it, expect } from "vitest"
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { dirname } from "node:path"
import { writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const CLI_PATH = resolve(ROOT, "dist/cli.js")
const MAPS_DIR = resolve(ROOT, "test/fixtures/maps")

function runCli(args: string[], stdin?: string): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync("node", [CLI_PATH, ...args], {
    encoding: "utf8",
    input: stdin,
    env: { ...process.env },
  })
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status,
  }
}

describe("CLI", () => {
  it("prints help when no args", () => {
    const r = runCli([])
    expect(r.status).toBe(1)
    expect(r.stdout).toContain("Usage:")
    expect(r.stdout).toContain("Commands:")
  })

  it("prints help with --help", () => {
    const r = runCli(["--help"])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain("Usage:")
  })

  it("accepts 't' alias for transliterate", () => {
    const r = runCli(
      ["t", "bgnpcgn-ukr-Cyrl-Latn-2019", "--maps-dir", MAPS_DIR],
      "Антон",
    )
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe("Anton")
  })

  it("accepts 'transliterate' full command", () => {
    const r = runCli(
      ["transliterate", "bgnpcgn-ukr-Cyrl-Latn-2019", "--maps-dir", MAPS_DIR],
      "Антон",
    )
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe("Anton")
  })

  it("returns error for unknown command", () => {
    const r = runCli(["nonsense"])
    expect(r.status).toBe(1)
    expect(r.stderr).toContain("Unknown command")
  })

  it("errors when systemCode is missing", () => {
    const r = runCli(["t", "--maps-dir", MAPS_DIR], "Антон")
    expect(r.status).toBe(1)
    expect(r.stderr).toContain("systemCode")
  })

  it("lists systems filtered by authority", () => {
    const r = runCli(["l", "--maps-dir", MAPS_DIR, "--authority", "bgnpcgn"])
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/bgnpcgn/)
  })

  it("accepts 'list' full command", () => {
    const r = runCli(["list", "--maps-dir", MAPS_DIR])
    expect(r.status).toBe(0)
    expect(r.stderr).toContain("systems")
  })

  it("errors when list has no maps-dir", () => {
    const r = runCli(["list"])
    expect(r.status).toBe(2)
    expect(r.stderr).toContain("--maps-dir")
  })

  it("batch transliterates a file", () => {
    const tmp = mkdtempSync(resolve(tmpdir(), "isx-cli-test-"))
    const infile = resolve(tmp, "names.txt")
    writeFileSync(infile, "Антон\nКиїв\n", "utf8")
    const r = runCli([
      "b",
      "bgnpcgn-ukr-Cyrl-Latn-2019",
      infile,
      "--csv",
      "--maps-dir",
      MAPS_DIR,
    ])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('"Антон"')
    expect(r.stdout).toContain('"Anton"')
    expect(r.stderr).toContain("Processed")
  })

  it("batch errors when input file missing", () => {
    const r = runCli([
      "b",
      "bgnpcgn-ukr-Cyrl-Latn-2019",
      "/tmp/does-not-exist.txt",
      "--maps-dir",
      MAPS_DIR,
    ])
    expect(r.status).toBe(2)
    expect(r.stderr).toContain("not found")
  })
})
