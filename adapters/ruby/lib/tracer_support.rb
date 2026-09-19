# frozen_string_literal: true

# Pure helpers shared by trace.rb: byte-offset line spans (mirrors scripts/build-fixture.mjs's
# `trimmedLine`, so a trace event's span is computed the same way the hand-written fixture is)
# and deterministic value formatting (no object ids, no timestamps).
module TracerSupport
  module_function

  # bytes: ASCII-8BIT String (File.binread). Returns { file => LineIndex }-style helper.
  class LineIndex
    def initialize(bytes)
      @bytes = bytes
      @line_starts = [0]
      bytes.each_byte.with_index { |b, i| @line_starts << i + 1 if b == 0x0a }
    end

    # 1-based line number -> [start, end) trimmed of leading/trailing space/tab
    def span(lineno)
      start = @line_starts[lineno - 1]
      return [0, 0] unless start

      finish = @line_starts[lineno] || @bytes.bytesize
      finish -= 1 if @line_starts[lineno] # drop the trailing "\n"
      start += 1 while start < finish && [0x20, 0x09].include?(@bytes.getbyte(start))
      finish -= 1 while finish > start && [0x20, 0x09].include?(@bytes.getbyte(finish - 1))
      [start, finish]
    end
  end

  # "#<Invoice:0x00007f9d... @items=[10, 32]>" -> "#<Invoice>" (docs/ROUND-3.md section A: "normalise
  # inspected values to #<Invoice>"). Ivars are dropped too, not just the object id: an ivar dump can
  # itself embed another object's id (or a hash-ordering-sensitive collection), so the only fully
  # deterministic, byte-stable representation of a plain object is its bare class name.
  CLASS_NAME = /[A-Za-z_]\w*(?:::[A-Za-z_]\w*)*/.freeze
  DEFAULT_INSPECT_RE = /\A#<(#{CLASS_NAME})(?::0x[0-9a-f]+)?(?:\s.*)?>\z/m.freeze

  def normalize_inspect(str)
    m = DEFAULT_INSPECT_RE.match(str)
    m ? "#<#{m[1]}>" : str
  end

  def truncate(str, max = 80)
    str.length > max ? str[0, max] : str
  end

  def format_value(obj)
    truncate(normalize_inspect(obj.inspect))
  end
end
