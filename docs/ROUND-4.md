# Round 4 — side effects + constants

Static only. (Observing effects in the recorded trace is a later round.)

```js
packages = {
  A: "analyzer: effects.* layers + per-method verdict + defs.constants + --all-constants",
  B: "web viewer: effects namespace look, verdict badges in the rail, fixture + smoke + guide shot",
  C: "layers.nvim: effects.* + constants layers, verdict in the panel, --all-constants",
}
order = "A → (B ∥ C)"
```

No schema change: effect marks use the existing roles, and extra facts go in `mark.data`.

## Effect kinds → layers

| Layer | A mark goes on… | role | symbol | data (besides `scope`) |
|-------|-----------------|------|--------|------------------------|
| `effects.state` | the target of a write to `@ivar` / `@@cvar`, or the message of `self.x = …` / a mutator whose receiver is rooted at `self`/an ivar/an implicit-self call (`@items << x`, `items.clear`) | `write` | the ivar symbol (`Invoice@items`) when it is an ivar, else `null` | `{ kind: "state" }` |
| `effects.global` | `$global` writes, constant (re)assignment **inside a method**, `ENV[]=`, and class-shape changes inside a method (`define_method`, `include`, `extend`, `attr_*`, `alias_method`, `remove_method`, `const_set`, `instance_variable_set`, `class_eval`/`instance_eval`/`send`/`public_send` are NOT here — see unknown) | `write` | `null` | `{ kind: "global" }` |
| `effects.args` | the message of a mutator / attribute-writer whose receiver is rooted at a **parameter or block parameter** (`log << x`, `order.status = :sent`, `order.items.sort!`) | `reference` | `<scope>/<param>` (the param's `vars.locals` symbol) | `{ kind: "args", target: "log" }` |
| `effects.io` | the message of a catalogued effectful or non-deterministic call | `reference` | `null` | `{ kind: "io", what: "output" \| "file" \| "network" \| "process" \| "time" \| "random" \| "input" }` |
| `effects.control` | `raise` / `fail` / `throw` / `exit` / `exit!` / `abort` | `reference` | `null` | `{ kind: "control" }` |
| `effects.calls` | a call site that RESOLVES to a project method whose verdict is impure | `reference` | the target's symbol (so jump works) | `{ kind: "calls", via: "Mailer#deliver", effects: ["io"] }` |
| `effects.unknown` | a call site we cannot classify (see below) | `reference` | `null` | `{ kind: "unknown", name: "frobnicate" }` |

Receiver root analysis (walk the receiver chain to its root): plain **local** (not a param) → mutation is
local, NOT an effect (`list = []; list << 1`); **param / block param** → `args`; **`self`, ivar,
implicit-self call** → `state`; **constant** (`CACHE[:k] = v`, `LOG << x`) → `global`; anything else → `unknown`.

Mutators = any name ending in `!`, attribute writers (`x=` with a receiver, `[]=`), and a catalog:
`<< push append prepend pop shift unshift insert concat delete delete_at delete_if clear replace
fill store update merge! add add? subtract keep_if reject! select! map! collect! sort! sort_by!
uniq! compact! flatten! shuffle! reverse! rotate! slice! transform_values! transform_keys! freeze
(not an effect — omit) force_encoding encode! gsub! sub! squeeze! strip! chomp! chop! upcase!
downcase! capitalize! swapcase! tr! succ! next! setbyte`. Keep the catalogs in ONE file
(`adapters/ruby/lib/effect_catalog.rb`) as frozen sets with a comment per group.

IO catalog (receiver-less or on the obvious constant): output `puts print p pp warn printf putc
display $stdout/$stderr/STDOUT/STDERR.*`; input `gets readline readlines STDIN.* ARGF.*`; file
`File.* IO.* Dir.* FileUtils.* Pathname#write/…, open, require/load are NOT effects`; process
`system exec spawn fork ` `` `cmd` `` ` %x() Process.* Kernel#trap at_exit sleep`; network `Net::* URI.open
Socket* TCPSocket*`; time `Time.now Time.current Date.today DateTime.now Process.clock_gettime`;
random `rand srand Random.* SecureRandom.* Array#sample Array#shuffle`.

**Unknown** must not drown the signal. A call is `unknown` only when ALL hold: it does not resolve
to a project method; it is not in the mutator/IO/control catalogs; it is not an operator or
`[]`/`!`/`==`-style method; it is not in the **known-pure catalog** (a generous list of core
query/transform methods: `each map select reject find detect all? any? none? sum count size
length first last min max sort sort_by group_by partition zip each_with_index each_with_object
inject reduce flat_map to_a to_h to_s to_sym to_i to_f to_r inspect dup clone freeze frozen? nil?
empty? include? key? has_key? fetch dig keys values merge slice strip upcase downcase capitalize
split join format start_with? end_with? gsub sub tr round floor ceil abs between? clamp times
upto downto step new (on a non-project constant) is_a? kind_of? respond_to? instance_of? equal?
eql? hash then tap yield_self itself lambda proc block_given? require require_relative
attr_reader-style reads, Struct/Data/Set/Hash/Array/String/Integer/Float/Rational constructors …`)
— extend sensibly; and it is not `super`/`yield` (yield/`block.call` → unknown IS correct: the
block could do anything — mark the `yield` keyword). `send`/`public_send`/`__send__`/
`instance_eval`/`class_eval`/`method_missing`-style dynamic dispatch → always `unknown`.
Effects inside a block belong to the enclosing METHOD.

## Verdicts (per method)

```js
// stored on the method's defs.methods mark:
data = { scope: "Mailer#notify",
  effects: {
    verdict: "impure" | "pure" | "unknown",
    direct:  ["state", "io"],                          // kinds found in this method's own body, sorted
    via:     { "io": ["Mailer#deliver"] }               // kinds inherited through resolved calls → callee symbols, sorted
  } }
```

Fixpoint over resolved `refs.calls` edges (cycles terminate): a method's effect set = its direct
kinds ∪ each resolved callee's set. **`Foo.new` → `Foo#initialize` drops the callee's `state`
kind** (it mutates a brand-new object, not the caller's world). `control` propagates; `calls` and
`unknown` are not kinds that propagate as themselves — a callee's `unknown` makes the caller
`unknown` too. Verdict: any certain kind (`state global args io control`) → `impure`; else any
unknown → `unknown`; else `pure`. Top-level code (scope `null`) gets marks but no verdict.
`effects.calls` marks are emitted after the fixpoint. Everything stays deterministic (sorted).

## Constants

- `defs.constants`: every constant assignment (`MAX = 10`, `Foo::BAR = …`, `A, B = 1, 2`,
  `X ||= …`) → mark on the name, role `definition`, symbol = lexically qualified (`Shop::Cart::MAX`).
- `refs.constants` now also resolves to `defs.constants` symbols (same lexical lookup as classes).
- `--all-constants`: ALSO emit unresolved constant reads (stdlib, other files) in `refs.constants`
  with symbol = the path as written (`JSON`, `ActiveRecord::Base`), `data.resolved = false`
  (resolved ones get `data.resolved = true` always). Without the flag behaviour is unchanged.
  Meant for single-file/editor use where most definitions live elsewhere.

## B. Web viewer

- `effects.*` and `defs.constants` are static layers; **`effects.*` default OFF** (like `exec.*`)
  — they overlap other layers by design. Look: tinted bg + **wavy underline** in the layer colour.
  The palette must stay distinct with ~17 layers: make hue assignment namespace-aware (each
  namespace gets a hue family, layers inside it spread within the family) and keep it deterministic.
- Hovering an effect token shows a `title` tooltip built from `data` (`io: output`, `mutates arg: log`,
  `calls impure Mailer#deliver → io`). The Symbol panel, when the selected symbol is a method,
  shows its verdict line and `direct` / `via` lists (via entries are clickable → jump to that method).
- Rail: method group headers (per-file accordions) and `defs.methods` items get a verdict badge:
  `●` impure (red-ish) · `○` pure (green-ish) · `?` unknown (amber), tooltip = direct/via summary.
  A small filter in the file accordion header: `all | impure | pure | unknown` (hides method groups
  that don't match; persisted per project).
- Fixture: regenerate `fixtures/example-ruby` so it contains exactly what the analyzer emits for
  effects/constants (extend `fixture.spec.json` + `scripts/build-fixture.mjs` with an optional
  trailing `data` object per mark and per-method `effects` verdicts) — the analyzer's
  "static layers match the fixture exactly" test must keep passing. Update smoke counts, the
  example presentation/bundle, and add guide shot `14-effects`.

## C. layers.nvim

- Pass `--all-constants`. New layers appear automatically; add default highlight groups:
  `defs.constants` (defs look), `effects.*` = `undercurl` + tinted bg in a red/amber family;
  `effects.*` default OFF. `refs.constants` with `data.resolved == false` uses a dimmer variant
  (`Layers_refs_constants_unresolved`).
- `:LayersEffects` = shortcut for "only effects.* + defs.methods, focus on"; again → restore the
  previous enabled set. `<Plug>(layers-effects)`.
- Panel METHODS rows show the verdict badge (`●`/`○`/`?`) with its own highlight groups
  (`LayersVerdictImpure/Pure/Unknown`); `:LayersInfo` lists `impure: N · pure: N · unknown: N`.
- `:LayersSymbol` on a method name echoes the verdict + direct/via; on an effect token echoes
  the human text for its `data`.
