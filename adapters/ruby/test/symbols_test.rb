# frozen_string_literal: true

require_relative "test_helper"

class SymbolsTest < Minitest::Test
  def test_qualify_joins_nesting_with_double_colon
    assert_equal "Foo::Bar", Symbols.qualify(%w[Foo Bar])
    assert_equal "Foo", Symbols.qualify(%w[Foo])
  end

  def test_method_symbol_instance_singleton_and_top_level
    assert_equal "Invoice#summary", Symbols.method_symbol("Invoice", "summary", singleton: false)
    assert_equal "Invoice.summary", Symbols.method_symbol("Invoice", "summary", singleton: true)
    assert_equal "main#summary", Symbols.method_symbol(nil, "summary", singleton: false)
    assert_equal "main#summary", Symbols.method_symbol(nil, "summary", singleton: true)
  end

  def test_attr_symbol
    assert_equal "Invoice#items", Symbols.attr_symbol("Invoice", "items")
    assert_equal "main#items", Symbols.attr_symbol(nil, "items")
  end

  def test_ivar_symbol
    assert_equal "Invoice@items", Symbols.ivar_symbol("Invoice", "items")
    assert_equal "main@items", Symbols.ivar_symbol(nil, "items")
  end

  def test_local_scope_prefix_defaults_to_main
    assert_equal "main", Symbols.local_scope_prefix(nil)
    assert_equal "Invoice#summary", Symbols.local_scope_prefix("Invoice#summary")
  end

  def test_local_symbol_with_and_without_shadow_line
    assert_equal "Invoice#summary/total", Symbols.local_symbol("Invoice#summary", "total")
    assert_equal "Invoice#summary/total@11", Symbols.local_symbol("Invoice#summary", "total", shadow_line: 11)
  end
end
