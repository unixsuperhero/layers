# frozen_string_literal: true

require_relative "test_helper"

class ScopeIndexTest < Minitest::Test
  def test_finds_the_innermost_method_containing_an_offset
    spans = [
      ScopeIndex::MethodSpan.new(file: "a.rb", start: 0, finish: 100, symbol: "Outer#m"),
      ScopeIndex::MethodSpan.new(file: "a.rb", start: 10, finish: 20, symbol: "Outer#inner"),
    ]
    index = ScopeIndex.new(spans)
    assert_equal "Outer#inner", index.scope_at("a.rb", 15) # innermost wins
    assert_equal "Outer#m", index.scope_at("a.rb", 50)
    assert_nil index.scope_at("a.rb", 200)
    assert_nil index.scope_at("other.rb", 15)
  end
end
