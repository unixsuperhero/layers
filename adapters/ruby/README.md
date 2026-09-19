# Ruby analyzer

Implements `docs/ROUND-3.md` section A: `bin/layers-analyze <file-or-dir>... [--entry FILE]
[--root DIR] [--out DIR] [--bundle FILE] [--name NAME]`. Parser is [Prism](https://github.com/ruby/prism)
1.9 (pinned in `Gemfile`), pulled in via `bundler/setup` regardless of the caller's cwd.

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
  single pass: `defs.classes` / `defs.methods` / `defs.attributes` marks (final), `vars.locals` /
  `vars.ivars` / `vars.temps` marks (final -- these only need in-file information), plus
  `def_records` (structured owner/name/kind rows for the cross-file index) and raw, *unresolved*
  `refs.constants` / `refs.calls` occurrences (they need to see every file's definitions first).
- **`lib/project_index.rb`** -- combines every file's `def_records` into lookup tables (by
  owner+name, and by bare name project-wide).
- **`lib/constant_resolver.rb`** / **`lib/call_resolver.rb`** -- resolve the raw occurrences
  against that index, following the resolution order in `docs/ROUND-3.md`. A call/constant that
  doesn't resolve is simply skipped (v1), never guessed.
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
