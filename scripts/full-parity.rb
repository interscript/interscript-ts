#!/usr/bin/env ruby
# Extract every map's `test "input", "expected"` vectors and run them
# through Ruby's interpreter, emitting JSON consumable by the TS runner.
#
# Run: ruby scripts/full-parity.rb > test/fixtures/full-parity.json
#
# Excludes rababa/secryst maps (require external services).

require "json"
require "interscript"

MAPS_DIR = File.expand_path("../../../interscript/maps/maps", __dir__)
EXCLUDE = [/rababa/, /secryst/].freeze

samples = []
skipped = []

Dir.glob("*.imp", base: MAPS_DIR).sort.each do |f|
  system_code = f.sub(/\.imp\z/, "")
  next if EXCLUDE.any? { |re| re.match?(system_code) }

  text = File.read(File.join(MAPS_DIR, f), encoding: "utf-8")
  # Lines like:  test "input", "expected"
  tests = text.scan(/^\s*test\s+"(.+?)",\s*"(.+?)"\s*$/).map { |i, e| [i, e] }
  next if tests.empty?

  tests.each do |input, expected|
    begin
      actual = Interscript.transliterate(system_code, input)
      samples << {
        system_code: system_code,
        input: input,
        expected: expected,
        ruby_actual: actual
      }
    rescue StandardError => e
      skipped << { system_code: system_code, input: input, error: e.message }
    end
  end
end

puts JSON.pretty_generate(samples: samples, skipped: skipped)
warn "Generated #{samples.length} samples across #{samples.map { |s| s[:system_code] }.uniq.length} maps"
warn "Skipped #{skipped.length} cases"
