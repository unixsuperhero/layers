# frozen_string_literal: true

# Cross-file lookup tables built from every StaticVisitor#def_records, used to
# resolve refs.calls and refs.constants (docs/ROUND-3.md section A, "Resolution order").
class ProjectIndex
  def initialize(def_records)
    @classes = {} # qualified name -> true
    @constants = {} # qualified name -> true (defs.constants -- round 4)
    @instance = Hash.new { |h, k| h[k] = {} } # owner (nil = top-level "main") -> name -> symbol
    @singleton = Hash.new { |h, k| h[k] = {} } # owner -> name -> symbol
    @by_bare_name = Hash.new { |h, k| h[k] = [] } # name -> [symbol, ...]
    @attr_symbols = {} # symbol -> true (defs.attributes -- generated methods, not real defs)

    def_records.each do |rec|
      case rec.kind
      when :class
        @classes[rec.name] = true
      when :constant
        @constants[rec.name] = true
      when :instance, :attr
        @instance[rec.owner][rec.name] = rec.symbol
        @by_bare_name[rec.name] << rec.symbol
      when :singleton
        @singleton[rec.owner][rec.name] = rec.symbol
        @by_bare_name[rec.name] << rec.symbol
      end
    end

    # Second pass: a symbol counts as attr_only? only if NO :instance/:singleton `def` also
    # claims it (the rare case of `attr_reader :x` plus a real `def x` reopening the same name).
    def_records.each { |rec| @attr_symbols[rec.symbol] = true if rec.kind == :attr }
    def_records.each { |rec| @attr_symbols.delete(rec.symbol) if rec.kind == :instance || rec.kind == :singleton }
  end

  def class?(qualified_name)
    @classes.key?(qualified_name)
  end

  def constant?(qualified_name)
    @constants.key?(qualified_name)
  end

  # A symbol defined ONLY by attr_reader/writer/accessor (no `def`) -- effects.calls purposes
  # (round 4): calling one of these is a pure leaf, never a call-graph edge.
  def attr_only?(symbol)
    @attr_symbols.key?(symbol)
  end

  def instance_method(owner, name)
    @instance[owner][name]
  end

  def singleton_method(owner, name)
    @singleton[owner][name]
  end

  def bare_name_matches(name)
    @by_bare_name[name].uniq
  end
end
