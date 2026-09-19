# frozen_string_literal: true

require_relative "test_helper"

class StaticVisitorTest < Minitest::Test
  def visit(source, file: "a.rb")
    result = Prism.parse(source, filepath: file)
    assert result.success?, result.errors.map(&:message).join("; ")
    v = StaticVisitor.new(file)
    v.visit(result.value)
    v
  end

  def marks_named(marks, layer)
    marks.select { |m| m.layer == layer }
  end

  def test_nested_module_and_compact_class_path_are_both_qualified
    v = visit(<<~RUBY)
      module Foo
        module Bar
          class Baz
          end
        end
      end

      class Foo::Other
      end
    RUBY
    symbols = marks_named(v.def_marks, "defs.classes").map(&:symbol)
    assert_includes symbols, "Foo"
    assert_includes symbols, "Foo::Bar"
    assert_includes symbols, "Foo::Bar::Baz"
    assert_includes symbols, "Foo::Other"
  end

  def test_keyword_param_marks_exclude_the_trailing_colon
    source = <<~RUBY
      class Cart
        def total(tax: 0.1, round:)
          tax + round
        end
      end
    RUBY
    v = visit(source)
    texts = marks_named(v.var_marks, "vars.locals").select { |m| m.role == "write" }
                                                   .map { |m| source.byteslice(m.start...m.finish) }
    assert_equal %w[tax round], texts
  end

  def test_def_self_is_a_singleton_method_symbol
    v = visit(<<~RUBY)
      class Widget
        def self.build
          new
        end
      end
    RUBY
    m = marks_named(v.def_marks, "defs.methods").find { |x| x.symbol == "Widget.build" }
    refute_nil m
    assert_equal "definition", m.role
  end

  def test_top_level_def_uses_main_scheme
    v = visit("def helper(x)\n  x\nend\n")
    m = marks_named(v.def_marks, "defs.methods").first
    assert_equal "main#helper", m.symbol
    # CONTRACT: "A defs.methods mark's scope is the method itself" -- unconditionally, top-level included.
    assert_equal "main#helper", m.scope
  end

  def test_defs_methods_mark_data_scope_is_the_method_itself
    v = visit("class C\n  def m\n  end\nend\n")
    m = marks_named(v.def_marks, "defs.methods").first
    assert_equal "C#m", m.symbol
    assert_equal "C#m", m.scope
  end

  def test_attr_reader_writer_accessor_all_use_hash_scheme
    v = visit(<<~RUBY)
      class Invoice
        attr_reader :a
        attr_writer :b
        attr_accessor :c
      end
    RUBY
    symbols = marks_named(v.def_marks, "defs.attributes").map(&:symbol)
    assert_equal %w[Invoice#a Invoice#b Invoice#c], symbols.sort
  end

  def test_ivar_read_and_write_are_scoped_to_the_enclosing_class
    v = visit(<<~RUBY)
      class Invoice
        def initialize
          @items = []
        end

        def items
          @items
        end
      end
    RUBY
    ivars = marks_named(v.var_marks, "vars.ivars")
    assert_equal ["Invoice@items"], ivars.map(&:symbol).uniq
    assert_equal %w[read write], ivars.map(&:role).sort
  end

  def test_block_that_mutates_an_outer_local_is_not_a_temp
    v = visit(<<~RUBY)
      def run(seed)
        total = seed
        [1, 2].each do |n|
          total += n
        end
        total
      end
    RUBY
    temps = marks_named(v.var_marks, "vars.temps").map(&:symbol)
    refute_includes temps, "main#run/total"
  end

  def test_shadowing_block_param_gets_a_line_suffix
    v = visit(<<~RUBY)
      def m(total)
        [1, 2].each do |total|
          total * 2
        end
        total
      end
    RUBY
    locals = marks_named(v.var_marks, "vars.locals")
    plain = locals.select { |x| x.symbol == "main#m/total" }
    shadowed = locals.select { |x| x.symbol&.start_with?("main#m/total@") }
    assert_equal 2, plain.length   # the param decl + the final bare `total`
    assert_equal 2, shadowed.length # the block param decl + the read inside the block
  end

  def test_non_shadowing_block_param_has_no_line_suffix
    v = visit(<<~RUBY)
      def m
        [1, 2].each do |item|
          item
        end
      end
    RUBY
    locals = marks_named(v.var_marks, "vars.locals")
    assert_equal ["main#m/item"], locals.map(&:symbol).uniq
  end

  def test_top_level_locals_use_main_prefix_and_are_never_temps
    v = visit("x = 1\ny = x\n")
    locals = marks_named(v.var_marks, "vars.locals")
    assert_equal ["main/x", "main/x", "main/y"].sort, locals.map(&:symbol).sort
    assert_empty marks_named(v.var_marks, "vars.temps")
  end

  def test_a_local_with_two_writes_is_not_a_temp
    v = visit("def m\n  x = 1\n  x = 2\n  x\nend\n")
    assert_empty marks_named(v.var_marks, "vars.temps")
  end

  def test_a_local_with_three_reads_is_not_a_temp
    v = visit("def m\n  x = 1\n  x\n  x\n  x\nend\n")
    assert_empty marks_named(v.var_marks, "vars.temps")
  end
end
