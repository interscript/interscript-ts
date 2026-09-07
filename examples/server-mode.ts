/**
 * The no-download path: the public API converts through the same engine
 * server-side. CORS is open (access-control-allow-origin: *), so this
 * runs from any browser script.
 */
export const title = "Convert without downloading anything"
export const summary = "POST to api.interscript.org — maps and neural models, zero local bytes."

const API = "https://api.interscript.org/v1"

export const expected = "Anton Olehovych"

export async function run(): Promise<string> {
  const response = await fetch(`${API}/transliterate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ system: "bgnpcgn-ukr-Cyrl-Latn-2019", input: "Антон Олегович" }),
  })
  if (!response.ok) {
    throw new Error(`api ${response.status}: ${await response.text()}`)
  }
  const body = (await response.json()) as { output: string }
  return body.output
}
