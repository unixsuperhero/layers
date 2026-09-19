# frozen_string_literal: true

require_relative "test_helper"
require "json"
require "prism"

# Runs the real static analyzer (StaticVisitor + ProjectIndex + resolvers) against
# fixtures/example-ruby/src and checks it against the hand-written fixture's static
# layers exactly: docs/ROUND-3.md section A requires "at least every mark of the
# fixture with the same (layer, file, start, end, symbol, role)" -- this fixture
# happens to match EXACTLY (no legitimate extras/omissions), so we assert equality
# and let any future divergence show up as a loud, specific failure.
class FixtureStaticTest < Minitest::Test
  def setup
    @fixture_doc = JSON.parse(File.read(File.join(FIXTURE_DIR, "layers.json")))
    @project = JSON.parse(File.read(File.join(FIXTURE_DIR, "project.json")))

    # The FULL pipeline (static + effects + verdicts): the fixture carries effects.* layers too.
    files = @project["files"].to_h do |rel|
      [rel, File.binread(File.join(FIXTURE_DIR, @project["root"], rel)).force_encoding("UTF-8")]
    end
    @marks = AnalyzePipeline.run(files).marks
  end

  def mine_by_layer(layer_id)
    @marks.select { |m| m.layer == layer_id }
  end

  def mark_key(file, start, finish, symbol, role)
    "#{file}:#{start}:#{finish}:#{symbol}:#{role}"
  end

  def test_every_static_layer_matches_the_fixture_exactly
    @fixture_doc["layers"].each do |layer|
      next if layer["id"] == "exec.path" # dynamic; covered by the node CLI test

      fixture_keys = layer["marks"].map { |m| mark_key(m["file"], m["start"], m["end"], m["symbol"], m["role"]) }.sort
      mine = mine_by_layer(layer["id"])
      mine_keys = mine.map { |m| mark_key(m.file, m.start, m.finish, m.symbol, m.role) }.sort

      assert_equal fixture_keys, mine_keys, "#{layer['id']}: mark set differs from the fixture"

      # data.scope must match too, for every mark.
      by_key = mine.each_with_object({}) { |m, h| h[mark_key(m.file, m.start, m.finish, m.symbol, m.role)] = m.scope }
      layer["marks"].each do |m|
        key = mark_key(m["file"], m["start"], m["end"], m["symbol"], m["role"])
        msg = "#{layer['id']} #{key}: data.scope differs from the fixture"
        if m["data"]["scope"].nil?
          assert_nil by_key[key], msg
        else
          assert_equal m["data"]["scope"], by_key[key], msg
        end
      end
    end
  end

  def test_multibyte_line_one_of_invoice_rb_has_correct_byte_offsets
    # invoice.rb line 1 is "# Invoice — café billing ☕ (multibyte on purpose)": the class
    # definition on line 2 must still land on the right BYTE offset despite that.
    invoice_bytes = File.binread(File.join(FIXTURE_DIR, @project["root"], "invoice.rb"))
    class_mark = mine_by_layer("defs.classes").find { |m| m.file == "invoice.rb" }
    assert_equal "Invoice", invoice_bytes.byteslice(class_mark.start, class_mark.finish - class_mark.start)
  end
end
