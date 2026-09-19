# Ruby analyzer

Implements `docs/ROUND-3.md` section A and `docs/ROUND-4.md`'s analyzer package:
`bin/layers-analyze <file-or-dir>... [--entry FILE] [--root DIR] [--out DIR] [--bundle FILE]
[--name NAME] [--all-constants]`. Parser is [Prism](https://github.com/ruby/prism) 1.9
(pinned in `Gemfile`), pulled in via `bundler/setup` regardless of the caller's cwd.

## Setup

```sh
cd adapters/ruby && bundle install
```

`bin/layers-analyze` sets `BUNDLE_GEMFILE` to this directory's `Gemfile` by its own location
(not the caller's `pwd`), so it can be run from anywhere. If gems aren't installed it fails
fast with `error: run 'bundle install' in adapters/ruby`.

## How it works

- **`analyze.rb`** -- CLI entry point (loaded by `bin/layers-analyze`). Parses argv, discovers
  `.rb` files (`lib/file_discovery.rb`), runs the static analyzer over every file that parses,
  optionally spawns the tracer as a child process, and writes `--out`/`--bundle`.
- **`lib/static_visitor.rb`** -- a `Prism::Visitor` that walks one file's AST and produces, in a
  single pass: `defs.classes` / `defs.methods` / `defs.attributes` / `defs.constants` marks
  (final), `vars.locals` / `vars.ivars` / `vars.temps` marks (final -- these only need in-file
  information), plus `def_records` (structured owner/name/kind rows for the cross-file index)
  and raw, *unresolved* `refs.constants` / `refs.calls` occurrences (they need to see every
  file's definitions first).
- **`lib/effect_catalog.rb`** / **`lib/effects_visitor.rb`** / **`lib/effect_verdicts.rb`** --
  round 4's side-effect analysis; see "Effects" below.
- **`lib/project_index.rb`** -- combines every file's `def_records` into lookup tables (by
  owner+name, and by bare name project-wide). Also tracks which symbols are constants (round 4)
  and which are attr-only (no real `def`) for the effects fixpoint.
- **`lib/constant_resolver.rb`** / **`lib/call_resolver.rb`** -- resolve the raw occurrences
  against that index, following the resolution order in `docs/ROUND-3.md` (constants use the
  same lexical-nesting lookup as classes -- round 4). A call/constant that doesn't resolve is
  simply skipped (v1), never guessed -- except `--all-constants`, see "Constants" below.
- **`lib/scope_index.rb`** -- given every method's full `def ... end` byte span, answers "which
  method encloses offset X in file F", used to fill `exec.path`'s `data.scope` from a trace
  event's location (a trace event itself carries no scope).
- **`trace.rb`** -- runs the entry file under `TracePoint` and writes the raw events as JSON.
  Always launched as a **child process** by `analyze.rb` (`lib/tracer_support.rb` holds the
  shared byte-offset/formatting helpers), against a **temporary byte-exact copy** of the project
  (never the user's own tree), cwd set to the entry's directory so `require_relative` works.
  `analyze.rb` enforces the 10s timeout and SIGKILLs the child if it's exceeded; a raised,
  uncaught exception in the traced program is not fatal (partial trace kept, `analyze.rb` warns
  on stderr and still exits 0) -- only a timeout or an unexpected crash is fatal.
- **`lib/doc_writer.rb`** -- assembles `layers.json` (canonical sort: layers by id, marks by
  `(file, start, end, symbol ?? "")`) and the bundle format, and writes deterministic 2-space
  pretty JSON with a trailing newline.

## Symbol scheme

| Kind | Symbol | Example |
|---|---|---|
| class/module | `Owner::Name` (lexical nesting) | `Foo::Bar` |
| instance method | `Owner#name` | `Invoice#summary` |
| singleton method (`def self.x`) | `Owner.name` | `Invoice.build` |
| top-level method | `main#name` | `main#helper` |
| attribute (`attr_reader/writer/accessor`) | `Owner#name` (same scheme as an instance method, whichever kind) | `Invoice#items` |
| ivar | `Owner@name` (`main@name` at top level) | `Invoice@items` |
| local/param/block-param | `<enclosing-method-symbol-or-"main">/name` | `Invoice#summary/total`, `main/invoice` |
| shadowed local (a block param/local reusing an outer name) | `.../name@<line the block opens>` | `Widget#shadow_demo/total@20` |

Locals: a name is tracked per lexical *frame* (method body = frame 0, each block/lambda opens a
new frame). If a name is bound in exactly one frame anywhere in its method, it gets the plain
`<method>/name` symbol no matter how deeply nested that frame is (this is what makes a block
param like `|item|` get the plain form in the fixture). Only when the **same name** is bound in
**more than one distinct frame** within the same method (a real shadow, e.g. a block param
reusing an outer local's name) do the non-root occurrences get the `@<line>` suffix -- the
root/method-level occurrences always stay plain.

`vars.temps`: a *local* (not a param) with exactly one write, at most two reads, and never
touched from inside a nested block -- and only within a method (a top-level/`main` local is
never considered a temp, even if it otherwise qualifies).

## Verified against `fixtures/example-ruby`

Running the static analyzer alone (`bin/layers-analyze fixtures/example-ruby/src --out DIR`)
produces `defs.*` / `vars.*` / `refs.*` marks that are an **exact match** (not just a superset)
of the hand-written `fixtures/example-ruby/layers.json`, including every `data.scope`. See
`adapters/ruby/test/fixture_static_test.rb` and `test/analyze-cli.test.js` (repo root).

With `--entry main.rb`, the real trace is a legitimate **superset** of the fixture's 24
hand-written trace events (same order, same `(event, file, depth)`, one-off tolerances -- see
"Known differences from the hand-written fixture" below).

## Known differences from the hand-written fixture (real behaviour wins, per spec)

The hand-written `trace` in `fixture.spec.json` is a *curated* 24-event trace starting from
`main.rb`'s first real statement. A real `TracePoint` run captures the true, larger event
stream:

1. **Extra top-level `line` events while loading each file.** `require_relative`, each
   `class`/`module` body's own statements, and each `def ... end` statement itself all fire real
   `:line` events at depth 0 *before* `main.rb`'s first statement runs (Ruby executes a class
   body and each `def` as ordinary top-level code when the file loads). The fixture skips
   straight to `invoice = Invoice.new(...)`. Our trace has 35 events; the fixture's 24 appear
   in order as a subsequence (asserted in `test/analyze-cli.test.js`).
2. **`return` fires even when a method exits via an uncaught exception** (Ruby has fired
   `:return` on an exception unwind since 2.7). `adapters/ruby/test/samples/raises/entry.rb`'s
   `risky` method gets both a `raise` event and a `return` event (`value: "nil"`).
3. **Object `#inspect` normalization is more aggressive than "strip the hex id".** The contract's
   example (`#<Invoice:0x000...> -> #<Invoice>`) is implemented as a full collapse to
   `#<ClassName>` for *any* default-`#inspect`d object -- ivars are dropped too, not just the
   object id, because an ivar dump can itself embed another object's id or a hash-ordering-
   sensitive collection, which would break the "byte-identical across runs" requirement for any
   program less trivial than the fixture's `Array`. This only affects objects that don't
   override `#inspect`; strings/numbers/arrays/hashes/`nil` pass through unchanged. **Known
   limitation:** the collapse is a whole-string match (`\A#<ClassName...>\z`), so a custom
   object nested *inside* an array/hash (e.g. `"[#<Invoice:0x00.. >, #<Invoice:0x00..>]"`) is not
   normalized -- not exercised by the fixture or by any sample here.

## Effects (round 4, `docs/ROUND-4.md`)

Two more passes run alongside the round-3 static pass, both file-local (no cross-file
information needed) except the final fixpoint:

1. **`lib/effects_visitor.rb`** -- a second `Prism::Visitor` walk producing the DIRECT
   `effects.state` / `.global` / `.args` / `.io` / `.control` / `.unknown` marks. Ivar/cvar/gvar
   writes and constant reassignment are handled by their own AST node types; everything else
   (mutators, attribute writers, IO/control/class-shape/dynamic-dispatch calls) goes through one
   classifier on `CallNode`, checked in this order: **mutator or attribute writer** (name ends
   in `!`, is in `EffectCatalog::MUTATOR_NAMES`, or `CallNode#attribute_write?`/one of the
   compound-assignment node types) -> **IO catalog** -> **control catalog** -> **class-shape
   name, only if lexically inside a method** -> **dynamic-dispatch name (always unknown)** ->
   **known-pure catalog or operator-style name (no mark)** -> otherwise deferred as a "pending
   call" for the next stage. A mutator's effect kind comes from **receiver-root analysis**:
   walk the receiver chain, peeling off plain zero-arg/no-block attribute-style hops, until it
   bottoms out at a local (not an effect), a parameter/block-param (`args`), `self`/an ivar/an
   implicit-self call (`state`), a constant (`global`), or anything else (`unknown`). Blocks
   only push a new *parameter* frame for this resolution -- they never change the enclosing
   method, so an effect inside a block is attributed to that method, per spec.
2. **`lib/effect_verdicts.rb`** -- once every file's `refs.calls` are resolved (round 3), each
   pending call either turns into a call-graph edge (resolves to a real `def`), a pure leaf
   (resolves to an attr-only symbol -- `attr_reader`/`writer`/`accessor`-generated methods have
   no body, so calling one contributes nothing), or an `effects.unknown` mark (didn't resolve).
   A monotone fixpoint (kinds only ever get added, and there are 6 possible kinds total, so it
   provably terminates even through mutual recursion or self-recursion) then computes each
   method's total effect-kind set = its own direct kinds union its resolved callees' sets --
   with `Foo.new` calls (resolving through `Foo#initialize`) dropping the callee's `state` kind
   first, since a fresh object's own mutations aren't the caller's. `effects.calls` marks are
   then emitted for every resolved call site (method-scoped or top-level) whose *contributed*
   kind set (after any `.new` adjustment) is non-empty -- this is why `Invoice.new(...)` gets no
   mark even though `Invoice#initialize` itself is impure, but `Mailer.new.notify(...)` does.
   Verdict: any of `state`/`global`/`args`/`io`/`control` -> `impure`; else `unknown` present ->
   `unknown`; else `pure`.

### Catalogs (`lib/effect_catalog.rb`)

Frozen, name-based (no type inference): `MUTATOR_NAMES`, `IO_BARE`/`IO_RECEIVER_WILDCARD`/
`IO_RECEIVER_MESSAGE`/`IO_MESSAGE_ANY_RECEIVER` (checked in that order --  most-specific
receiver+message pair first, then a wildcard receiver, then a receiver-less bare name, then a
small any-receiver set for `Array#sample`/`#shuffle`), `CONTROL_NAMES`, `DYNAMIC_DISPATCH_NAMES`
(always unknown, overriding everything else), `CLASS_SHAPE_NAMES` (an effect only inside a
method), `OPERATOR_NAMES` (excluded from `effects.unknown` even when unresolved), and a generous
`KNOWN_PURE_NAMES`. The catalog was extended beyond `docs/ROUND-4.md`'s own list from running the
analyzer against `fixtures/mockapp/src` and reviewing every `effects.unknown` name it produced
(see the project's final report for the full before/after).

### Soundness

**Impure is reliable: pure means "found nothing AND every call resolved to something known
(a real method or an attr reader)".** A method can be marked `pure` while genuinely doing
something effectful if: the effect is reached only through a call this analyzer can't resolve
(ambiguous bare-name match, no inheritance modeling, `method_missing`-based dispatch, a block
executed via `yield`/`#call` -- these are marked `unknown`, not silently `pure`, so in practice
"looks pure" and "actually is unknown" are distinguished); a project method happens to be named
like a mutator (bang-suffixed, `<<`, etc.) but its body is pure -- the call SITE is still marked
as a direct mutator effect (this analyzer never resolves a bang-suffixed/catalogued-name call as
a call-graph edge into its own body, since receiver-root classification is purely syntactic and
takes priority); or the effect is behind `super` (unmarked, never resolved -- no class hierarchy
is modeled).

## Known limitations (v1, matches the spec's stated scope)

- `refs.calls`: only resolves the four shapes in `docs/ROUND-3.md` ("Resolution order"); a
  receiver that's itself an arbitrary non-const/non-self expression falls to a *project-wide
  exact bare-name match*, skipped on 0 or 2+ matches. No type inference.
- `refs.constants`: lexical-nesting resolution is an approximation (checks
  `nesting[0..n] + written-name` from innermost to top-level) -- doesn't fully replicate Ruby's
  constant lookup (e.g. mixed-in modules' constants, `Module#const_get` edges).
- `class << self` (singleton-class reopening blocks) isn't specifically handled; only
  `def self.x` is recognized as a singleton method.
- ivar owner is the nearest *lexical* enclosing class/module, not the runtime receiver's class
  (irrelevant for straight-line code; would differ for a method `module_eval`'d into another
  class).
- The tracer's per-event span for `:raise` isn't specified by the contract (only
  `line`/`return`/`b_return`/`call`/`b_call` are); we use the trimmed source line at the point of
  the raise, same algorithm as every other event kind.
- **Effects: no type inference, receiver-root heuristic.** A mutator's effect kind comes purely
  from walking the RECEIVER'S SYNTAX, not its runtime type -- `x.sort!` is `state`/`args`/etc.
  based on how `x` is written, never on what `x` actually holds.
- **Effects: aliasing a param into a local hides a mutation.** `def f(list); copy = list;
  copy << 1; end` marks nothing (`copy` is a plain local, not a param), even though `copy` and
  `list` are the same object at runtime -- this is the direct consequence of the receiver-root
  algorithm being purely lexical/syntactic (`docs/ROUND-4.md`'s own definition).
- **Effects: blocks and closures.** An effect inside a block is always attributed to the
  *lexically* enclosing method, even if the block escapes it (stored and called much later, or
  never called at all) -- there's no control-flow or escape analysis. `yield` and `x.call` (any
  no-arg-name `call` on any receiver) are always `unknown`, never resolved, since a block passed
  into a project method could itself do anything.
- **Effects: no inheritance in the call graph.** `refs.calls` (round 3) doesn't search
  superclasses, so `Sub.new.inherited_method` where `inherited_method` is defined only on a
  superclass doesn't resolve -- it's `unknown`, not wrongly `pure`. Confirmed against
  `fixtures/mockapp/src` (`Account.all`/`Book.all`/etc., defined only on the `MemoryRecord`
  superclass, come back `unknown`).
- **Effects: a project method whose call resolves ambiguously (2+ bare-name matches, e.g. two
  classes each defining `#call`) is `unknown`, never guessed** -- same "skip, don't guess"
  philosophy as round 3's `refs.calls`.
- **Effects: `method_missing`-based dynamic attributes are `unknown` by design** -- there's no
  static definition to resolve to, so e.g. `record.some_column` on a `method_missing`-backed
  model is correctly flagged `unknown` rather than assumed pure or assumed a mutator.

## Constants (round 4, `docs/ROUND-4.md`)

`defs.constants`: every constant assignment (`MAX = 10`, `Foo::BAR = ...`, multi-assign,
`X ||= ...`) gets a mark on the name, lexically qualified exactly like a class definition
(same known approximation as `refs.constants`' lookup, see above). `refs.constants` now also
resolves reads against those symbols; every resolved mark carries `data.resolved = true`.
`--all-constants` additionally emits UNRESOLVED reads (stdlib, another gem, anything not defined
in the analyzed files) with `symbol` = the path exactly as written and `data.resolved = false` --
meant for single-file/editor use, where most of a project's real definitions live outside the
one open file.

Ruby forbids constant (re)assignment lexically inside any `def...end` (`dynamic constant
assignment`, a genuine `SyntaxError` -- Prism's parser rejects it too, not just MRI's), so
`docs/ROUND-4.md`'s "inside a method [constant reassignment] is both defs.constants and
effects.global" can only ever be exercised by driving the visitor directly (see
`test/effects_test.rb`), never through an actual parseable `.rb` file -- there is no bug being
worked around here, that code path is simply unreachable through this CLI's normal input.
