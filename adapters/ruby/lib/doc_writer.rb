# frozen_string_literal: true

require "digest"
require "json"

# Assembles a layers.json document (and the Round-3 bundle format) from the marks
# collected by the static analyzer and (optionally) the tracer, following the
# canonical-sort rules in docs/CONTRACT.md (semantic rules 3-5).
module DocWriter
  PRODUCER = "ruby-analyzer@1"

  KIND_BY_LAYER = {
    "defs.classes" => "static",
    "defs.methods" => "static",
    "defs.attributes" => "static",
    "defs.constants" => "static",
    "vars.locals" => "static",
    "vars.ivars" => "static",
    "vars.temps" => "static",
    "refs.constants" => "static",
    "refs.calls" => "static",
    "effects.state" => "static",
    "effects.global" => "static",
    "effects.args" => "static",
    "effects.io" => "static",
    "effects.control" => "static",
    "effects.calls" => "static",
    "effects.unknown" => "static",
    "exec.path" => "dynamic",
  }.freeze

  module_function

  # sources: { relative_path => bytes (String, ASCII-8BIT) }
  # marks:   [{ layer:, file:, start:, finish:, symbol:, role:, scope: } ...] (StaticVisitor::Mark-shaped);
  #          exec.path marks (kind "dynamic"), if any, are expected to already be included here.
  # trace:   [{ "event", "file", "start", "end", "depth", "symbol", "recv", "locals", "value" }, ...] or nil
  #          (string-keyed -- the shape trace.rb's JSON output round-trips to)
  def build(sources, marks, trace: nil)
    files = {}
    sources.keys.sort.each do |path|
      bytes = sources[path]
      files[path] = { "sha" => Digest::SHA256.hexdigest(bytes), "bytes" => bytes.bytesize }
    end

    by_layer = Hash.new { |h, k| h[k] = [] }
    marks.each { |m| by_layer[m.layer] << m }

    layers = by_layer.keys.sort.map do |id|
      sorted_marks = by_layer[id].sort_by { |m| [m.file, m.start, m.finish, m.symbol || ""] }
      {
        "id" => id,
        "kind" => KIND_BY_LAYER.fetch(id, "static"),
        "producer" => PRODUCER,
        "marks" => sorted_marks.map { |m| mark_json(m) },
      }
    end

    doc = { "version" => 1, "files" => files, "layers" => layers }
    doc["trace"] = trace.each_with_index.map { |ev, i| trace_json(ev, i) } if trace
    doc
  end

  def mark_json(m)
    data = { "scope" => m.scope }
    data.merge!(m.extra) if m.extra
    { "file" => m.file, "start" => m.start, "end" => m.finish, "symbol" => m.symbol, "role" => m.role,
      "data" => data }
  end

  def trace_json(ev, i)
    { "i" => i, "event" => ev["event"], "file" => ev["file"], "start" => ev["start"], "end" => ev["end"],
      "depth" => ev["depth"], "symbol" => ev["symbol"], "recv" => ev["recv"], "locals" => ev["locals"],
      "value" => ev["value"] }
  end

  # sources_text: { relative_path => UTF-8 String } (full file text, for the bundle's `sources` field)
  def bundle(project:, sources_text:, doc:)
    { "bundle" => 1, "project" => project, "sources" => sources_text, "doc" => doc,
      "presentation" => { "version" => 1, "scenes" => [] }, "selection" => nil, "ui" => nil }
  end

  def write_json(path, obj)
    File.write(path, JSON.pretty_generate(obj) + "\n")
  end
end
