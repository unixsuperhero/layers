# frozen_string_literal: true

# Static data for docs/ROUND-4.md's effect classification. Every name list here is matched
# by the call's bare message name (no type inference -- see adapters/ruby/README.md
# "Known limitations"). Frozen sets/hashes, one group per comment.
module EffectCatalog
  # Mutators by NAME alone (regardless of resolution): bang-suffixed names are handled
  # separately by a plain `name.end_with?("!")` check in effects_visitor.rb; this catalog is
  # the non-bang remainder from docs/ROUND-4.md's "Mutators" paragraph. `freeze` is
  # deliberately NOT here -- the spec calls it out as "not an effect -- omit" (it's also in
  # KNOWN_PURE_NAMES below). Attribute writers (`x=`, `[]=`) are detected structurally in
  # effects_visitor.rb (CallNode#attribute_write?), not listed here either.
  MUTATOR_NAMES = %w[
    << push append prepend pop shift unshift insert concat delete delete_at delete_if
    clear replace fill store update merge! add add? subtract keep_if reject! select!
    map! collect! sort! sort_by! uniq! compact! flatten! shuffle! reverse! rotate!
    slice! transform_values! transform_keys! force_encoding encode! gsub! sub!
    squeeze! strip! chomp! chop! upcase! downcase! capitalize! swapcase! tr! succ!
    next! setbyte
  ].freeze

  # IO: receiver-less (bare) names only -- a call with an unrecognised receiver never
  # matches these (avoids treating an arbitrary object's own `#write`/`#open` as IO).
  IO_BARE = {
    "puts" => "output", "print" => "output", "p" => "output", "pp" => "output",
    "warn" => "output", "printf" => "output", "putc" => "output", "display" => "output",
    "gets" => "input", "readline" => "input", "readlines" => "input",
    "system" => "process", "exec" => "process", "spawn" => "process", "fork" => "process",
    "sleep" => "process", "at_exit" => "process", "trap" => "process",
    "rand" => "random", "srand" => "random",
  }.freeze

  # IO: matches regardless of receiver (no type inference -- these names are common enough
  # on arbitrary objects that requiring a receiver match would miss most real call sites).
  IO_MESSAGE_ANY_RECEIVER = { "sample" => "random", "shuffle" => "random" }.freeze

  # IO: any message under one of these receivers (first path segment for a qualified
  # constant, e.g. "Net::HTTP" matches "Net"), or the global $stdout/$stderr.
  IO_RECEIVER_WILDCARD = {
    "$stdout" => "output", "$stderr" => "output", "STDOUT" => "output", "STDERR" => "output",
    "STDIN" => "input", "ARGF" => "input",
    "File" => "file", "IO" => "file", "Dir" => "file", "FileUtils" => "file",
    "Process" => "process",
    "Net" => "network", "Socket" => "network", "TCPSocket" => "network",
    "Random" => "random", "SecureRandom" => "random",
  }.freeze

  # IO: exact (receiver, message) pairs -- these receivers have plenty of non-IO methods too,
  # so only the specific message named in docs/ROUND-4.md counts.
  IO_RECEIVER_MESSAGE = {
    %w[Time now] => "time", %w[Time current] => "time",
    %w[Date today] => "time", %w[DateTime now] => "time",
    %w[Process clock_gettime] => "time",
    %w[URI open] => "network",
  }.freeze

  CONTROL_NAMES = %w[raise fail throw exit exit! abort].freeze

  # Always effects.unknown, regardless of resolution (docs/ROUND-4.md: "dynamic dispatch ->
  # always unknown").
  DYNAMIC_DISPATCH_NAMES = %w[send public_send __send__ instance_eval class_eval method_missing].freeze

  # Class-shape changes: effects.global, but ONLY when the call appears inside a method body
  # (at class-body level these are ordinary class definition, not a runtime effect).
  CLASS_SHAPE_NAMES = %w[
    define_method include extend attr_reader attr_writer attr_accessor
    alias_method remove_method const_set instance_variable_set
  ].freeze

  # Operator-style method names: excluded from effects.unknown even when unresolved
  # (docs/ROUND-4.md: "it is not an operator or []/!/==-style method"). `<<` is a mutator
  # (handled above) so it doesn't need to be here too.
  OPERATOR_NAMES = %w[
    + - * / % ** == != < > <= >= <=> === =~ !~ & | ^ ~ >> [] ! -@ +@
  ].freeze

  # A generous list of core/stdlib query & transform methods assumed side-effect-free.
  # Matched by name only (no receiver check) -- see "Known limitations" in the README.
  # Extended beyond docs/ROUND-4.md's own list from real-world usage (fixtures/mockapp).
  KNOWN_PURE_NAMES = %w[
    each map select reject find detect all? any? none? one? sum count size length first last
    min max min_by max_by sort sort_by group_by partition zip each_with_index each_with_object
    inject reduce flat_map to_a to_h to_s to_sym to_i to_f to_r inspect dup clone freeze frozen?
    nil? empty? include? member? key? has_key? has_value? fetch dig keys values values_at merge
    slice except strip lstrip rstrip upcase downcase capitalize split join format sprintf
    start_with? end_with? gsub sub tr round floor ceil abs abs2 between? clamp times upto downto
    step new is_a? kind_of? respond_to? instance_of? equal? eql? hash then tap yield_self itself
    lambda proc block_given? require require_relative load open
    each_slice each_cons chunk_while slice_when tally compact flatten uniq reverse rotate assoc
    to_str to_ary to_proc object_id class instance_of? methods public_methods to_set
    each_pair each_key each_value invert
    delete_suffix delete_prefix transform_values transform_keys positive? negative? zero?
    nonzero? finite? infinite? nan? integer? even? odd? succ pred ord chr center ljust rjust
    casecmp casecmp? match match? scan unpack unpack1 bytesize bytes chars lines codepoints
    to_c coerce divmod fdiv gcd lcm pow numerator denominator
    private public protected module_function private_class_method public_class_method
  ].freeze

  module_function

  # Classifies an IO call by its (receiver node, bare message name); returns a "what" string
  # (docs/ROUND-4.md's `data.what`) or nil if this isn't a catalogued IO call. Checked in this
  # order: exact (receiver, message) pairs, then a wildcard receiver (any message), then a
  # receiver-less bare name, then a small any-receiver set (Array#sample/#shuffle -- no type
  # inference, so these match regardless of what the receiver actually is).
  def io_what(receiver, message)
    rtext = receiver_text(receiver)
    exact = IO_RECEIVER_MESSAGE[[rtext, message]]
    return exact if exact

    if rtext
      wildcard = IO_RECEIVER_WILDCARD[rtext] || IO_RECEIVER_WILDCARD[rtext.split("::").first]
      return wildcard if wildcard
    end

    return IO_BARE[message] if receiver.nil? && IO_BARE.key?(message)

    IO_MESSAGE_ANY_RECEIVER[message]
  end

  def receiver_text(node)
    case node
    when Prism::ConstantReadNode
      node.name.to_s
    when Prism::ConstantPathNode
      constant_path_text(node)
    when Prism::GlobalVariableReadNode
      node.name.to_s
    end
  end

  def constant_path_text(node)
    case node
    when Prism::ConstantReadNode
      node.name.to_s
    when Prism::ConstantPathNode
      node.parent ? "#{constant_path_text(node.parent)}::#{node.name}" : node.name.to_s
    end
  end
end
