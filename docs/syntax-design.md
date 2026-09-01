# .fai.js Syntax Design

English | [中文](syntax-design.zh.md)

> Position: this document is the **syntax contract** and **incremental execution contract** of `.fai.js` — what may be written, how it maps to `ScriptIR`, how generated code is named, how terminals are derived, and how the engine replays only what changed.
>
> Related: [`docs/api-contract.md`](api-contract.md) owns the interface contract (identity, statement model, terminal detection, execution, geometry dispatch); [`docs/ops-api-inventory.md`](ops-api-inventory.md) is the generated API manual for writing `.fai.js` code.
>
> §1 quotes the requirements from the Faijs language design notes kept outside this repository; the Chinese originals are quoted verbatim in the Chinese counterpart of this document.

---

## 1. Requirement baseline

### 1.1 Requirements (original wording)

> - **R1** Support brep / mesh / sdf (and even point-cloud reverse engineering) modeling at the same time.
> - **R2** Support multiple backend engines — brep uses OCCT, mesh uses manifold — and keep engine switching possible.
> - **R3** Support UI modeling (a click emits code) and AI modeling (text → source); this is the most important feature. Interactive running must work — UI and AI code alternate and stay compatible.
> - **R4** The faijs engine parses and validates code, eliminating errors and security risks up front; execution is handed to the JavaScript VM.
> - **R5** All geometry operations are implemented by the faijs language library; the engine embeds none.
> - **R6** faijs does not handle UI state, only geometry — the biggest difference from macro languages like FreeCAD macros.
> - **R7** faijs supports UI recording and line-by-line incremental execution — the biggest difference from modeling languages like CadQuery and OpenSCAD.
> - **R8** faijs is a general-purpose language, not an op language: an op is just a function — the long-term direction. A third-party library just writes functions; it needs no concept of op.
> - **R9** faijs must be a normal language with a normal design; every design that breaks this must go, and today's implementation does not matter. One exception: the UI generates code automatically, so AI and UI code coexist.
> - **R10** Control flow is forbidden — no `if` / `for` / `while`. Otherwise AI-generated code would break what the canvas shows and how the timeline displays.
> - **R11** The UI layer is dumb and needs deterministic naming to generate and replay code, so UI-generated code uses `partN` (N an integer index). The rule constrains only UI-generated code — hand-written and AI code may use any name.
> - **R12** In one sentence: DAG liveness, plus inputs declared as retained are not consumed. The survivors are what the canvas shows.
> - **R13** The parser only does syntax analysis; it must never rewrite user code. `partN` naming is a UI concern, not the parser's.

### 1.2 Hard constraints derived from them

1. **Legal JS subset** — acorn parses any `.fai.js` file without error.
2. **parse-then-compile** — text becomes `ScriptIR` first; the VM runs the module compiled from it, never the user's text. `eval` / `new Function` / dynamic `import()` are rejected at the parser.
3. **No control flow** — the single language-level prohibition (§2.1); it keeps the canvas set and one-timeline-node-per-line derivable.
4. **Zero function knowledge** — no parser / compile / codegen / runtime branch depends on a function name; the machine-generated symbol table carries key existence only.
5. **UI and AI converge on one `ScriptIR`** — the engine never distinguishes provenance; icons, colors and display names are host concerns.
6. **Incremental execution is mandatory** — line-by-line recording and recomputation (§6.3).
7. **Code is the single source of truth** — text is the source; `ScriptIR` is an internal representation compiled from it; `scriptIRToCode` / `statementIRToLine` are debug-only printers.
8. **Naming is a generating-side responsibility** — UI / AI / CLI call `derivePartName` when emitting code; the parser neither names nor renames.

---

## 2. Syntax contract: a legal JS subset

### 2.1 Allowed and forbidden

| Allowed | Notes |
|---|---|
| Top-level `import` | Module declaration, not control flow: one contiguous top block; the namespace must be registered |
| Top-level function definitions | Recorded as `FunctionDefIR`; not statements, they do not enter the DAG; the body may contain control flow (§2.3) |
| **Control flow inside a function body** | `if` / `for` / `while` / `switch` / `try` / `throw` / `break` / `continue` / `labeled`, plus `var`; top level stays linear (§2.3) |
| **Local function calls** | `myFn(input, { … })` — bare-identifier callee from the script's own function set; four forms (§2.3), ABI in §6.2 |
| **Runtime expressions (`ExprIR`)** | A statement-variable expression is evaluated at runtime instead of folded (§2.4) |
| Statically foldable expressions | Binary / template / ternary / spread over parameters and literals fold to literals, marking `hasComputedArgs` (§2.4) |
| Any callee, any destructuring keys | The parser neither knows nor validates namespace function names |
| Member method calls | `asm1.add_constraint({ … })`; a call never consumes its receiver |
| `return { shape: … }` / `return [ … ]` | An explicit terminal set, overriding DAG derivation |
| `await` | Optional and stripped; codegen never emits it |

| Forbidden | Diagnostic |
|---|---|
| Control flow **at the top level** | `E_CONTROL_FLOW` — control flow lives in function bodies only |
| Dynamic `import()` | `E_IMPORT` — a control-flow construct |
| `eval` / `new Function` / `new` | `E_SYNTAX` — security red line (also inside function bodies) |
| `export` | `E_SYNTAX` — declaring outputs is the engine's job |
| Imports in a function body, non-contiguous top-level imports | `E_IMPORT` |
| Calling a local function **inside a function body** | `E_STATEMENT` — callable from the top level only (v1) |
| Unknown local function name at the top level | `E_REFERENCE` — the parser knows the script's function set |
| Duplicate function names | `E_STATEMENT` — a function name must be unique |

### 2.2 File container

- **Flat format** (recommended for UI recording): a plain statement sequence; with no `export default`, the parser wraps it into a legal container before acorn and reports line numbers against the original text.
- **`export default async (cad) => { … }`** is equally legal; **`// apiVersion: N`** is an optional header, default `1`.

### 2.3 Statement forms

```
script   = import* function* (comment | param | stmt)*
param    = const <name> = <literal | foldable expression>
stmt     = (const|let) <id> = [await] <ns>.<fn>(<input>*, { <k>:<v>, … }?)
         | const { <k1>: <id1>, … } = [await] <ns>.<fn>(<input>*, {…}?)
         | <id> = [await] <ns>.<fn>(<input>*, {…}?)
         | <id>.<method>({ <k>:<v>, … }?)
         | (const|let) <id> = [await] <localFn>(<input>*, { <k>:<v>, … }?)
         | <id> = [await] <localFn>(<input>*, {…}?)          // re-assignment
         | const { <k1>: <id1>, … } = [await] <localFn>(<input>*, {…}?)
         | [await] <localFn>(<input>*, {…}?)                  // side-effect call
         | return { shape: <id>, name?, color?, … }
         | return [ { shape: <id>, … }, … ]
function = function <name>(<param>, …) { <body> }             // body may contain control flow
```

- `<ns>` is `cad` or an imported namespace such as `mech`; positional inputs must be declared variables (zero, one or many), and the trailing options object may be omitted or may carry `keep` / `keepHidden` (§5.1).
- A bare reassignment is an ordinary JS assignment to a declared variable; it is how "modify this model" reads in code.
- **Local function calls** use a bare-identifier callee from the script's own function set; positional inputs bind to the first `M` parameters, the trailing object's keys to the rest by name (ABI in §6.2). A body may not call another local function (v1).
- **Function bodies** may contain arbitrary control flow, local `let` / `const` / `var`, conditional expressions, nested functions, and any `return` value; safety red lines (`eval` / `new` / dynamic `import()` / `import` / `export` / `class` / `with`) still apply inside bodies.
### 2.4 Expressions

| Form | Result |
|---|---|
| Literal (number / string / boolean / null) | `JsonValue` |
| Parameter name, or shorthand `{ size }` | `ParamRefIR { $param }` — resolved at execution time, never folded |
| Declared variable name | `VarRefIR { $ref }` |
| Array / object (recursive) | `JsonValue[]` / `Record<string, ArgIR>` |
| Nested `<ns>.<fn>(…)` call | `CallRefIR { $call }` — a read-only query, it consumes nothing |
| Binary / template / ternary / spread over parameters and literals | Folded to a literal; the statement is marked `hasComputedArgs: true` |
| **Expression referencing a statement variable** (`n > 10 ? 20 : 10`) | **`ExprIR { $expr }`** — kept verbatim, evaluated at runtime via an arrow wrapper; marked `hasComputedArgs: true` |

An `ExprIR` is a whitelisted grammar — `Literal` / `Identifier` / `Unary` / `Binary` / `Logical` / `Conditional` / `Array` (recursive), **no calls, no member access** (nested calls keep using `CallRefIR`); its value may be a Shape, not just JSON. Folding still wins for pure parameter/literal expressions — the runtime form only kicks in when folding fails. A folded statement keeps only the literal, so the host degrades it to read-only; `hasComputedArgs` gives the host the same cue.

### 2.5 Identifiers

Identifiers this project emits (codegen variable and parameter names, the fixed vocabulary `cad`, function names, argument names) must not be reserved in JavaScript (strict mode and module reserved words included), Python 3, C11 or Java. AI and hand-written code may use any legal JS identifier.

---

## 3. Statement model ↔ `StatementIR` mapping

The field-level contract of `StatementIR` and `ScriptIR` belongs to [`docs/api-contract.md`](api-contract.md); this section owns the text ↔ IR mapping.

### 3.1 Mapping rules

| Text (flat format) | IR |
|---|---|
| `const size = 20` | A parameter statement: `params += { name:'size', default:20 }`; a reference is `ParamRefIR { $param:'size' }`, compiling to `ctx.size = 20` |
| `let part0 = cad.box({ size })` | `{ id:'s2', callee:'box', args:{ size:{ $param:'size' } }, outputs:['part0'] }` |
| `let part1 = cad.drill(part0, { diameter:5 })` | `{ callee:'drill', inputs:['part0'], outputs:['part1'] }` |
| `cad.faceCenter(part0)` nested in args | `args.at = CallRefIR { $call:{ callee:'faceCenter', … } }` — the library owns the semantics |
| `const { front: part1, back: part2 } = cad.split(part0)` | `{ callee:'split', inputs:['part0'], outputs:['part1','part2'], outputKeys:['front','back'] }` |
| `let part2 = cad.union(part0, part1)` | `{ callee:'union', inputs:['part0','part1'], outputs:['part2'] }` |
| `let g = cad.group({ members: [part0, part1] })` | `{ callee:'group', inputs:[], args:{ members:[{$ref:'part0'},{$ref:'part1'}] }, outputs:['g'] }` |
| `asm1.add_constraint({ type:'face_mate' })` | `{ callee:'add_constraint', receiver:'asm1', inputs:[], outputs:[] }` |
| `let part3 = mech.makeHeadstock({ length:120 })` | `{ namespace:'mech', callee:'makeHeadstock', outputs:['part3'] }` |
| `return [{ shape: part0 }, { shape: part2 }]` | `terminalShapes = [{ id:'part0' }, { id:'part2' }]` |

### 3.2 IR is compiled from text

Direction is one-way: text → `parseScript` → `ScriptIR` → `compileToModule` → VM (§6.1); `scriptIRToCode` / `statementIRToLine` are debug-only; the rules are mechanical: a declared name is reassigned bare (`part0 = …`), an undeclared one declared (`let part0 = …`), destructuring rendered as `const { front: a, back: b } = ns.callee(…)`, numbers printed with at most six decimals, no trailing zeros.

---

## 4. Naming on the generating side

### 4.1 `derivePartName` — always a fresh name

| Rule | Condition | Result |
|---|---|---|
| R0 | `outputCount === 0` | No name (a member call or a void call) |
| Only rule | Every other case | One fresh `partN` per output |
| R4 | `inputCount > 1 && outputCount > 1 && inputCount === outputCount` | Rejected: `Shape[]` batch operations are not a language feature |

The input carries syntax facts only — `inputCount`, `outputCount`, and the code text, from which a lexical scan (`/\bpart(\d+)\b/g`) takes the next free index; no parse, no function metadata. Naming is decoupled from retention: a fresh name is allocated either way, and retention is expressed with `keep` (§5).

### 4.2 The parser does not name

The parser performs syntax analysis only: it copies lexical names into `inputs` / `outputs` / `receiver` / `$ref` and checks that referenced variables are declared. It never allocates or renames a name, so a UI-generated `partN` and an AI-written `asm1` survive verbatim.

---

## 5. `keep` and terminal detection

### 5.1 Declaring retention

A retention declaration says "this call does not consume these inputs", keeping them on the canvas. Written at the call site or once in a library function body; the call site wins.

```js
let part1 = cad.copy(part0)                                   // body keeps part0
let part2 = cad.drill(part0, { diameter: 8, keep: ['part0'] }) // call-site keep
let part3 = cad.union(part0, part1, { keepHidden: true })      // kept, hidden
```

```js
export function group(params) {
  keep(...params.members)
  return compound(params.members)
}
```

`keep` takes variable references or `{ shape, hidden }` entries; `keepHidden` sets the statement default. `validateKeepDirectives` rejects a non-array `keep`, non-reference entries, targets that are neither an input nor an argument variable, and a non-boolean `keepHidden`.

### 5.2 Effect

| Script | Terminals |
|---|---|
| `let part0 = cad.box({…})` | `part0` |
| `let part0 = cad.box(…)` then `let part1 = cad.drill(part0, …)` | `part1` — drill consumed `part0` |
| `let part1 = cad.copy(part0)` | `part0`, `part1` — the function body keeps the source |
| `const { front: part1, back: part2 } = cad.split(part0)` | `part1`, `part2` |
| `let g = cad.group({ members: [part0, part1] })` | `part0`, `part1`, `g` |
| `let a = cad.assembly({ members: [part0] })` then `a.do_assemble()` | `part0`, `a` — a member call never consumes its receiver |
| `let c = cad.bboxCenter(part0)` | `part0`, `c` — all outputs non-geometric, so nothing is consumed |

The decision chain behind this table — retention first, then "every output is non-geometric", then the default — and the leaf-terminal algorithm are owned by [`docs/api-contract.md`](api-contract.md). **Local function calls** (§2.3) follow the same chain with an opaque body: body-internal `cad.*` calls never register keeps (call-site `keep` is the only retention channel) and body intermediates never become terminals.

---

## 6. Execution and incremental execution

### 6.1 Pipeline

```
.fai.js text
  → parseScript (acorn gate, zero function knowledge) → ScriptIR
  → compileToModule → zero-import ESM (one { id, deps, fn } per statement)
  → dynamic import() (Node: data: URL; browser: Blob URL)
  → ModuleExecutor: persistent ctx, statements called in topological order
  → collectResult: outputs / terminals / compounds / brepSolids / topology
```

Compilation consumes only the IR, so user text never reaches the VM. The output is import-free because neither a `data:` URL nor a Blob URL resolves a bare specifier — the loader's property, not a language rule.

### 6.2 Uniform ABI

A library function signature is exactly what the source says — no implicit injection, no trailing context parameter. Compilation emits four forms:

```
assignment:      ctx.<out> = await ns.<ns>.<callee>(ctx.<input>, …, { …args })
destructuring:   const { <keys> } = await ns.<ns>.<callee>(…); ctx.<out_i> = <key_i>
member call:     await ctx.<receiver>.<callee>({ …args })
no assignment:   await ns.<ns>.<callee>(…)
```

`$param` and `$ref` both compile to `ctx.<name>`, a nested `$call` to `await ns.<ns>.<callee>(…)`. A parameter declaration is a statement too (`ctx.size = 20`), which is why a parameter change cascades like any other dependency.

**Local function ABI** (§2.3): `function <name>(<p1>, …, <pk>)` compiles to `async function <name>(__ctx, __ns, <p1>, …, <pk>)` — user parameters preserved verbatim after two injected engine parameters. A call binds positional-plus-named:
```
positional inputs  a1..aM  →  p1..pM        (M ≤ k, more → E_ARG)
args object keys   key_i   →  p_{M+1}..p_k  (by name; unknown key / collision → E_ARG)
unbound parameters          →  undefined    (JS semantics, no error)
keep / keepHidden           →  stripped first, never participate in binding
emission:  await localFns.<name>(ctx, ns, <p1>, …, <pM>, <v_{M+1}>, …, <vk>)
```

The wrapped body injects `const <binding> = __ns.<binding>` for `cad` and each top-level import binding, then embeds the user's body verbatim. A body may not call another local function (v1); its internal `cad.*` calls never enter the top-level DAG or register keeps (call-site `keep` is the only retention channel, §5), and transient OCCT handles are released on return except those reachable from the return value.

### 6.3 Incremental execution (three entries)

| API | Behavior |
|---|---|
| `execute(code)` | Full run: load the module, then execute every statement |
| `append(code, newIds)` | Execute only the new statements — the prefix is already in the persistent ctx |
| `update(code)` | `plan()` computes the stale set → `reconcileCtx` → recompute from that set in topological order; zero execution when nothing is stale |

All three take code text. `plan()` is content-addressed, not an id diff. `statementKey` is the namespace-qualified callee, the JSON of `args` without `keep` / `keepHidden`, and each dependency's `outputContentKey`; a parameter statement uses `param|JSON(value)`; a local-function call uses `local.<callee>#<bodyHash>` — editing a body changes every caller's key, so downstream recomputes; untouched bodies cost zero. Retention and visibility cost nothing: toggling `keep` recomputes no geometry. A statement is stale when a dependency is stale or its key changed.

### 6.4 `check()`

`CadRuntime.check(code)` is a dry run with no geometry side effects, in four stages: **parse** — acorn gate, `ParseError` with line and code (local-call existence and ABI binding enforced here); **symbol** — `cad` calls against the symbol table, namespaced calls against registered libraries, member methods and local calls skipped; **keep** — `validateKeepDirectives` plus a misspelled-`keep` warning; **reference** — every input and explicit terminal must be defined earlier. Value ranges are checked by each library, surfaced via `ExecutionResult.failedAt`.

---

## 7. AI and UI interleaving

### 7.1 AI submits the full text

1. A model is best at producing complete runnable code and worst at producing reliable structured patches.
2. Incremental recognition belongs to the engine — a deterministic algorithm — not the model.
3. "Double the size" is, in a full-text view, "keep the line, change the value of `size`".

The AI contract: read the whole current `.fai.js` text, return the whole new text — keep every existing statement unless deletion was requested, change only values or the callee on existing lines, append new statements at the end; never reorder or rename existing variables, never write top-level control flow, `export default` or `return`. Control flow and loops go **inside a function body**, called by a top-level statement — a loop-driven part is a local function plus one call. Conditional expressions may appear in any argument value.

### 7.2 Host-side identity alignment

The engine's increment is content-addressed (§6.3); classifying a statement as added, modified or deleted is the host's job, by aligning identities (`StmtId` / `PartName`) before calling `append` or `update`.

| Comparison | Category |
|---|---|
| Same identity, same callee and args | UNCHANGED |
| Same identity, same callee, different args | PARAM change |
| Same identity, different callee | STRUCT change |
| Present only in the new script | ADD → `append` |
| Present only in the old script | DELETE → invalidate its cache and its downstream |

Alignment ignores line position, so renaming `part0` to `p0` reads as "delete part0, add p0" and breaks every downstream `inputs: ['part0']`. A deleted statement whose output is still referenced is an orphan: reject the submission.

### 7.3 Scenarios

| Scenario | Change in the full text | Engine action |
|---|---|---|
| Double the block size | Change `size` on the existing box line | Recompute that statement and cascade |
| Make the part taller | Append an `extrude` line | `append`: execute only the new statement |
| Turn a drill into an engrave | Change the callee on that line | Replay from that statement |
| A human knurls a face | The UI appends a `knurl` line | `append` |
| Split, then boolean two parts | Append the split, a post and a union | `append`; cross-part references hit the ctx |

---

## 8. End-to-end walkthrough

```js
// 0. UI creates a block
let part0 = cad.box({ size: 20 })
// 1. UI drills (part0 consumed)
let part1 = cad.drill(part0, { diameter: 5, depth: 0, position: cad.faceCenter(part0), direction: 'normal' })
// 2. AI makes it taller
let part2 = cad.extrude(part1, { length: 3 })
// 3. AI doubles the size: set size to 40 on the box line (a PARAM change)
// 4. UI splits (part2 consumed)
const { front: part3, back: part4 } = cad.split(part2, { normal: [0, 0, 1], offset: 0, cutMode: 'plane' })
// 5. AI adds a post and unions (part3, part5 consumed)
let part5 = cad.cylinder({ radius: 5, height: 40 })
let part6 = cad.union(part3, part5)
// 6. UI assembles part4 and keeps it visible
let asm1 = cad.assembly({ name: 'A', members: [part4], constraints: [], keep: [part4] })
asm1.do_assemble()
```

Terminals after step 6: `part4` (retained by the assembly), `part6`, `asm1`; the rest were consumed. Steps 1, 2, 4, 5, 6 execute only the new statement; step 3 recomputes the box line and cascades; the untouched prefix stays in the ctx.

---

## 9. Adjacent channels and non-goals

- **Whole-module TypeScript** is a second execution channel: types are stripped and the source imported as one module, `export` naming its outputs. It builds no IR and never enters the timeline — an escape hatch, not part of the `.fai.js` statement language.
- **Non-goals**: top-level control flow (function bodies may contain it), `Shape[]` batch operations, in-place mutation of a published Shape.
