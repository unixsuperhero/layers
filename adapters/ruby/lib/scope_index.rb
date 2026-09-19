# frozen_string_literal: true

# Given every method's full source span (def ... end), answers "which method
# encloses byte offset X in file F?" -- used to fill in `data.scope` for the
# exec.path marks derived from a trace (a trace event doesn't carry scope itself).
class ScopeIndex
  MethodSpan = Struct.new(:file, :start, :finish, :symbol, keyword_init: true)

  def initialize(method_spans)
    @by_file = Hash.new { |h, k| h[k] = [] }
    method_spans.each { |s| @by_file[s.file] << s }
  end

  def scope_at(file, offset)
    candidates = @by_file[file].select { |s| s.start <= offset && offset < s.finish }
    return nil if candidates.empty?

    candidates.min_by { |s| s.finish - s.start }.symbol
  end
end
