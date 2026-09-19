# entry point that never returns; the tracer's 10s timeout should kill this
# child process and analyze.rb should report a clear, non-zero-exit error.
loop do
  1 + 1
end
