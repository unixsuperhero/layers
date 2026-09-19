# frozen_string_literal: true

require_relative "constant_resolver"

# Resolves StaticVisitor::RawCall occurrences (docs/ROUND-3.md section A, "Resolution order"):
#   Foo.new           -> Foo#initialize if defined, else Foo.new if defined, else skipped
#   Foo.bar            (explicit constant receiver) -> Foo.bar if defined, else skipped
#   bar / self.bar      (implicit/self receiver) -> method of the enclosing class if defined, else skipped
#   recv.bar / other    (anything else) -> exactly one project-wide def named "bar", else skipped
# attr_reader/writer/accessor-defined readers resolve like any other instance method,
# since ProjectIndex merges :attr defs into the same instance-method table.
module CallResolver
  module_function

  def resolve(raw_calls, index)
    marks = []
    raw_calls.each do |rc|
      symbol = resolve_one(rc, index)
      next unless symbol

      marks << StaticVisitor::Mark.new(layer: "refs.calls", file: rc.file, start: rc.start, finish: rc.finish,
                                        symbol: symbol, role: "reference", scope: rc.scope)
    end
    marks
  end

  def resolve_one(rc, index)
    case rc.shape
    when :const
      owner = ConstantResolver.resolve_one(rc.owner_text, rc.nesting, index)
      return nil unless owner

      if rc.message == "new"
        index.instance_method(owner, "initialize") || index.singleton_method(owner, "new")
      else
        index.singleton_method(owner, rc.message)
      end
    when :self
      if rc.self_singleton
        index.singleton_method(rc.self_owner, rc.message) || index.instance_method(rc.self_owner, rc.message)
      else
        index.instance_method(rc.self_owner, rc.message)
      end
    else
      matches = index.bare_name_matches(rc.message)
      matches.length == 1 ? matches.first : nil
    end
  end
end
