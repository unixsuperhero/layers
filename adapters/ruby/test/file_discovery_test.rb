# frozen_string_literal: true

require_relative "test_helper"

class FileDiscoveryTest < Minitest::Test
  def test_expands_a_directory_recursively_and_skips_vendor_dirs
    Dir.mktmpdir do |dir|
      FileUtils.mkdir_p(File.join(dir, "a", "b"))
      FileUtils.mkdir_p(File.join(dir, "vendor"))
      File.write(File.join(dir, "a", "one.rb"), "")
      File.write(File.join(dir, "a", "b", "two.rb"), "")
      File.write(File.join(dir, "vendor", "skip.rb"), "")
      File.write(File.join(dir, "not_ruby.txt"), "")

      result = FileDiscovery.expand([dir])
      assert_equal Pathname.new(dir).expand_path.to_s, result[:root].to_s
      rels = result[:files].map { |f| f.relative_path_from(result[:root]).to_s }.sort
      assert_equal ["a/b/two.rb", "a/one.rb"], rels
    end
  end

  def test_computes_common_ancestor_as_root_when_not_given
    Dir.mktmpdir do |dir|
      FileUtils.mkdir_p(File.join(dir, "src", "lib"))
      File.write(File.join(dir, "src", "a.rb"), "")
      File.write(File.join(dir, "src", "lib", "b.rb"), "")

      result = FileDiscovery.expand([File.join(dir, "src", "a.rb"), File.join(dir, "src", "lib", "b.rb")])
      assert_equal Pathname.new(File.join(dir, "src")).expand_path.to_s, result[:root].to_s
    end
  end

  def test_raises_enoent_for_a_missing_path
    assert_raises(Errno::ENOENT) { FileDiscovery.expand(["/no/such/path/at/all"]) }
  end
end
