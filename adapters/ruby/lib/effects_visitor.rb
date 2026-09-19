# frozen_string_literal: true

require "set"
require "prism"
require_relative "symbols"
require_relative "effect_catalog"
require_relative "static_visitor"

# Walks one file's Prism AST (a SECOND, independent pass from StaticVisitor) and produces the
# DIRECT effects.* marks from docs/ROUND-4.md ("Effect kinds -> layers" / "Receiver root
# analysis" / catalogs in effect_catalog.rb), plus the bookkeeping the fixpoint pass
# (lib/effect_verdicts.rb) needs afterwards:
#   - effect_marks:   final effects.state / .global / .args / .io / .control / .unknown marks
#   - direct_kinds:   { method_symbol => Set<kind> } -- this method's OWN direct effect kinds
#                      (top-level marks have scope nil and are excluded from this map --
#                      "top-level code gets marks but no verdict")
#   - raw_effect_calls: PendingCall rows for calls that are none of the above (mutator / io /
#                      control / class-shape / dynamic-dispatch / known-pure) -- resolved
#                      against the project's refs.calls index in lib/effect_verdicts.rb, since
#                      that needs every file's definitions visited first.
#
# Effects inside a block are attributed to the enclosing METHOD: blocks/lambdas only push a
# new PARAMETER frame (for receiver-root resolution), they never change @method_symbol.
class EffectsVisitor < Prism::Visitor
  PendingCall = Struct.new(:file, :start, :finish, :message, :scope, :drop_state, keyword_init: true)

  attr_reader :effect_marks, :direct_kinds, :raw_effect_calls

  def initialize(file)
    super()
    @file = file
    @nesting = []          # constant names, outer -> inner (class/module nesting)
    @method_symbol = nil   # current enclosing method's symbol, or nil at top level
    @param_frames = [Set.new] # stack of Set<name> -- one per active method/block/lambda frame

    @effect_marks = []
    @direct_kinds = Hash.new { |h, k| h[k] = Set.new }
    @raw_effect_calls = []
  end

  # ---- mark emission -------------------------------------------------------------

  def emit(layer, start_offset, finish_offset, symbol:, role:, kind_data:)
    @effect_marks << StaticVisitor::Mark.new(layer: layer, file: @file, start: start_offset,
                                              finish: finish_offset, symbol: symbol, role: role,
                                              scope: @method_symbol, extra: kind_data)
    @direct_kinds[@method_symbol] << kind_data["kind"] if @method_symbol
  end

  def owner
    @nesting.empty? ? nil : Symbols.qualify(@nesting)
  end

  # ---- class / module nesting -----------------------------------------------------

  def visit_class_node(node)
    @nesting.push(constant_path_text(node.constant_path))
    visit(node.superclass) if node.superclass
    visit(node.body) if node.body
    @nesting.pop
  end

  def visit_module_node(node)
    @nesting.push(constant_path_text(node.constant_path))
    visit(node.body) if node.body
    @nesting.pop
  end

  def constant_path_text(node)
    case node
    when Prism::ConstantReadNode
      node.name.to_s
    when Prism::ConstantPathNode
      node.parent ? "#{constant_path_text(node.parent)}::#{node.name}" : node.name.to_s
    else
      node.slice
    end
  end

  # ---- methods ----------------------------------------------------------------------

  def visit_def_node(node)
    singleton = node.receiver.is_a?(Prism::SelfNode)
    symbol = Symbols.method_symbol(owner, node.name, singleton: singleton)

    outer_symbol = @method_symbol
    outer_frames = @param_frames
    @method_symbol = symbol
    @param_frames = [Set.new]

    visit(node.parameters) if node.parameters
    visit(node.body) if node.body

    @method_symbol = outer_symbol
    @param_frames = outer_frames
  end

  # ---- parameters: bind names into the current (innermost) frame --------------------

  def visit_required_parameter_node(node)
    @param_frames.last << node.name.to_s
  end

  def visit_optional_parameter_node(node)
    @param_frames.last << node.name.to_s
    visit(node.value)
  end

  def visit_rest_parameter_node(node)
    @param_frames.last << node.name.to_s if node.name
  end

  def visit_keyword_rest_parameter_node(node)
    @param_frames.last << node.name.to_s if node.name
  end

  def visit_required_keyword_parameter_node(node)
    @param_frames.last << node.name.to_s
  end

  def visit_optional_keyword_parameter_node(node)
    @param_frames.last << node.name.to_s
    visit(node.value)
  end

  def visit_block_parameter_node(node)
    @param_frames.last << node.name.to_s if node.name
  end

  def visit_block_local_variable_node(node)
    @param_frames.last << node.name.to_s
  end

  # ---- blocks / lambdas: open a new parameter frame ----------------------------------

  def visit_block_node(node)
    @param_frames.push(Set.new)
    visit_child_nodes(node)
    @param_frames.pop
  end
  alias visit_lambda_node visit_block_node

  def param_bound?(name, depth)
    idx = @param_frames.length - 1 - depth
    idx = 0 if idx.negative?
    frame = @param_frames[idx] || @param_frames.last
    frame.include?(name)
  end

  # ---- receiver-root analysis (docs/ROUND-4.md "Receiver root analysis") ------------
  #
  # Returns [:local | :param | :self | :ivar | :const | :unknown, name-or-nil].
  # Walks a chain of plain (zero-arg, no-block, non-write) attribute-style calls down to
  # its root; a nil receiver on the OUTERMOST mutator call itself means "implicit self".
  def receiver_root(node)
    case node
    when nil
      [:self, nil]
    when Prism::SelfNode
      [:self, nil]
    when Prism::InstanceVariableReadNode
      [:ivar, node.name.to_s.sub(/\A@/, "")]
    when Prism::ConstantReadNode, Prism::ConstantPathNode
      [:const, nil]
    when Prism::LocalVariableReadNode
      param_bound?(node.name.to_s, node.depth) ? [:param, node.name.to_s] : [:local, nil]
    when Prism::CallNode
      if node.receiver.nil?
        node.variable_call? ? [:self, nil] : [:unknown, nil]
      elsif !node.attribute_write? && node.arguments.nil? && node.block.nil?
        receiver_root(node.receiver) # peel one more plain attribute-style hop
      else
        [:unknown, nil]
      end
    else
      [:unknown, nil]
    end
  end

  def handle_mutator_like(receiver, message, start_offset, finish_offset)
    kind, name = receiver.nil? ? [:self, nil] : receiver_root(receiver)

    case kind
    when :local
      # local mutation is not an effect (docs/ROUND-4.md)
    when :param
      prefix = Symbols.local_scope_prefix(@method_symbol)
      psym = Symbols.local_symbol(prefix, name)
      emit("effects.args", start_offset, finish_offset, symbol: psym, role: "reference",
           kind_data: { "kind" => "args", "target" => name })
    when :self
      emit("effects.state", start_offset, finish_offset, symbol: nil, role: "write",
           kind_data: { "kind" => "state" })
    when :ivar
      emit("effects.state", start_offset, finish_offset, symbol: Symbols.ivar_symbol(owner, name),
           role: "write", kind_data: { "kind" => "state" })
    when :const
      emit("effects.global", start_offset, finish_offset, symbol: nil, role: "write",
           kind_data: { "kind" => "global" })
    when :unknown
      emit("effects.unknown", start_offset, finish_offset, symbol: nil, role: "reference",
           kind_data: { "kind" => "unknown", "name" => message })
    end
  end

  def mutator_name?(name)
    name.end_with?("!") || EffectCatalog::MUTATOR_NAMES.include?(name)
  end

  # ---- calls --------------------------------------------------------------------------

  def visit_call_node(node)
    classify_call(node) if node.message_loc
    visit(node.receiver) if node.receiver
    visit(node.arguments) if node.arguments
    visit(node.block) if node.block
  end

  def classify_call(node)
    name = node.name.to_s
    start_offset = node.message_loc.start_offset
    finish_offset = node.message_loc.end_offset

    if node.attribute_write? || mutator_name?(name)
      handle_mutator_like(node.receiver, name, start_offset, finish_offset)
    elsif (what = EffectCatalog.io_what(node.receiver, name))
      emit("effects.io", start_offset, finish_offset, symbol: nil, role: "reference",
           kind_data: { "kind" => "io", "what" => what })
    elsif EffectCatalog::CONTROL_NAMES.include?(name)
      emit("effects.control", start_offset, finish_offset, symbol: nil, role: "reference",
           kind_data: { "kind" => "control" })
    elsif EffectCatalog::CLASS_SHAPE_NAMES.include?(name)
      # Only an effect INSIDE a method (docs/ROUND-4.md); at class-body level this is
      # ordinary class definition (e.g. `attr_reader :x`, `include Comparable`) -- never a
      # pending call either, so it can't fall through to effects.unknown below.
      emit("effects.global", start_offset, finish_offset, symbol: nil, role: "write",
           kind_data: { "kind" => "global" }) if @method_symbol
    elsif EffectCatalog::DYNAMIC_DISPATCH_NAMES.include?(name)
      emit("effects.unknown", start_offset, finish_offset, symbol: nil, role: "reference",
           kind_data: { "kind" => "unknown", "name" => name })
    elsif EffectCatalog::KNOWN_PURE_NAMES.include?(name) || EffectCatalog::OPERATOR_NAMES.include?(name)
      # pure / operator -- no mark, and not a call edge either
    else
      record_pending_call(node, name, start_offset, finish_offset)
    end
  end

  def record_pending_call(node, name, start_offset, finish_offset)
    drop_state = node.name == :new &&
                 (node.receiver.is_a?(Prism::ConstantReadNode) || node.receiver.is_a?(Prism::ConstantPathNode))
    @raw_effect_calls << PendingCall.new(file: @file, start: start_offset, finish: finish_offset,
                                          message: name, scope: @method_symbol, drop_state: drop_state)
  end

  # `yield` -- always unknown (the block could do anything); attributed to the enclosing method.
  def visit_yield_node(node)
    emit("effects.unknown", node.keyword_loc.start_offset, node.keyword_loc.end_offset, symbol: nil,
         role: "reference", kind_data: { "kind" => "unknown", "name" => "yield" })
    visit(node.arguments) if node.arguments
  end

  # Backtick / %x() process execution -- a literal node, not a call.
  def visit_x_string_node(node)
    emit_process_io(node.location)
  end

  def visit_interpolated_x_string_node(node)
    emit_process_io(node.location)
    visit_child_nodes(node)
  end

  def emit_process_io(loc)
    emit("effects.io", loc.start_offset, loc.end_offset, symbol: nil, role: "reference",
         kind_data: { "kind" => "io", "what" => "process" })
  end

  # ---- instance variables: writes are effects.state ------------------------------------

  def visit_instance_variable_write_node(node)
    emit_ivar_state(node.name, node.name_loc)
    visit(node.value)
  end

  def visit_instance_variable_operator_write_node(node)
    emit_ivar_state(node.name, node.name_loc)
    visit(node.value)
  end

  def visit_instance_variable_and_write_node(node)
    emit_ivar_state(node.name, node.name_loc)
    visit(node.value)
  end

  def visit_instance_variable_or_write_node(node)
    emit_ivar_state(node.name, node.name_loc)
    visit(node.value)
  end

  def visit_instance_variable_target_node(node)
    emit_ivar_state(node.name, node.location)
  end

  def emit_ivar_state(name, loc)
    sym = Symbols.ivar_symbol(owner, name.to_s.sub(/\A@/, ""))
    emit("effects.state", loc.start_offset, loc.end_offset, symbol: sym, role: "write",
         kind_data: { "kind" => "state" })
  end

  # ---- class variables: writes are effects.state (no symbol -- no vars.cvars layer) -----

  def visit_class_variable_write_node(node)
    emit_state_no_symbol(node.name_loc)
    visit(node.value)
  end

  def visit_class_variable_operator_write_node(node)
    emit_state_no_symbol(node.name_loc)
    visit(node.value)
  end

  def visit_class_variable_and_write_node(node)
    emit_state_no_symbol(node.name_loc)
    visit(node.value)
  end

  def visit_class_variable_or_write_node(node)
    emit_state_no_symbol(node.name_loc)
    visit(node.value)
  end

  def visit_class_variable_target_node(node)
    emit_state_no_symbol(node.location)
  end

  def emit_state_no_symbol(loc)
    emit("effects.state", loc.start_offset, loc.end_offset, symbol: nil, role: "write",
         kind_data: { "kind" => "state" })
  end

  # ---- global variables: writes are effects.global ---------------------------------------

  def visit_global_variable_write_node(node)
    emit_global(node.name_loc)
    visit(node.value)
  end

  def visit_global_variable_operator_write_node(node)
    emit_global(node.name_loc)
    visit(node.value)
  end

  def visit_global_variable_and_write_node(node)
    emit_global(node.name_loc)
    visit(node.value)
  end

  def visit_global_variable_or_write_node(node)
    emit_global(node.name_loc)
    visit(node.value)
  end

  def visit_global_variable_target_node(node)
    emit_global(node.location)
  end

  def emit_global(loc)
    emit("effects.global", loc.start_offset, loc.end_offset, symbol: nil, role: "write",
         kind_data: { "kind" => "global" })
  end

  # ---- constants: (re)assignment is effects.global ONLY inside a method ------------------
  # (defs.constants itself -- always -- is StaticVisitor's job; see static_visitor.rb)

  def visit_constant_write_node(node)
    emit_const_global(node.name_loc) if @method_symbol
    visit(node.value)
  end

  def visit_constant_operator_write_node(node)
    emit_const_global(node.name_loc) if @method_symbol
    visit(node.value)
  end

  def visit_constant_and_write_node(node)
    emit_const_global(node.name_loc) if @method_symbol
    visit(node.value)
  end

  def visit_constant_or_write_node(node)
    emit_const_global(node.name_loc) if @method_symbol
    visit(node.value)
  end

  def visit_constant_target_node(node)
    emit_const_global(node.location) if @method_symbol
  end

  def visit_constant_path_write_node(node)
    emit_const_global(node.target.location) if @method_symbol
    visit(node.value)
  end

  def visit_constant_path_operator_write_node(node)
    emit_const_global(node.target.location) if @method_symbol
    visit(node.value)
  end

  def visit_constant_path_and_write_node(node)
    emit_const_global(node.target.location) if @method_symbol
    visit(node.value)
  end

  def visit_constant_path_or_write_node(node)
    emit_const_global(node.target.location) if @method_symbol
    visit(node.value)
  end

  def visit_constant_path_target_node(node)
    emit_const_global(node.location) if @method_symbol
  end

  def emit_const_global(loc)
    emit("effects.global", loc.start_offset, loc.end_offset, symbol: nil, role: "write",
         kind_data: { "kind" => "global" })
  end
end
