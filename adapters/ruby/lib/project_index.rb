# frozen_string_literal: true

# Cross-file lookup tables built from every StaticVisitor#def_records, used to
# resolve refs.calls and refs.constants (docs/ROUND-3.md section A, "Resolution order").
class ProjectIndex
  def initialize(def_records)
    @classes = {} # qualified name -> true
    @instance = Hash.new { |h, k| h[k] = {} } # owner (nil = top-level "main") -> name -> symbol
    @singleton = Hash.new { |h, k| h[k] = {} } # owner -> name -> symbol
    @by_bare_name = Hash.new { |h, k| h[k] = [] } # name -> [symbol, ...]

    def_records.each do |rec|
      case rec.kind
      when :class
        @classes[rec.name] = true
      when :instance, :attr
        @instance[rec.owner][rec.name] = rec.symbol
        @by_bare_name[rec.name] << rec.symbol
      when :singleton
        @singleton[rec.owner][rec.name] = rec.symbol
        @by_bare_name[rec.name] << rec.symbol
      end
    end
  end

  def class?(qualified_name)
    @classes.key?(qualified_name)
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
