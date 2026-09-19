#!/usr/bin/env ruby
# frozen_string_literal: true

# bin/layers-analyze <file-or-dir>... [--entry FILE] [--root DIR] [--out DIR] [--bundle FILE] [--name NAME]
# See docs/ROUND-3.md section A for the full spec. Loaded by bin/layers-analyze after
# `bundler/setup`, so `require "prism"` below resolves to adapters/ruby/Gemfile's pin.

require "optparse"
require "pathname"
require "fileutils"
require "tmpdir"
require "find"
require "json"
require "prism"
require "rbconfig"

require_relative "lib/file_discovery"
require_relative "lib/static_visitor"
require_relative "lib/project_index"
require_relative "lib/constant_resolver"
require_relative "lib/call_resolver"
require_relative "lib/scope_index"
require_relative "lib/doc_writer"

ADAPTER_DIR = __dir__
TRACE_SCRIPT = File.join(ADAPTER_DIR, "trace.rb")
TRACE_TIMEOUT_SECONDS = 10

class AnalyzeError < StandardError; end

def fail_with(message)
  raise AnalyzeError, message
end

def parse_argv(argv)
  options = { root: nil, entry: nil, out: nil, bundle: nil, name: nil }
  parser = OptionParser.new do |o|
    o.banner = "usage: layers-analyze <file-or-dir>... [--entry FILE] [--root DIR] [--out DIR] [--bundle FILE] [--name NAME]"
    o.on("--entry FILE") { |v| options[:entry] = v }
    o.on("--root DIR") { |v| options[:root] = v }
    o.on("--out DIR") { |v| options[:out] = v }
    o.on("--bundle FILE") { |v| options[:bundle] = v }
    o.on("--name NAME") { |v| options[:name] = v }
  end
  inputs = parser.parse(argv)
  fail_with("no input paths given") if inputs.empty?
  fail_with("at least one of --out or --bundle is required") unless options[:out] || options[:bundle]
  [inputs, options]
end

def relative_posix(path, root)
  path.relative_path_from(root).to_s.tr(File::SEPARATOR, "/")
end

# Parses every discovered file; returns [sources (rel => bytes), successfully-parsed rel paths,
# visitors (rel => StaticVisitor)]. Syntax errors are reported per file on stderr and that
# file simply contributes no marks (its bytes still go into `sources`/`files`).
def analyze_files(root, abs_files)
  sources = {}
  visitors = {}
  abs_files.each do |abs|
    rel = relative_posix(abs, root)
    bytes = File.binread(abs)
    sources[rel] = bytes

    result = Prism.parse(bytes, filepath: rel)
    if result.success?
      visitor = StaticVisitor.new(rel)
      visitor.visit(result.value)
      visitors[rel] = visitor
    else
      result.errors.each do |err|
        warn "#{rel}:#{err.location.start_line}: #{err.message}"
      end
    end
  end
  [sources, visitors]
end

def build_marks_and_index(visitors)
  def_marks = []
  var_marks = []
  def_records = []
  raw_constants = []
  raw_calls = []
  method_spans = []

  visitors.each_value do |v|
    def_marks.concat(v.def_marks)
    var_marks.concat(v.var_marks)
    def_records.concat(v.def_records)
    raw_constants.concat(v.raw_constants)
    raw_calls.concat(v.raw_calls)
    method_spans.concat(v.method_spans)
  end

  index = ProjectIndex.new(def_records)
  const_marks = ConstantResolver.resolve(raw_constants, index)
  call_marks = CallResolver.resolve(raw_calls, index)

  { marks: def_marks + var_marks + const_marks + call_marks, method_spans: method_spans }
end

RUN_COPY_MAX_FILES = 5000
RUN_COPY_MAX_BYTES = 50 * 1024 * 1024

# Everything under `root` the traced program might need at run time (unselected .rb files it
# requires, data files it reads), as rel => abs path. Skips SKIP_DIRS, dotfiles dirs and symlinks.
# Returns nil when the tree is too big to copy -- the caller then runs with the selection only.
def runtime_files(root)
  found = {}
  bytes = 0
  Find.find(root.to_s) do |path|
    base = File.basename(path)
    if File.directory?(path)
      Find.prune if path != root.to_s && (FileDiscovery::SKIP_DIRS.include?(base) || base.start_with?("."))
      next
    end
    next if File.symlink?(path) || !File.file?(path)

    bytes += File.size(path)
    return nil if found.size >= RUN_COPY_MAX_FILES || bytes > RUN_COPY_MAX_BYTES

    found[Pathname.new(path).relative_path_from(root).to_s] = path
  end
  found
end

# Builds the temp directory the entry point runs in: the whole `root` tree (so requires into
# files that were NOT selected for analysis still work), then the selected `sources`
# (rel => bytes) written on top byte-for-byte. Returns that directory's Pathname.
def copy_project_to_tmp(sources, root)
  dir = Pathname.new(Dir.mktmpdir("layers-analyze-"))
  extra = runtime_files(root)
  warn "warn: #{root} is too large to copy; running with the selected files only" if extra.nil?
  (extra || {}).each do |rel, abs|
    dest = dir + rel
    FileUtils.mkdir_p(dest.dirname)
    FileUtils.cp(abs, dest)
  end
  sources.each do |rel, bytes|
    dest = dir + rel
    FileUtils.mkdir_p(dest.dirname)
    File.binwrite(dest, bytes)
  end
  dir
end

# Runs trace.rb as a CHILD PROCESS against the temp project copy, enforcing a hard
# timeout. Returns the parsed trace events (array of string-keyed hashes) on success,
# or on a tolerated in-program exception (partial trace + warning). Raises AnalyzeError
# for a timeout or any other failure -- callers must not write output in that case.
def run_tracer(tmp_dir, entry_rel)
  entry_abs = tmp_dir + entry_rel
  trace_out = tmp_dir + ".trace-out.json"
  stdout_capture = tmp_dir + ".trace-stdout.log"
  stderr_capture = tmp_dir + ".trace-stderr.log"

  pid = Process.spawn(RbConfig.ruby, TRACE_SCRIPT, tmp_dir.to_s, entry_abs.to_s, trace_out.to_s,
                       out: stdout_capture.to_s, err: stderr_capture.to_s)

  deadline = Time.now + TRACE_TIMEOUT_SECONDS
  status = nil
  loop do
    _, status = Process.wait2(pid, Process::WNOHANG)
    break if status

    if Time.now > deadline
      begin
        Process.kill("KILL", pid)
      rescue Errno::ESRCH
        # already gone
      end
      Process.wait(pid)
      fail_with("entry point timed out after #{TRACE_TIMEOUT_SECONDS}s")
    end
    sleep 0.02
  end

  case status.exitstatus
  when 0
    JSON.parse(File.read(trace_out))
  when 2
    raised = File.read(stderr_capture).lines.grep(/^entry raised /).first.to_s.strip
    raised = raised.gsub("#{File.realpath(tmp_dir)}/", "").gsub("#{tmp_dir}/", "")
    warn "warn: #{raised.empty? ? "entry raised an exception" : raised} -- trace is truncated at the raise"
    JSON.parse(File.read(trace_out))
  else
    fail_with("entry point failed (exit #{status.exitstatus.inspect}): #{File.read(stderr_capture).lines.first&.strip}")
  end
end

def resolve_entry_rel(entry_arg, root, sources)
  candidate = Pathname.new(entry_arg)
  candidate = root + entry_arg unless candidate.absolute?
  candidate = candidate.expand_path
  rel = relative_posix(candidate, root)
  fail_with("entry file not found: #{entry_arg}") unless sources.key?(rel)

  rel
end

def write_project_dir(out_dir, name, root_label, sorted_rel, entry_rel, sources, doc)
  out = Pathname.new(out_dir)
  FileUtils.mkdir_p(out)
  FileUtils.mkdir_p(out + root_label)
  sorted_rel.each do |rel|
    dest = out + root_label + rel
    FileUtils.mkdir_p(dest.dirname)
    File.binwrite(dest, sources[rel])
  end
  project = { "name" => name, "root" => root_label, "files" => sorted_rel, "entry" => entry_rel }
  DocWriter.write_json(out + "project.json", project)
  DocWriter.write_json(out + "layers.json", doc)
end

def write_bundle(bundle_path, name, root_label, sorted_rel, entry_rel, sources, doc)
  sources_text = {}
  sorted_rel.each { |rel| sources_text[rel] = sources[rel].dup.force_encoding("UTF-8") }
  project = { "name" => name, "root" => root_label, "files" => sorted_rel, "entry" => entry_rel }
  bundle = DocWriter.bundle(project: project, sources_text: sources_text, doc: doc)
  DocWriter.write_json(bundle_path, bundle)
end

def main
  inputs, options = parse_argv(ARGV)
  discovered = FileDiscovery.expand(inputs, root_override: options[:root])
  root = discovered[:root]
  abs_files = discovered[:files]
  fail_with("no .rb files found") if abs_files.empty?

  sources, visitors = analyze_files(root, abs_files)
  built = build_marks_and_index(visitors)
  marks = built[:marks]

  sorted_rel = sources.keys.sort
  name = options[:name] || root.basename.to_s
  entry_rel = options[:entry] ? resolve_entry_rel(options[:entry], root, sources) : nil

  trace_events = nil
  if entry_rel
    tmp_dir = copy_project_to_tmp(sources, root)
    begin
      trace_events = run_tracer(tmp_dir, entry_rel)
    ensure
      FileUtils.remove_entry(tmp_dir)
    end
    # The run saw the whole root; the document only knows the selected files.
    trace_events = trace_events.select { |ev| sources.key?(ev["file"]) }
    trace_events.each_with_index { |ev, i| ev["i"] = i }

    scope_index = ScopeIndex.new(built[:method_spans])
    seen = {}
    trace_events.each do |ev|
      key = [ev["file"], ev["start"], ev["end"]]
      next if seen[key]

      seen[key] = true
      marks << StaticVisitor::Mark.new(layer: "exec.path", file: ev["file"], start: ev["start"],
                                        finish: ev["end"], symbol: nil, role: "executed",
                                        scope: scope_index.scope_at(ev["file"], ev["start"]))
    end
  end

  doc = DocWriter.build(sources, marks, trace: trace_events)

  write_project_dir(options[:out], name, "src", sorted_rel, entry_rel, sources, doc) if options[:out]
  write_bundle(options[:bundle], name, "src", sorted_rel, entry_rel, sources, doc) if options[:bundle]
rescue AnalyzeError, Errno::ENOENT => e
  warn "error: #{e.message}"
  exit 1
rescue StandardError => e
  warn "error: #{e.class}: #{e.message}"
  exit 1
end

main
