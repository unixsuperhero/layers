# Exercises: nested modules, `def self.x`, a block that mutates an outer local
# (so it must NOT be a vars.temps candidate), a shadowing block param, and a
# top-level method.
module Outer
  module Inner
    class Widget
      def self.build
        new
      end

      def run(seed)
        total = seed
        [1, 2].each do |n|
          total += n
        end
        total
      end

      def shadow_demo(total)
        [1, 2].each do |total|
          total * 2
        end
        total
      end
    end
  end
end

def top_level_helper(x)
  x + 1
end

top_level_helper(1)
