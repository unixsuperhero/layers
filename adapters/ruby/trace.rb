#!/usr/bin/env ruby
# frozen_string_literal: true

# Runs a project's entry file under TracePoint and writes the raw trace events as
# JSON. Invoked as a CHILD PROCESS by analyze.rb (never loaded in-process), so that
# a crash / infinite loop / exit call in the user's program cannot take down the
# analyzer -- analyze.rb enforces the 10s timeout and kills this process if needed.
#
# argv: <project_root_abs> <entry_file_abs> <out_json_path>
#   project_root_abs: the copied project's root (events are filtered to files under it)
#   entry_file_abs:   the script to run (cwd is set to its directory before running it)
#   out_json_path:    where to write the JSON array of trace events
#
# Exit status: 0 = ran to completion. 2 = the entry raised an uncaught exception
# (a partial trace, including the "raise" event, is still written -- analyze.rb
# treats this as a warning, not a failure). Anything else = unexpected crash.

require "json"
require_relative "lib/tracer_support"

project_root, entry_path, out_path = ARGV
unless project_root && entry_path && out_path
  warn "usage: trace.rb <project_root> <entry_abs_path> <out_json_path>"
  exit 3
end

project_root_real = File.realpath(project_root)
entry_real = File.realpath(entry_path)

line_indexes = {}
line_index_for = lambda do |path|
  line_indexes[path] ||= TracerSupport::LineIndex.new(File.binread(path))
end

project_relative_path = lambda do |path|
  real = File.realpath(path)
  real.sub("#{project_root_real}#{File::SEPARATOR}", "")
end

in_project = lambda do |path|
  next false unless path

  real =
    begin
      File.realpath(path)
    rescue StandardError
      nil
    end
  next false unless real

  real == project_root_real || real.start_with?("#{project_root_real}#{File::SEPARATOR}")
end

# symbol/recv scheme mirrors lib/symbols.rb's method_symbol (Owner#name / Owner.name / main#name)
call_symbol_and_recv = lambda do |point|
  self_obj = point.self
  defined_class = point.defined_class
  method_name = point.method_id.to_s

  if defined_class.singleton_class? && self_obj.singleton_class == defined_class
    owner = self_obj.respond_to?(:name) ? self_obj.name : nil
    next [owner ? "#{owner}.#{method_name}" : "main##{method_name}", owner]
  end

  owner = defined_class.name
  if owner.nil? || owner == "Object"
    ["main##{method_name}", nil]
  else
    ["#{owner}##{method_name}", owner]
  end
end

capture_locals = lambda do |point|
  binding_ = point.binding
  next {} unless binding_

  binding_.local_variables.each_with_object({}) do |name, out|
    out[name.to_s] = TracerSupport.format_value(binding_.local_variable_get(name))
  end
end

events = []
depth = 0

tracepoint = TracePoint.new(:call, :return, :line, :b_call, :b_return, :raise) do |point|
  next unless in_project.call(point.path)

  file = project_relative_path.call(point.path)
  start_off, end_off = line_index_for.call(point.path).span(point.lineno)

  case point.event
  when :call
    depth += 1
    symbol, recv = call_symbol_and_recv.call(point)
    events << { event: "call", file: file, start: start_off, end: end_off, depth: depth,
                symbol: symbol, recv: recv, locals: nil, value: nil }
  when :return
    symbol, = call_symbol_and_recv.call(point)
    events << { event: "return", file: file, start: start_off, end: end_off, depth: depth,
                symbol: symbol, recv: nil, locals: nil, value: TracerSupport.format_value(point.return_value) }
    depth -= 1
  when :b_call
    depth += 1
    events << { event: "b_call", file: file, start: start_off, end: end_off, depth: depth,
                symbol: nil, recv: nil, locals: nil, value: nil }
  when :b_return
    events << { event: "b_return", file: file, start: start_off, end: end_off, depth: depth,
                symbol: nil, recv: nil, locals: nil, value: nil }
    depth -= 1
  when :line
    events << { event: "line", file: file, start: start_off, end: end_off, depth: depth,
                symbol: nil, recv: nil, locals: capture_locals.call(point), value: nil }
  when :raise
    events << { event: "raise", file: file, start: start_off, end: end_off, depth: depth,
                symbol: nil, recv: nil, locals: nil, value: TracerSupport.format_value(point.raised_exception) }
  end
end

status = 0
Dir.chdir(File.dirname(entry_real)) do
  tracepoint.enable
  begin
    load entry_real
  rescue Exception => e # rubocop:disable Lint/RescueException -- must observe whatever user code raises
    status = 2
    warn "entry raised #{e.class}: #{e.message}"
  ensure
    tracepoint.disable
  end
end

File.write(out_path, JSON.generate(events))
exit status
