# frozen_string_literal: true

# Symbol-string construction, matching the scheme in docs/ROUND-3.md section A:
#   Invoice#summary        instance method
#   Invoice.summary        singleton ("class") method
#   main#summary           top-level method
#   Invoice#items          attr_reader/writer/accessor
#   Invoice@items           ivar
#   Invoice#summary/total  local var scoped to a method ("main/x" at top level)
#   Invoice#summary/total@11  a block-shadowed local (line = where the block opens)
module Symbols
  module_function

  # nesting: array of constant names (strings), outer -> inner, e.g. ["Foo", "Bar"]
  def qualify(nesting)
    nesting.join("::")
  end

  def method_symbol(owner, name, singleton:)
    if owner.nil?
      "main##{name}"
    elsif singleton
      "#{owner}.#{name}"
    else
      "#{owner}##{name}"
    end
  end

  def attr_symbol(owner, name)
    owner.nil? ? "main##{name}" : "#{owner}##{name}"
  end

  def ivar_symbol(owner, name)
    owner.nil? ? "main@#{name}" : "#{owner}@#{name}"
  end

  # prefix: enclosing method symbol, or nil for top-level (-> "main")
  def local_scope_prefix(method_symbol)
    method_symbol || "main"
  end

  def local_symbol(prefix, name, shadow_line: nil)
    shadow_line ? "#{prefix}/#{name}@#{shadow_line}" : "#{prefix}/#{name}"
  end
end
