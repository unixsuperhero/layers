# frozen_string_literal: true

require_relative "test_helper"

# Covers every row of docs/ROUND-4.md's effect table plus the explicit non-effects, using
# adapters/ruby/test/samples/effects/sample.rb run through the same pipeline as analyze.rb
# (AnalyzePipeline in test_helper.rb).
class EffectsTest < Minitest::Test
  def setup
    @path = File.join(SAMPLES, "effects", "sample.rb")
    @source = File.read(@path)
    @result = AnalyzePipeline.run({ "sample.rb" => @source }, all_constants: true)
  end

  def text_of(m)
    @source.byteslice(m.start...m.finish)
  end

  def only(layer)
    marks = @result.by_layer(layer)
    yield marks
  end

  def method_effects(symbol)
    m = @result.by_layer("defs.methods").find { |x| x.symbol == symbol }
    refute_nil m, "no defs.methods mark for #{symbol}"
    m.extra.fetch("effects")
  end

  # ---- effects.state -------------------------------------------------------------------

  def test_ivar_write_is_state_with_the_ivar_symbol
    marks = @result.by_layer("effects.state").select { |m| m.scope == "Widget#initialize" }
    assert_equal 1, marks.length
    assert_equal "Widget@items", marks.first.symbol
    assert_equal "write", marks.first.role
    assert_equal({ "kind" => "state" }, marks.first.extra)
  end

  def test_self_dot_attribute_writer_is_state_with_nil_symbol
    m = @result.by_layer("effects.state").find { |x| x.scope == "Widget#rename_log" }
    refute_nil m
    assert_nil m.symbol
    assert_equal "log", text_of(m)
  end

  def test_mutator_on_implicit_self_call_is_state
    m = @result.by_layer("effects.state").find { |x| x.scope == "Widget#clear_items" }
    refute_nil m
    assert_equal "clear", text_of(m)
    assert_nil m.symbol
  end

  def test_cvar_write_is_state
    marks = @result.by_layer("effects.state").select { |x| x.scope == "Widget#bump_count" }
    assert_equal 2, marks.length # ||= and +=
    assert(marks.all? { |m| m.symbol.nil? })
  end

  # ---- effects.args ---------------------------------------------------------------------

  def test_mutator_on_param_is_args
    m = @result.by_layer("effects.args").find { |x| x.scope == "Widget#append_to" }
    refute_nil m
    assert_equal "<<", text_of(m)
    assert_equal "Widget#append_to/list", m.symbol
    assert_equal({ "kind" => "args", "target" => "list" }, m.extra)
  end

  def test_mutator_at_the_end_of_a_multi_hop_attribute_chain_roots_at_the_param
    m = @result.by_layer("effects.args").find { |x| x.scope == "Widget#sort_items_of" }
    refute_nil m
    assert_equal "sort!", text_of(m)
    assert_equal "Widget#sort_items_of/order", m.symbol
    assert_equal "order", m.extra["target"]
  end

  # ---- non-effect: local mutation ---------------------------------------------------------

  def test_local_variable_mutation_is_not_an_effect
    assert_empty @result.marks.select { |m| m.scope == "Widget#local_mutation_is_fine" && m.layer.start_with?("effects.") }
  end

  # ---- effects.global ---------------------------------------------------------------------

  def test_global_variable_write_is_global_at_any_scope
    top = @result.by_layer("effects.global").find { |x| x.scope.nil? }
    refute_nil top, "top-level $counter = 0 should still get a mark (no verdict, but a mark)"
    inside = @result.by_layer("effects.global").find { |x| x.scope == "Widget#bump_global" }
    refute_nil inside
    assert_equal "$counter", text_of(inside)
  end

  def test_env_index_write_is_global_via_the_constant_receiver_root
    m = @result.by_layer("effects.global").find { |x| x.scope == "Widget#set_env" }
    refute_nil m
    assert_nil m.symbol
    assert_equal({ "kind" => "global" }, m.extra)
    assert_equal '["WIDGET_MODE"]', text_of(m)
  end

  def test_class_shape_change_inside_a_method_is_global
    m = @result.by_layer("effects.global").find { |x| x.scope == "Widget#add_dynamic_reader" }
    refute_nil m
    assert_equal "attr_reader", text_of(m)
  end

  def test_class_shape_call_at_class_body_level_is_not_an_effect
    # attr_reader/attr_writer at the top of Widget (not inside a method) must produce NO
    # effects.* mark at all (and certainly not effects.unknown).
    refute @result.marks.any? { |m| m.layer.start_with?("effects.") && m.scope.nil? && text_of(m) == "attr_reader" }
  end

  # ---- effects.io -----------------------------------------------------------------------

  def test_io_whats
    whats = @result.by_layer("effects.io").each_with_object({}) { |m, h| h[m.scope] = m.extra["what"] }
    assert_equal "output", whats["Widget#announce"]
    assert_equal "file", whats["Widget#touch_disk"]
    assert_equal "random", whats["Widget#pick_random"]
    assert_equal "time", whats["Widget#stamp"]
    assert_equal "process", whats["Widget#run_shell"]
  end

  # ---- effects.control --------------------------------------------------------------------

  def test_raise_is_control
    m = @result.by_layer("effects.control").find { |x| x.scope == "Widget#announce" }
    refute_nil m
    assert_equal "raise", text_of(m)
  end

  # ---- verdicts: pure ----------------------------------------------------------------------

  def test_pure_method
    assert_equal "pure", method_effects("Widget#pure_calc")["verdict"]
  end

  def test_method_that_only_calls_a_pure_project_method_is_pure
    effects = method_effects("Widget#uses_pure_project_method")
    assert_equal "pure", effects["verdict"]
    assert_empty effects["via"]
  end

  def test_known_pure_core_calls_produce_no_unknown_marks
    effects = method_effects("Widget#pure_pipeline")
    assert_equal "pure", effects["verdict"]
    refute @result.marks.any? { |m| m.layer == "effects.unknown" && m.scope == "Widget#pure_pipeline" }
  end

  def test_effect_inside_a_block_counts_for_the_enclosing_method
    effects = method_effects("Widget#log_each")
    assert_equal "impure", effects["verdict"]
    assert_includes effects["direct"], "state"
    m = @result.by_layer("effects.state").find { |x| x.scope == "Widget#log_each" }
    refute_nil m
  end

  # ---- verdicts: impure via a resolved call ------------------------------------------------

  def test_caller_of_an_impure_method_is_impure_via_it_with_correct_via
    effects = method_effects("Widget#notify")
    assert_equal "impure", effects["verdict"]
    assert_empty effects["direct"]
    assert_equal ["Widget#announce"], effects["via"]["io"]
    assert_equal ["Widget#announce"], effects["via"]["control"]

    calls_mark = @result.by_layer("effects.calls").find { |x| x.scope == "Widget#notify" }
    refute_nil calls_mark
    assert_equal "Widget#announce", calls_mark.symbol
    assert_equal %w[control io], calls_mark.extra["effects"].sort
  end

  # ---- verdicts: .new drops the callee's state -----------------------------------------------

  def test_new_of_a_class_whose_initialize_writes_ivars_does_not_make_the_caller_impure
    assert_equal "impure", method_effects("Box#initialize")["verdict"]
    make_box = method_effects("main#make_box")
    assert_equal "pure", make_box["verdict"]
    assert_empty make_box["via"]
    refute @result.marks.any? { |m| m.layer == "effects.calls" && text_of(m) == "new" }
  end

  # ---- verdicts: mutual recursion terminates -------------------------------------------------

  def test_mutual_recursion_terminates_and_resolves_to_pure
    assert_equal "pure", method_effects("Widget#ping")["verdict"]
    assert_equal "pure", method_effects("Widget#pong")["verdict"]
  end

  # ---- effects.unknown --------------------------------------------------------------------

  def test_unresolved_uncatalogued_call_is_unknown
    m = @result.by_layer("effects.unknown").find { |x| x.scope == "Widget#call_unknown_thing" }
    refute_nil m
    assert_equal "frobnicate", m.extra["name"]
    assert_equal "unknown", method_effects("Widget#call_unknown_thing")["verdict"]
  end

  def test_yield_is_unknown
    m = @result.by_layer("effects.unknown").find { |x| x.scope == "Widget#call_the_block" }
    refute_nil m
    assert_equal "yield", text_of(m)
    assert_equal "yield", m.extra["name"]
  end

  def test_dynamic_dispatch_is_always_unknown
    m = @result.by_layer("effects.unknown").find { |x| x.scope == "Widget#call_dynamically" }
    refute_nil m
    assert_equal "send", m.extra["name"]
  end

  # ---- constants --------------------------------------------------------------------------

  def test_constant_assignment_at_class_level_is_defs_constants_not_effects_global
    m = @result.by_layer("defs.constants").find { |x| x.symbol == "Widget::MAX" }
    refute_nil m
    assert_equal "definition", m.role
    assert_nil m.scope
    refute @result.marks.any? { |x| x.layer == "effects.global" && x.scope.nil? && text_of(x) == "MAX" }
  end

  # Ruby forbids constant assignment lexically inside ANY `def` (a real SyntaxError -- Prism
  # rejects it too, verified: `Prism.parse("def f\n X = 1\nend\n").success?` is false), so
  # "inside a method it is both defs.constants and effects.global" can never be reached via a
  # parseable .rb file. This exercises the mechanism directly instead.
  def test_constant_assignment_inside_a_method_is_both_defs_constants_and_effects_global
    result = Prism.parse("X = 1\n")
    node = result.value.statements.body.first

    sv = StaticVisitor.new("a.rb")
    sv.instance_variable_set(:@method_symbol, "Foo#bar")
    sv.visit_constant_write_node(node)
    assert_equal 1, sv.def_marks.select { |m| m.layer == "defs.constants" }.length
    assert_equal "Foo#bar", sv.def_marks.first.scope

    ev = EffectsVisitor.new("a.rb")
    ev.instance_variable_set(:@method_symbol, "Foo#bar")
    ev.visit_constant_write_node(node)
    global_marks = ev.effect_marks.select { |m| m.layer == "effects.global" }
    assert_equal 1, global_marks.length
    assert_equal "Foo#bar", global_marks.first.scope
  end
end
