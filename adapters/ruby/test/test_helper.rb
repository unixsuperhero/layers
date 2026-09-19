# frozen_string_literal: true

require "minitest/autorun"
require "fileutils"
require "tmpdir"

LIB = File.expand_path("../lib", __dir__)
SAMPLES = File.expand_path("samples", __dir__)
FIXTURE_DIR = File.expand_path("../../../fixtures/example-ruby", __dir__)

%w[symbols file_discovery scope_index static_visitor project_index constant_resolver
   call_resolver tracer_support doc_writer].each { |f| require File.join(LIB, f) }
