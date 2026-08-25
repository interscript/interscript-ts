#!/usr/bin/env ruby
# Extract every map's `test "input", "expected"` vectors and run them
# through Ruby's interpreter, emitting JSON consumable by the TS runner.
#
# Run: ruby scripts/full-parity.rb > test/fixtures/full-parity.json
#
# Excludes rababa/secryst maps (require external services).
# Uses the LOCAL maps repo (not the installed gem) so Ruby runs against
# the same .imp files the TS IR was generated from.

require "json"
require "interscript"

LOCAL_MAPS_DIR = File.expand_path("../../../interscript/maps/maps", __dir__)
LOCAL_LIBS_DIR = File.expand_path("../../../interscript/maps/libs", __dir__)
LOCAL_STAGING_DIR = File.expand_path("../../../interscript/maps/maps-staging", __dir__)

# Override Interscript's map search to prefer local repo over the gem.
original_locate = Interscript.method(:locate)
Interscript.define_singleton_method(:locate) do |name|
  %W[
    #{LOCAL_STAGING_DIR}/#{name}.imp
    #{LOCAL_MAPS_DIR}/#{name}.imp
    #{LOCAL_LIBS_DIR}/#{name}.iml
  ].each do |path|
    return path if File.exist?(path)
  end
  original_locate.call(name)
end

EXCLUDE = [/rababa/, /secryst/].freeze

samples = []
skipped = []

Dir.glob("*.imp", base: LOCAL_MAPS_DIR).sort.each do |f|
  system_code = f.sub(/\.imp\z/, "")
  next if EXCLUDE.any? { |re| re.match?(system_code) }

  text = File.read(File.join(LOCAL_MAPS_DIR, f), encoding: "utf-8")
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
