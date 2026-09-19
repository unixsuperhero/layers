# frozen_string_literal: true

require_relative "test_helper"

class DocWriterTest < Minitest::Test
  def sample_marks
    [
      StaticVisitor::Mark.new(layer: "defs.methods", file: "b.rb", start: 5, finish: 8, symbol: "B#x",
                               role: "definition", scope: "B#x"),
      StaticVisitor::Mark.new(layer: "defs.methods", file: "a.rb", start: 2, finish: 4, symbol: "A#x",
                               role: "definition", scope: "A#x"),
      StaticVisitor::Mark.new(layer: "defs.methods", file: "a.rb", start: 2, finish: 4, symbol: "A#y",
                               role: "definition", scope: "A#y"),
    ]
  end

  def test_layers_are_sorted_by_id_and_marks_canonically_within_a_layer
    doc = DocWriter.build({ "a.rb" => "aa", "b.rb" => "bb" }, sample_marks)
    assert_equal ["defs.methods"], doc["layers"].map { |l| l["id"] }

    marks = doc["layers"].first["marks"]
    # (file, start, end, symbol) order: a.rb before b.rb; within a.rb, A#x before A#y
    assert_equal [["a.rb", "A#x"], ["a.rb", "A#y"], ["b.rb", "B#x"]],
                 marks.map { |m| [m["file"], m["symbol"]] }
  end

  def test_files_table_has_sha256_and_byte_size
    doc = DocWriter.build({ "a.rb" => "hello" }, [])
    assert_equal Digest::SHA256.hexdigest("hello"), doc["files"]["a.rb"]["sha"]
    assert_equal 5, doc["files"]["a.rb"]["bytes"]
  end

  def test_omits_trace_key_when_no_trace_given
    doc = DocWriter.build({ "a.rb" => "x" }, [])
    refute doc.key?("trace")
  end

  def test_trace_events_get_sequential_i
    trace = [
      { "event" => "line", "file" => "a.rb", "start" => 0, "end" => 1, "depth" => 0, "symbol" => nil,
        "recv" => nil, "locals" => {}, "value" => nil },
      { "event" => "line", "file" => "a.rb", "start" => 1, "end" => 2, "depth" => 0, "symbol" => nil,
        "recv" => nil, "locals" => {}, "value" => nil },
    ]
    doc = DocWriter.build({ "a.rb" => "xy" }, [], trace: trace)
    assert_equal [0, 1], doc["trace"].map { |e| e["i"] }
  end

  def test_bundle_shape_and_sha_consistency
    doc = DocWriter.build({ "a.rb" => "hello" }, [])
    bundle = DocWriter.bundle(project: { "name" => "p", "root" => "src", "files" => ["a.rb"], "entry" => nil },
                               sources_text: { "a.rb" => "hello" }, doc: doc)
    assert_equal 1, bundle["bundle"]
    assert_equal %w[bundle project sources doc presentation selection ui], bundle.keys
    assert_equal Digest::SHA256.hexdigest("hello"), Digest::SHA256.hexdigest(bundle["sources"]["a.rb"])
    assert_equal bundle["doc"]["files"]["a.rb"]["sha"], Digest::SHA256.hexdigest(bundle["sources"]["a.rb"])
  end
end
