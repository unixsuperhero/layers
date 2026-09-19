# frozen_string_literal: true

require "prism"
require_relative "symbols"
require_relative "scope_index"

# Walks one file's Prism AST and produces:
#   - def_marks:  defs.classes / defs.methods / defs.attributes marks (final)
#   - var_marks:  vars.locals / vars.ivars / vars.temps marks (final; purely local to the file)
#   - def_records: structured (owner, name, kind, symbol) rows, used to build the
#                   cross-file ProjectIndex (see project_index.rb)
#   - raw_constants / raw_calls: unresolved occurrences, resolved in a second pass
#                   once every file has been visited (see constant_resolver.rb / call_resolver.rb)
class StaticVisitor < Prism::Visitor
  # `extra`: optional extra data.* fields beyond `scope` (round 4: data.effects, data.resolved).
  # Defaults to nil (unset) for every existing call site -- doc_writer merges it in when present.
  Mark = Struct.new(:layer, :file, :start, :finish, :symbol, :role, :scope, :extra, keyword_init: true)
  DefRecord = Struct.new(:owner, :name, :kind, :symbol, keyword_init: true) # kind: :instance | :singleton | :attr | :class

  RawConstant = Struct.new(:file, :start, :finish, :name, :nesting, :scope, keyword_init: true)
  RawCall = Struct.new(:file, :start, :finish, :message, :shape, :owner_text, :nesting, :self_owner,
                        :self_singleton, :scope, keyword_init: true)

  attr_reader :def_marks, :var_marks, :def_records, :raw_constants, :raw_calls, :method_spans

  def initialize(file)
    super()
    @file = file
    @def_marks = []
    @var_marks = []
    @def_records = []
    @raw_constants = []
    @raw_calls = []
    @method_spans = [] # ScopeIndex::MethodSpan, full "def ... end" extent of every method

    @nesting = []            # constant names, outer -> inner
    @method_symbol = nil     # current enclosing method's symbol, or nil
    @method_singleton = false
    @scope_stack = [new_scope] # stack of local-var scopes; grows on def, frames grow on block
  end

  # ---- scope bookkeeping -------------------------------------------------

  # `frames` is append-only (every block frame ever opened in this scope, so a symbol's
  # shadow-suffix line is still known once the block has closed); `active` is the current
  # nesting stack of indices into `frames`, used to resolve a node's `depth` to a frame.
  Scope = Struct.new(:prefix, :data_scope, :frames, :active, :occurrences, keyword_init: true)
  Frame = Struct.new(:open_line, keyword_init: true)
  Occurrence = Struct.new(:name, :start, :finish, :role, :param, :frame_index, keyword_init: true)

  def new_scope(prefix: "main", data_scope: nil, open_line: 0)
    Scope.new(prefix: prefix, data_scope: data_scope, frames: [Frame.new(open_line: open_line)],
              active: [0], occurrences: [])
  end

  def current_scope
    @scope_stack.last
  end

  def frame_index_for_depth(scope, depth)
    idx = scope.active.length - 1 - depth
    idx = 0 if idx.negative?
    scope.active[idx]
  end

  def record_occurrence(name, loc, role:, param: false)
    scope = current_scope
    scope.occurrences << Occurrence.new(
      name: name.to_s, start: loc.start_offset, finish: loc.end_offset,
      role: role, param: param, frame_index: frame_index_for_depth(scope, 0),
    )
  end

  def record_occurrence_with_depth(name, loc, depth, role:)
    scope = current_scope
    scope.occurrences << Occurrence.new(
      name: name.to_s, start: loc.start_offset, finish: loc.end_offset,
      role: role, param: false, frame_index: frame_index_for_depth(scope, depth),
    )
  end

  def finalize_scope(scope)
    # Group by bare name first: a name used at >1 distinct frame is a shadow, and every
    # occurrence bound to a non-root frame then gets an "@<line the block opens>" suffix
    # (root-frame occurrences keep the plain "<prefix>/<name>" symbol either way).
    by_symbol = Hash.new { |h, k| h[k] = [] }
    scope.occurrences.group_by(&:name).each_value do |occs|
      shadow = occs.map(&:frame_index).uniq.length > 1
      occs.each do |occ|
        shadow_line = shadow && occ.frame_index.positive? ? scope.frames[occ.frame_index].open_line : nil
        symbol = Symbols.local_symbol(scope.prefix, occ.name, shadow_line: shadow_line)
        by_symbol[symbol] << occ
      end
    end

    by_symbol.each do |symbol, occs|
      occs.each do |occ|
        @var_marks << Mark.new(layer: "vars.locals", file: @file, start: occ.start, finish: occ.finish,
                                symbol: symbol, role: occ.role, scope: scope.data_scope)
      end

      # vars.temps: kind local (not param), exactly 1 write, <=2 reads, never touched in a nested block.
      # Top-level ("main") locals are never temps -- only a method's own short-lived values count.
      next if scope.data_scope.nil?
      next if occs.any?(&:param)
      next if occs.any? { |o| o.frame_index.positive? }

      writes = occs.count { |o| o.role == "write" }
      reads = occs.count { |o| o.role == "read" }
      next unless writes == 1 && reads <= 2

      occs.each do |occ|
        @var_marks << Mark.new(layer: "vars.temps", file: @file, start: occ.start, finish: occ.finish,
                                symbol: symbol, role: occ.role, scope: scope.data_scope)
      end
    end
  end

  def owner
    @nesting.empty? ? nil : Symbols.qualify(@nesting)
  end

  # ---- classes / modules --------------------------------------------------

  def visit_class_node(node)
    name = constant_path_text(node.constant_path)
    @nesting.push(name)
    @def_marks << Mark.new(layer: "defs.classes", file: @file, start: node.constant_path.location.start_offset,
                            finish: node.constant_path.location.end_offset, symbol: owner, role: "definition",
                            scope: @method_symbol)
    @def_records << DefRecord.new(owner: nil, name: owner, kind: :class, symbol: owner)
    visit(node.superclass) if node.superclass
    visit(node.body) if node.body
    @nesting.pop
  end

  def visit_module_node(node)
    name = constant_path_text(node.constant_path)
    @nesting.push(name)
    @def_marks << Mark.new(layer: "defs.classes", file: @file, start: node.constant_path.location.start_offset,
                            finish: node.constant_path.location.end_offset, symbol: owner, role: "definition",
                            scope: @method_symbol)
    @def_records << DefRecord.new(owner: nil, name: owner, kind: :class, symbol: owner)
    visit(node.body) if node.body
    @nesting.pop
  end

  # ---- methods --------------------------------------------------------------

  def visit_def_node(node)
    singleton = node.receiver.is_a?(Prism::SelfNode)
    symbol = Symbols.method_symbol(owner, node.name, singleton: singleton)
    @def_marks << Mark.new(layer: "defs.methods", file: @file, start: node.name_loc.start_offset,
                            finish: node.name_loc.end_offset, symbol: symbol, role: "definition", scope: symbol)
    @def_records << DefRecord.new(owner: owner, name: node.name.to_s,
                                   kind: singleton ? :singleton : :instance, symbol: symbol)
    @method_spans << ScopeIndex::MethodSpan.new(file: @file, start: node.location.start_offset,
                                                 finish: node.location.end_offset, symbol: symbol)

    outer_method_symbol = @method_symbol
    outer_singleton = @method_singleton
    @method_symbol = symbol
    @method_singleton = singleton
    @scope_stack.push(new_scope(prefix: Symbols.local_scope_prefix(symbol), data_scope: symbol,
                                 open_line: node.location.start_line))

    visit(node.parameters) if node.parameters
    visit(node.body) if node.body

    finalize_scope(@scope_stack.pop)
    @method_symbol = outer_method_symbol
    @method_singleton = outer_singleton
  end

  # ---- attr_reader / attr_writer / attr_accessor -----------------------------

  ATTR_METHODS = %i[attr_reader attr_writer attr_accessor].freeze

  def visit_call_node(node)
    if node.receiver.nil? && ATTR_METHODS.include?(node.name) && @method_symbol.nil? && !@nesting.empty?
      handle_attr_call(node)
      visit(node.arguments) if node.arguments
      visit(node.block) if node.block
      return
    end

    record_raw_call(node)
    visit(node.receiver) if node.receiver
    visit(node.arguments) if node.arguments
    visit(node.block) if node.block
  end

  def handle_attr_call(node)
    node.arguments.arguments.each do |arg|
      next unless arg.is_a?(Prism::SymbolNode)

      name = arg.unescaped
      symbol = Symbols.attr_symbol(owner, name)
      @def_marks << Mark.new(layer: "defs.attributes", file: @file, start: arg.location.start_offset,
                              finish: arg.location.end_offset, symbol: symbol, role: "definition", scope: nil)
      @def_records << DefRecord.new(owner: owner, name: name, kind: :attr, symbol: symbol)
    end
  end

  def record_raw_call(node)
    return unless node.message_loc

    receiver = node.receiver
    shape =
      if receiver.nil? || receiver.is_a?(Prism::SelfNode)
        :self
      elsif receiver.is_a?(Prism::ConstantReadNode) || receiver.is_a?(Prism::ConstantPathNode)
        :const
      else
        :other
      end
    owner_text = shape == :const ? constant_path_text(receiver) : nil

    @raw_calls << RawCall.new(
      file: @file, start: node.message_loc.start_offset, finish: node.message_loc.end_offset,
      message: node.name.to_s, shape: shape, owner_text: owner_text, nesting: @nesting.dup,
      self_owner: owner, self_singleton: @method_singleton, scope: @method_symbol,
    )
  end

  # ---- constants: definitions (defs.constants) -----------------------------------
  #
  # Every constant assignment gets a defs.constants mark, lexically qualified like a class
  # (docs/ROUND-4.md "Constants"); registered as a DefRecord so refs.constants elsewhere in
  # the project (and, with --all-constants, unresolved reads) can find it -- see
  # constant_resolver.rb / project_index.rb. Whether it's ALSO an effects.global write
  # (constant reassignment inside a method) is decided by lib/effects_visitor.rb, a separate
  # pass -- this method only ever emits the definition mark.

  def define_constant(full_name, loc)
    symbol = Symbols.qualify(@nesting + [full_name])
    @def_marks << Mark.new(layer: "defs.constants", file: @file, start: loc.start_offset,
                            finish: loc.end_offset, symbol: symbol, role: "definition", scope: @method_symbol)
    @def_records << DefRecord.new(owner: nil, name: symbol, kind: :constant, symbol: symbol)
  end

  def visit_constant_write_node(node)
    define_constant(node.name.to_s, node.name_loc)
    visit(node.value)
  end

  def visit_constant_operator_write_node(node)
    define_constant(node.name.to_s, node.name_loc)
    visit(node.value)
  end

  def visit_constant_and_write_node(node)
    define_constant(node.name.to_s, node.name_loc)
    visit(node.value)
  end

  def visit_constant_or_write_node(node)
    define_constant(node.name.to_s, node.name_loc)
    visit(node.value)
  end

  def visit_constant_target_node(node)
    define_constant(node.name.to_s, node.location)
  end

  def visit_constant_path_write_node(node)
    define_constant(constant_path_text(node.target), node.target.location)
    visit(node.value)
  end

  def visit_constant_path_operator_write_node(node)
    define_constant(constant_path_text(node.target), node.target.location)
    visit(node.value)
  end

  def visit_constant_path_and_write_node(node)
    define_constant(constant_path_text(node.target), node.target.location)
    visit(node.value)
  end

  def visit_constant_path_or_write_node(node)
    define_constant(constant_path_text(node.target), node.target.location)
    visit(node.value)
  end

  def visit_constant_path_target_node(node)
    define_constant(constant_path_text(node), node.location)
  end

  # ---- constants: reads (raw, resolved in a second pass by constant_resolver.rb) -----

  def visit_constant_read_node(node)
    @raw_constants << RawConstant.new(file: @file, start: node.location.start_offset,
                                       finish: node.location.end_offset, name: node.name.to_s,
                                       nesting: @nesting.dup, scope: @method_symbol)
  end

  def visit_constant_path_node(node)
    @raw_constants << RawConstant.new(file: @file, start: node.location.start_offset,
                                       finish: node.location.end_offset, name: constant_path_text(node),
                                       nesting: @nesting.dup, scope: @method_symbol)
    # do not recurse into node.parent: a fully-written path is resolved as one unit
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

  # ---- instance variables -------------------------------------------------------

  def visit_instance_variable_read_node(node)
    add_ivar_mark(node.name, node.location, "read")
  end

  def visit_instance_variable_write_node(node)
    add_ivar_mark(node.name, node.name_loc, "write")
    visit(node.value)
  end

  def visit_instance_variable_operator_write_node(node)
    add_ivar_mark(node.name, node.name_loc, "write")
    visit(node.value)
  end

  def visit_instance_variable_and_write_node(node)
    add_ivar_mark(node.name, node.name_loc, "write")
    visit(node.value)
  end

  def visit_instance_variable_or_write_node(node)
    add_ivar_mark(node.name, node.name_loc, "write")
    visit(node.value)
  end

  def visit_instance_variable_target_node(node)
    add_ivar_mark(node.name, node.location, "write")
  end

  def add_ivar_mark(name, loc, role)
    symbol = Symbols.ivar_symbol(owner, name.to_s.sub(/\A@/, ""))
    @var_marks << Mark.new(layer: "vars.ivars", file: @file, start: loc.start_offset, finish: loc.end_offset,
                            symbol: symbol, role: role, scope: @method_symbol)
  end

  # ---- locals: reads / writes ----------------------------------------------------

  def visit_local_variable_read_node(node)
    record_occurrence_with_depth(node.name, node.location, node.depth, role: "read")
  end

  def visit_local_variable_write_node(node)
    record_occurrence_with_depth(node.name, node.name_loc, node.depth, role: "write")
    visit(node.value)
  end

  def visit_local_variable_operator_write_node(node)
    record_occurrence_with_depth(node.name, node.name_loc, node.depth, role: "write")
    visit(node.value)
  end

  def visit_local_variable_and_write_node(node)
    record_occurrence_with_depth(node.name, node.name_loc, node.depth, role: "write")
    visit(node.value)
  end

  def visit_local_variable_or_write_node(node)
    record_occurrence_with_depth(node.name, node.name_loc, node.depth, role: "write")
    visit(node.value)
  end

  def visit_local_variable_target_node(node)
    record_occurrence_with_depth(node.name, node.location, node.depth, role: "write")
  end

  # ---- parameters (always writes, frame-local) -------------------------------------

  def visit_required_parameter_node(node)
    record_occurrence(node.name, node.location, role: "write", param: true)
  end

  def visit_optional_parameter_node(node)
    record_occurrence(node.name, node.name_loc, role: "write", param: true)
    visit(node.value)
  end

  def visit_rest_parameter_node(node)
    record_occurrence(node.name, node.name_loc, role: "write", param: true) if node.name
  end

  def visit_keyword_rest_parameter_node(node)
    record_occurrence(node.name, node.name_loc, role: "write", param: true) if node.name
  end

  # Prism's name_loc for a keyword param covers "tax:" — drop the trailing colon.
  def visit_required_keyword_parameter_node(node)
    record_occurrence(node.name, node.name_loc.copy(length: node.name_loc.length - 1), role: "write", param: true)
  end

  def visit_optional_keyword_parameter_node(node)
    record_occurrence(node.name, node.name_loc.copy(length: node.name_loc.length - 1), role: "write", param: true)
    visit(node.value)
  end

  def visit_block_parameter_node(node)
    record_occurrence(node.name, node.name_loc, role: "write", param: true) if node.name
  end

  def visit_block_local_variable_node(node)
    record_occurrence(node.name, node.location, role: "write", param: true)
  end

  # ---- blocks / lambdas: open a new local-var frame -----------------------------

  def visit_block_node(node)
    with_new_frame(node) { visit_child_nodes(node) }
  end

  def visit_lambda_node(node)
    with_new_frame(node) { visit_child_nodes(node) }
  end

  def with_new_frame(node)
    scope = current_scope
    scope.frames << Frame.new(open_line: node.location.start_line)
    scope.active.push(scope.frames.length - 1)
    yield
    scope.active.pop
  end

  def visit_program_node(node)
    visit_child_nodes(node)
    finalize_scope(@scope_stack.last) # top-level ("main") scope
  end
end
