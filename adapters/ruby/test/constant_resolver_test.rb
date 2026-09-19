# frozen_string_literal: true

require_relative "test_helper"

class ConstantResolverTest < Minitest::Test
  def index_for(class_names)
    ProjectIndex.new(class_names.map { |n| StaticVisitor::DefRecord.new(owner: nil, name: n, kind: :class, symbol: n) })
  end

  def test_resolves_a_top_level_class_reference
    index = index_for(["Invoice"])
    assert_equal "Invoice", ConstantResolver.resolve_one("Invoice", [], index)
  end

  def test_resolves_by_nearest_enclosing_namespace_first
    index = index_for(["Foo::Bar", "Bar"])
    # referenced from inside module Foo -- Foo::Bar should win over the top-level Bar
    assert_equal "Foo::Bar", ConstantResolver.resolve_one("Bar", ["Foo"], index)
  end

  def test_falls_back_to_top_level_when_not_nested
    index = index_for(["Bar"])
    assert_equal "Bar", ConstantResolver.resolve_one("Bar", ["Foo"], index)
  end

  def test_unresolved_constant_is_skipped
    index = index_for(["Invoice"])
    assert_nil ConstantResolver.resolve_one("String", [], index)
  end
end
