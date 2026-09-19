# Exercises every row of docs/ROUND-4.md's effect table, plus the explicit non-effects.
# See adapters/ruby/test/effects_test.rb.

$counter = 0

class Widget
  MAX = 10 # defs.constants (class level) -- NOT effects.global at this level

  attr_reader :items, :log
  attr_writer :log

  def initialize(items)
    @items = items # effects.state: ivar write
  end

  # effects.state via self.x= (attribute writer rooted at self)
  def rename_log(text)
    self.log = text
  end

  # effects.state via a mutator on an implicit-self call (items is attr_reader -> self root)
  def clear_items
    items.clear
  end

  # effects.state via @@cvar write
  def bump_count
    @@count ||= 0
    @@count += 1
  end

  # effects.args: mutator whose receiver chain roots at a parameter
  def append_to(list, value)
    list << value
  end

  # effects.args via a multi-hop attribute chain rooted at a parameter
  def sort_items_of(order)
    order.items.sort!
  end

  # local mutation is NOT an effect
  def local_mutation_is_fine
    list = []
    list << 1
    list
  end

  # effects.global: $global write
  def bump_global
    $counter += 1
  end

  # effects.global: ENV[]=
  def set_env
    ENV["WIDGET_MODE"] = "on"
  end

  # effects.global: class-shape change inside a method
  def add_dynamic_reader
    self.class.attr_reader(:dynamic)
  end

  # effects.io (output) + effects.control
  def announce(ok)
    puts "widget ready"
    raise "not ok" unless ok
  end

  # effects.io: file / random / time / process, one call each
  def touch_disk(path, data)
    File.write(path, data)
  end

  def pick_random
    rand
  end

  def stamp
    Time.now
  end

  def run_shell
    `ls`
  end

  # pure: only arithmetic + a known-pure core call
  def pure_calc(a, b)
    (a + b).abs
  end

  # pure: calls only a pure project method
  def uses_pure_project_method
    pure_calc(1, 2)
  end

  # known-pure core calls only -- must produce NO effects.unknown marks
  def pure_pipeline(values)
    values.map { |v| v * 2 }.select(&:even?).sum
  end

  # effect inside a block belongs to the enclosing method
  def log_each(values)
    values.each do |v|
      self.log = v
    end
  end

  # effects.unknown: a genuinely unresolved, uncatalogued call
  def call_unknown_thing
    frobnicate(1)
  end

  # effects.unknown: yield (the block could do anything)
  def call_the_block
    yield 1
  end

  # effects.unknown: dynamic dispatch, always unknown regardless of what it targets
  def call_dynamically
    send(:pure_calc, 1, 2)
  end

  # impure via a resolved call to an io method -- effects.calls records the edge
  def notify
    announce(true)
  end

  # mutual recursion must terminate and resolve to pure (no direct effects anywhere in the cycle)
  def ping(n)
    n <= 0 ? 0 : pong(n - 1)
  end

  def pong(n)
    n <= 0 ? 0 : ping(n - 1)
  end
end

# Foo.new -> Foo#initialize writes state, but `.new` drops the callee's state kind: the
# caller stays pure.
class Box
  def initialize
    @items = []
  end
end

def make_box
  Box.new
end
