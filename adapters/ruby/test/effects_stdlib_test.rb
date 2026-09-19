# frozen_string_literal: true

require_relative "test_helper"

# Pure stdlib module calls must not show up as effects.unknown; control marks name their keyword.
class EffectsStdlibTest < Minitest::Test
  SOURCE = <<~RUBY
    class Report
      def to_json(rows)
        JSON.generate(rows.map { |r| Math.sqrt(r) })
      end

      def parsed_at(text)
        Time.parse(text)
      end

      def fetch(url)
        URI.open(url)
      end

      def stamp
        Time.now
      end

      def check!(rows)
        raise ArgumentError, "empty" if rows.empty?
        throw :done
      end
    end
  RUBY

  def setup
    @result = AnalyzePipeline.run({ "report.rb" => SOURCE })
  end

  def verdict(symbol)
    @result.by_layer("defs.methods").find { |m| m.symbol == symbol }.extra.fetch("effects")
  end

  def test_pure_stdlib_modules_are_not_unknown
    assert_empty @result.by_layer("effects.unknown").map { |m| m.extra["name"] }
    assert_equal "pure", verdict("Report#to_json")["verdict"]
    assert_equal "pure", verdict("Report#parsed_at")["verdict"]
  end

  def test_io_catalog_still_wins_over_pure_receivers
    assert_equal ["network"], @result.by_layer("effects.io").select { |m| m.scope == "Report#fetch" }.map { |m| m.extra["what"] }
    assert_equal ["time"], @result.by_layer("effects.io").select { |m| m.scope == "Report#stamp" }.map { |m| m.extra["what"] }
  end

  def test_control_marks_carry_the_keyword
    assert_equal %w[raise throw], @result.by_layer("effects.control").map { |m| m.extra["name"] }
  end
end
