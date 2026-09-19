# frozen_string_literal: true

require_relative "test_helper"

class TracerSupportTest < Minitest::Test
  def test_line_index_span_trims_leading_and_trailing_whitespace
    bytes = "class Foo\n  def bar\n    1\n  end\nend\n"
    idx = TracerSupport::LineIndex.new(bytes)
    start, finish = idx.span(2)
    assert_equal "def bar", bytes.byteslice(start, finish - start)
  end

  def test_line_index_span_on_multibyte_content
    bytes = "# café ☕\nclass Foo\nend\n".b
    idx = TracerSupport::LineIndex.new(bytes)
    start, finish = idx.span(2)
    assert_equal "class Foo", bytes.byteslice(start, finish - start)
  end

  def test_normalize_inspect_collapses_default_object_inspect
    assert_equal "#<Invoice>", TracerSupport.normalize_inspect("#<Invoice:0x00007f9dd80a0000>")
    assert_equal "#<Invoice>", TracerSupport.normalize_inspect("#<Invoice:0x00007f9dd80a0000 @items=[10, 32]>")
    assert_equal "#<M::N>", TracerSupport.normalize_inspect("#<M::N:0x00007f9dd80a0000>")
  end

  def test_normalize_inspect_leaves_plain_values_untouched
    ["nil", "42", "[1, 2]", "\"hi\""].each { |v| assert_equal v, TracerSupport.normalize_inspect(v) }
  end

  def test_truncate_caps_at_80_chars
    long = "x" * 200
    assert_equal 80, TracerSupport.truncate(long).length
    assert_equal "short", TracerSupport.truncate("short")
  end
end
