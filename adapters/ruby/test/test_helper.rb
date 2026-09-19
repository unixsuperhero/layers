# frozen_string_literal: true

require "minitest/autorun"
require "fileutils"
require "tmpdir"
require "set"
require "prism"

LIB = File.expand_path("../lib", __dir__)
SAMPLES = File.expand_path("samples", __dir__)
FIXTURE_DIR = File.expand_path("../../../fixtures/example-ruby", __dir__)

%w[symbols file_discovery scope_index static_visitor effect_catalog effects_visitor
   effect_verdicts project_index constant_resolver call_resolver tracer_support
   doc_writer].each { |f| require File.join(LIB, f) }

# Runs the same pipeline as analyze.rb's build_marks_and_index (minus file discovery / the
# tracer) over an in-memory {relative_path => source} map -- the shared fixture for
# effects/constants tests, so they don't need to shell out to the CLI.
module AnalyzePipeline
  Result = Struct.new(:marks, :sources, keyword_init: true) do
    def by_layer(id)
      marks.select { |m| m.layer == id }
    end
  end

  module_function

  def run(files, all_constants: false)
    visitors = {}
    effects_visitors = {}
    files.each do |rel, source|
      result = Prism.parse(source, filepath: rel)
      raise "#{rel} failed to parse: #{result.errors.map(&:message).join('; ')}" unless result.success?

      v = StaticVisitor.new(rel)
      v.visit(result.value)
      visitors[rel] = v

      ev = EffectsVisitor.new(rel)
      ev.visit(result.value)
      effects_visitors[rel] = ev
    end

    def_marks = visitors.values.flat_map(&:def_marks)
    var_marks = visitors.values.flat_map(&:var_marks)
    def_records = visitors.values.flat_map(&:def_records)
    raw_constants = visitors.values.flat_map(&:raw_constants)
    raw_calls = visitors.values.flat_map(&:raw_calls)

    index = ProjectIndex.new(def_records)
    const_marks = ConstantResolver.resolve(raw_constants, index, all_constants: all_constants)
    call_marks = CallResolver.resolve(raw_calls, index)

    method_symbols = def_records.select { |r| %i[instance singleton].include?(r.kind) }.map(&:symbol).to_set

    effect_marks = effects_visitors.values.flat_map(&:effect_marks)
    pending_calls = effects_visitors.values.flat_map(&:raw_effect_calls)
    direct_kinds = Hash.new { |h, k| h[k] = Set.new }
    effects_visitors.each_value { |ev| ev.direct_kinds.each { |sym, kinds| direct_kinds[sym].merge(kinds) } }

    verdicts = EffectVerdicts.compute(pending_calls: pending_calls, resolved_calls: call_marks, index: index,
                                       direct_kinds: direct_kinds, method_symbols: method_symbols)

    def_marks.select { |m| m.layer == "defs.methods" }.each do |m|
      effects = verdicts[:effects_by_method][m.symbol]
      m.extra = { "effects" => effects } if effects
    end

    marks = def_marks + var_marks + const_marks + call_marks + effect_marks +
            verdicts[:unknown_marks] + verdicts[:calls_marks]
    Result.new(marks: marks, sources: files)
  end
end
