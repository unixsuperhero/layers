# frozen_string_literal: true

require_relative "test_helper"

# docs/ROUND-4.md "Constants": defs.constants, refs.constants resolving to them, --all-constants.
class ConstantsTest < Minitest::Test
  def test_top_level_constant_assignment
    result = AnalyzePipeline.run({ "a.rb" => "MAX = 10\n" })
    m = result.by_layer("defs.constants").first
    assert_equal "MAX", m.symbol
    assert_equal "definition", m.role
    assert_nil m.scope
  end

  def test_nested_constant_is_lexically_qualified
    result = AnalyzePipeline.run({ "a.rb" => <<~RUBY })
      module Shop
        class Cart
          MAX = 5
        end
      end
    RUBY
    symbols = result.by_layer("defs.constants").map(&:symbol)
    assert_equal ["Shop::Cart::MAX"], symbols
  end

  def test_qualified_constant_path_assignment
    result = AnalyzePipeline.run({ "a.rb" => <<~RUBY })
      module Foo
      end
      Foo::BAR = 1
    RUBY
    symbols = result.by_layer("defs.constants").map(&:symbol)
    assert_includes symbols, "Foo::BAR"
  end

  def test_multi_assign_constants
    result = AnalyzePipeline.run({ "a.rb" => "A, B = 1, 2\n" })
    symbols = result.by_layer("defs.constants").map(&:symbol).sort
    assert_equal %w[A B], symbols
  end

  def test_or_assign_constant
    result = AnalyzePipeline.run({ "a.rb" => "X ||= 1\n" })
    symbols = result.by_layer("defs.constants").map(&:symbol)
    assert_equal ["X"], symbols
  end

  def test_operator_assign_constant
    result = AnalyzePipeline.run({ "a.rb" => "COUNT = 0\nCOUNT += 1\n" })
    symbols = result.by_layer("defs.constants").map(&:symbol)
    assert_equal ["COUNT", "COUNT"], symbols
  end

  def test_refs_constants_resolves_to_a_defs_constants_symbol
    result = AnalyzePipeline.run({ "a.rb" => <<~RUBY })
      module Shop
        MAX = 10

        def self.limit
          MAX
        end
      end
    RUBY
    ref = result.by_layer("refs.constants").find { |m| m.role == "reference" }
    refute_nil ref
    assert_equal "Shop::MAX", ref.symbol
    assert_equal({ "resolved" => true }, ref.extra)
  end

  def test_without_all_constants_unresolved_reads_are_skipped
    result = AnalyzePipeline.run({ "a.rb" => "JSON.parse(x)\n" }, all_constants: false)
    assert_empty result.by_layer("refs.constants")
  end

  def test_with_all_constants_unresolved_reads_use_the_as_written_path_and_resolved_false
    result = AnalyzePipeline.run({ "a.rb" => "ActiveRecord::Base.new\n" }, all_constants: true)
    m = result.by_layer("refs.constants").find { |x| x.symbol == "ActiveRecord::Base" }
    refute_nil m
    assert_equal({ "resolved" => false }, m.extra)
  end

  def test_with_all_constants_resolved_reads_still_carry_resolved_true
    result = AnalyzePipeline.run({ "a.rb" => "MAX = 1\nMAX\n" }, all_constants: true)
    resolved = result.by_layer("refs.constants").select { |m| m.extra["resolved"] }
    assert_equal ["MAX"], resolved.map(&:symbol)
  end
end
