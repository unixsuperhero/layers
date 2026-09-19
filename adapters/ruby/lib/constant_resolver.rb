# frozen_string_literal: true

# Resolves StaticVisitor::RawConstant occurrences against the project's defined
# classes/modules, by lexical nesting (innermost enclosing namespace first, then
# progressively less nested, then top-level). Unresolved (stdlib, gems, ...) -> skipped.
module ConstantResolver
  module_function

  def resolve(raw_constants, index)
    marks = []
    raw_constants.each do |rc|
      symbol = resolve_one(rc.name, rc.nesting, index)
      next unless symbol

      marks << StaticVisitor::Mark.new(layer: "refs.constants", file: rc.file, start: rc.start, finish: rc.finish,
                                        symbol: symbol, role: "reference", scope: rc.scope)
    end
    marks
  end

  def resolve_one(name, nesting, index)
    nesting.length.downto(0) do |n|
      candidate = (nesting[0...n] + [name]).join("::")
      return candidate if index.class?(candidate)
    end
    nil
  end
end
