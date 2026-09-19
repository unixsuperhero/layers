# frozen_string_literal: true

require "set"
require_relative "static_visitor"

# Turns EffectsVisitor's per-file direct-effect data into the project-wide picture
# (docs/ROUND-4.md "Verdicts"): resolves the deferred call sites against the already-resolved
# refs.calls marks, runs the fixpoint over the call graph, emits effects.calls / the remaining
# effects.unknown marks, and attaches `data.effects = { verdict, direct, via }` to every
# defs.methods mark.
module EffectVerdicts
  CERTAIN_KINDS = %w[state global args io control].freeze

  module_function

  # pending_calls:  [EffectsVisitor::PendingCall, ...] from every file's EffectsVisitor
  # resolved_calls: [StaticVisitor::Mark, ...] -- the refs.calls marks (CallResolver's output)
  # index:          the ProjectIndex (to tell an attr-only symbol from a real method)
  # direct_kinds:   { method_symbol => Set<kind> }, MUTATED in place with kinds contributed by
  #                 calls that turned out unresolved (added here as they're discovered)
  # method_symbols: Set of every real (`def`) method symbol -- the fixpoint's node universe
  #
  # Returns { unknown_marks:, calls_marks:, effects_by_method: { symbol => {verdict:, direct:, via:} } }
  def compute(pending_calls:, resolved_calls:, index:, direct_kinds:, method_symbols:)
    resolved_index = {}
    resolved_calls.each { |m| resolved_index[[m.file, m.start]] = m.symbol }

    edges_by_scope = Hash.new { |h, k| h[k] = [] } # method_symbol -> [[target, drop_state], ...]
    call_candidates = [] # every pending call that resolved to a real method (any scope, incl. nil)
    unknown_marks = []

    pending_calls.each do |pc|
      target = resolved_index[[pc.file, pc.start]]

      if target && !index.attr_only?(target)
        edges_by_scope[pc.scope] << [target, pc.drop_state] if pc.scope
        call_candidates << pc.to_h.merge(target: target)
      elsif target.nil?
        direct_kinds[pc.scope] << "unknown" if pc.scope
        unknown_marks << StaticVisitor::Mark.new(layer: "effects.unknown", file: pc.file, start: pc.start,
                                                   finish: pc.finish, symbol: nil, role: "reference",
                                                   scope: pc.scope, extra: { "kind" => "unknown", "name" => pc.message })
      end
      # else: resolved to an attr-only symbol -- a pure leaf, no mark, no edge.
    end

    total = fixpoint(method_symbols, direct_kinds, edges_by_scope)
    calls_marks = build_calls_marks(call_candidates, total)
    effects_by_method = build_method_effects(method_symbols, direct_kinds, edges_by_scope, total)

    { unknown_marks: unknown_marks, calls_marks: calls_marks, effects_by_method: effects_by_method }
  end

  def fixpoint(method_symbols, direct_kinds, edges_by_scope)
    total = {}
    method_symbols.each { |m| total[m] = direct_kinds[m].dup }

    changed = true
    while changed
      changed = false
      method_symbols.each do |m|
        merged = total[m].dup
        edges_by_scope[m].each do |target, drop_state|
          contrib = total.fetch(target, Set.new).dup
          contrib.delete("state") if drop_state
          merged.merge(contrib)
        end
        next if merged == total[m]

        total[m] = merged
        changed = true
      end
    end
    total
  end

  def build_calls_marks(call_candidates, total)
    call_candidates.filter_map do |pc|
      contributed = total.fetch(pc[:target], Set.new).dup
      contributed.delete("state") if pc[:drop_state]
      next if contributed.empty?

      StaticVisitor::Mark.new(layer: "effects.calls", file: pc[:file], start: pc[:start], finish: pc[:finish],
                               symbol: pc[:target], role: "reference", scope: pc[:scope],
                               extra: { "kind" => "calls", "via" => pc[:target], "effects" => contributed.sort })
    end
  end

  def build_method_effects(method_symbols, direct_kinds, edges_by_scope, total)
    method_symbols.each_with_object({}) do |m, out|
      via = Hash.new { |h, k| h[k] = [] }
      edges_by_scope[m].each do |target, drop_state|
        contrib = total.fetch(target, Set.new).dup
        contrib.delete("state") if drop_state
        contrib.each { |kind| via[kind] << target }
      end
      via.each_value { |list| list.uniq!; list.sort! }

      out[m] = { "verdict" => verdict_for(total[m]), "direct" => direct_kinds[m].to_a.sort,
                 "via" => via.sort.to_h }
    end
  end

  def verdict_for(kinds)
    return "impure" if kinds.any? { |k| CERTAIN_KINDS.include?(k) }
    return "unknown" if kinds.include?("unknown")

    "pure"
  end
end
