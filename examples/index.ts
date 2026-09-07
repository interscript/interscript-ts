/**
 * The example registry — data, not behavior. Adding an example is a new
 * file plus one line here; the test suite iterates this list.
 */
export interface ExampleEntry {
  readonly id: string
  readonly file: string
  /** Executes only under INTERSCRIPT_PLAYGROUND_LIVE=1 (large downloads). */
  readonly liveOnly?: boolean
}

export const EXAMPLES: readonly ExampleEntry[] = [
  { id: "convert", file: "./convert.js" },
  { id: "detect-chain", file: "./detect-chain.js" },
  { id: "neural-diacritize", file: "./neural-diacritize.js", liveOnly: true },
  { id: "batch-columns", file: "./batch-columns.js" },
  { id: "server-mode", file: "./server-mode.js" },
]

export interface LoadedExample {
  readonly title: string
  readonly summary: string
  readonly expected: string
  run(): Promise<string>
}

export async function loadExample(entry: ExampleEntry): Promise<LoadedExample> {
  const mod = (await import(entry.file)) as LoadedExample
  return mod
}
