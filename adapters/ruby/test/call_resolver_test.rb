# frozen_string_literal: true

require_relative "test_helper"

class CallResolverTest < Minitest::Test
  def index_for(records)
    ProjectIndex.new(records.map { |r| StaticVisitor::DefRecord.new(**r) })
  end

  def raw_call(**overrides)
    defaults = { file: "a.rb", start: 0, finish: 1, message: "x", shape: :self, owner_text: nil,
                 nesting: [], self_owner: nil, self_singleton: false, scope: nil }
    StaticVisitor::RawCall.new(**defaults.merge(overrides))
  end

  def test_new_resolves_to_initialize_when_defined
    index = index_for([{ owner: nil, name: "Invoice", kind: :class, symbol: "Invoice" },
                        { owner: "Invoice", name: "initialize", kind: :instance, symbol: "Invoice#initialize" }])
    rc = raw_call(shape: :const, owner_text: "Invoice", message: "new")
    assert_equal "Invoice#initialize", CallResolver.resolve_one(rc, index)
  end

  def test_new_is_skipped_when_no_initialize_or_singleton_new_defined
    index = index_for([{ owner: nil, name: "Mailer", kind: :class, symbol: "Mailer" }])
    rc = raw_call(shape: :const, owner_text: "Mailer", message: "new")
    assert_nil CallResolver.resolve_one(rc, index)
  end

  def test_explicit_constant_receiver_resolves_to_singleton_method_if_defined
    index = index_for([{ owner: nil, name: "Widget", kind: :class, symbol: "Widget" },
                        { owner: "Widget", name: "build", kind: :singleton, symbol: "Widget.build" }])
    rc = raw_call(shape: :const, owner_text: "Widget", message: "build")
    assert_equal "Widget.build", CallResolver.resolve_one(rc, index)
  end

  def test_explicit_constant_receiver_skipped_when_undefined
    index = index_for([{ owner: nil, name: "Widget", kind: :class, symbol: "Widget" }])
    rc = raw_call(shape: :const, owner_text: "Widget", message: "nope")
    assert_nil CallResolver.resolve_one(rc, index)
  end

  def test_self_shape_resolves_within_enclosing_class_including_attrs
    index = index_for([{ owner: "Invoice", name: "items", kind: :attr, symbol: "Invoice#items" }])
    rc = raw_call(shape: :self, message: "items", self_owner: "Invoice")
    assert_equal "Invoice#items", CallResolver.resolve_one(rc, index)
  end

  def test_self_shape_does_not_fall_back_to_project_wide_search
    index = index_for([{ owner: "Elsewhere", name: "puts_like", kind: :instance, symbol: "Elsewhere#puts_like" }])
    rc = raw_call(shape: :self, message: "puts_like", self_owner: "Invoice")
    assert_nil CallResolver.resolve_one(rc, index)
  end

  def test_other_shape_resolves_when_exactly_one_project_wide_match
    index = index_for([{ owner: "Invoice", name: "summary", kind: :instance, symbol: "Invoice#summary" }])
    rc = raw_call(shape: :other, message: "summary")
    assert_equal "Invoice#summary", CallResolver.resolve_one(rc, index)
  end

  def test_other_shape_skipped_when_zero_or_multiple_matches
    index = index_for([{ owner: "A", name: "run", kind: :instance, symbol: "A#run" },
                        { owner: "B", name: "run", kind: :instance, symbol: "B#run" }])
    rc = raw_call(shape: :other, message: "run")
    assert_nil CallResolver.resolve_one(rc, index)

    rc2 = raw_call(shape: :other, message: "nowhere")
    assert_nil CallResolver.resolve_one(rc2, index)
  end
end
