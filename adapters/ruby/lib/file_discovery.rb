# frozen_string_literal: true

require "pathname"

# Expands CLI file/dir arguments into an absolute file list plus a computed
# project root, matching docs/ROUND-3.md section A.
module FileDiscovery
  SKIP_DIRS = %w[vendor node_modules .git tmp].freeze

  module_function

  # inputs: array of path strings (files or dirs)
  # root_override: explicit --root, or nil to compute the common ancestor
  # returns: { root: Pathname, files: [Pathname absolute, sorted, unique] }
  def expand(inputs, root_override: nil)
    raise ArgumentError, "no input paths given" if inputs.empty?

    abs_inputs = inputs.map { |p| Pathname.new(p).expand_path }
    abs_inputs.each do |p|
      raise Errno::ENOENT, p.to_s unless p.exist?
    end

    files = []
    abs_inputs.each do |p|
      if p.directory?
        files.concat(find_rb_files(p))
      else
        files << p
      end
    end
    files = files.map(&:expand_path).uniq.sort_by(&:to_s)

    # "the common ancestor of all inputs" (docs/ROUND-3.md) -- of the given paths, not of the
    # (possibly much deeper) files discovered inside a directory input.
    root = root_override ? Pathname.new(root_override).expand_path : common_ancestor(abs_inputs)
    { root: root, files: files }
  end

  def find_rb_files(dir)
    result = []
    dir.each_entry do |entry|
      name = entry.to_s
      next if name == "." || name == ".."
      next if SKIP_DIRS.include?(name)

      full = dir + entry
      if full.directory?
        result.concat(find_rb_files(full))
      elsif full.extname == ".rb"
        result << full
      end
    end
    result
  end

  def common_ancestor(paths)
    dirs = paths.map { |p| p.directory? ? p : p.dirname }
    parts = dirs.map { |d| d.to_s.split(File::SEPARATOR) }
    shortest = parts.min_by(&:length)
    common = shortest.each_index.take_while { |i| parts.all? { |p| p[i] == shortest[i] } }
    Pathname.new(common.map { |i| shortest[i] }.join(File::SEPARATOR))
  end
end
