# entry point that raises an uncaught exception; the tracer should keep the
# trace up to and including the "raise" event, then let analyze.rb warn and
# still exit 0.
def risky
  raise "boom"
end

risky
