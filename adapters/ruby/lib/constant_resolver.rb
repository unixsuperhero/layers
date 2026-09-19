# frozen_string_literal: true

# Resolves StaticVisitor::RawConstant occurrences against the project's defined
# classes/modules AND assigned constants (defs.constants -- round 4), by lexical nesting
# (innermost enclosing namespace first, then progressively less nested, then top-level).
# Unresolved (stdlib, gems, ...) -> skipped, UNLESS `all_constants` is set (--all-constants:
# docs/ROUND-4.md "Constants"), in which case they're emitted with the as-written path as
# symbol and `data.resolved = false`. Resolved marks always carry `data.resolved = true`.
module ConstantResolver
  module_function

  def resolve(raw_constants, index, all_constants: false)
    marks = []
    raw_constants.each do |rc|
      symbol = resolve_one(rc.name, rc.nesting, index)
      if symbol
        marks << StaticVisitor::Mark.new(layer: "refs.constants", file: rc.file, start: rc.start, finish: rc.finish,
                                          symbol: symbol, role: "reference", scope: rc.scope,
                                          extra: { "resolved" => true })
      elsif all_constants
        marks << StaticVisitor::Mark.new(layer: "refs.constants", file: rc.file, start: rc.start, finish: rc.finish,
                                          symbol: rc.name, role: "reference", scope: rc.scope,
                                          extra: { "resolved" => false })
      end
    end
    marks
  end

  def resolve_one(name, nesting, index)
    nesting.length.downto(0) do |n|
      candidate = (nesting[0...n] + [name]).join("::")
      return candidate if index.class?(candidate) || index.constant?(candidate)
    end
    nil
  end
end
