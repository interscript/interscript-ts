#!/usr/bin/env ruby
# Generates JSON parity fixtures from interscript-ruby's test suite.
# Output is consumed by test/parity.test.ts to verify the TS runtime
# matches Ruby interpreter behaviour.
#
# Run: ruby scripts/gen-parity-fixtures.rb > test/fixtures/parity.json
#
# Requires interscript gem installed (`gem install interscript`).

require "json"
require "interscript"

# Curated set of map + input pairs covering:
#   - simple substitution
#   - multi-stage pipelines
#   - alias chains
#   - regex patterns
#   - unicode scripts
# Pairs are drawn from interscript-ruby's spec/ cases plus some added
# for breadth. Extend as needed.
SAMPLES = [
  ["bgnpcgn-ukr-Cyrl-Latn-2019", "Антон"],
  ["bgnpcgn-ukr-Cyrl-Latn-2019", "Михаил Тимофеевич Калашников"],
  ["bgnpcgn-deu-Latn-Latn-2000", "Tschüß!"],
  ["odni-rus-Cyrl-Latn-2015", "привет мир"],
  ["icao-ukr-Cyrl-Latn-9303", "Київ"],
  ["alalc-amh-Ethi-Latn-2011", "ኢትዮጵያ"],
  ["un-tam-Taml-Latn-1972", "தமிழ்"],
]

samples =
  SAMPLES.map do |system_code, input|
    expected =
      begin
        Interscript.transliterate(system_code, input)
      rescue StandardError => e
        # Skip maps not installed in the current environment.
        warn "SKIP #{system_code}: #{e.message}"
        nil
      end
    { system_code: system_code, input: input, expected: expected }
  end.compact

puts JSON.pretty_generate(samples)
