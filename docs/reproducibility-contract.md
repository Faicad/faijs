# faijs Reproducibility Contract

English | [中文](reproducibility-contract.zh.md)

> Position: This document is the **determinism contract** of the `.fai.js` exchange format — what guarantees the same source produces the same geometry across time, geometry kernels, and JavaScript engines. It defines the precision bound for "same geometry", the boundary between geometry and non-geometry data, the set of non-deterministic sources, the static analysis that decides whether a non-deterministic value reaches geometry, and the responsibilities of the engine and host.
>
> Related: [`docs/api-contract.md`](api-contract.md) owns the interface contract (identity, statement model, execution, geometry dispatch); [`docs/syntax-design.md`](syntax-design.md) owns the syntax and incremental-execution contract. This document does not track development plans or defects and does not reference `docs/plans/` documents.

---

## 1. Goal and scope

### 1.1 Reproducibility

`.fai.js` is an executable exchange format that preserves the author's modeling intent and parametrization. Its reproducibility guarantee applies to **geometry data only**:

> Re-executing the same source in any conforming environment — any geometry kernel, any ECMAScript implementation — yields geometry equal within the precision bound of §1.3.

Non-geometry output (logging, timing, debugging) is out of scope.

### 1.2 Geometry data boundary (sinks)

Only three categories of value constitute geometry data. A non-deterministic value flowing into one of them is a contract violation.

| Sink | What it decides | Example |
|---|---|---|
| Geometry parameters | numeric arguments that determine shape / transform / topology | `cad.box(w,h,d)`, `cad.sphere({radius})`, `cad.translate(part,{offset})`, `nRad`, rotation angles |
| Geometry structure | control flow that decides which op runs and how they combine (implicit flow) | a branch condition selecting between two `cad.union(...)` results |
| Identity | names / ids written into exported files | part names, constraint names, document object `name/id`, content-hash inputs |

`console.log`, timing, and exception stack traces are not sinks.

### 1.3 Precision ("same geometry")

Re-execution across kernels/engines leaves last-ulp float differences, so "same" means **aligned to 5 decimal places (1e-5)**, in three tolerance classes:

| Class | Tolerance | Applies to |
|---|---|---|
| Length | absolute 1e-5 mm | vertex coordinates, distances, offsets, bbox edges |
| Normalized | absolute 1e-5 | normals, unit quaternion components, unit directions |
| Volume / area | relative 1e-5 | `volume`, `surfaceArea` |
| Angle | absolute 1e-5 deg | rotation angles, included angles |

This bound doubles as the comparison threshold of §5 exit verification.

## 2. Non-deterministic sources

Call results of the following APIs are treated as non-deterministic (tainted). Whether a given use is a violation is decided by §3; a source alone is not forbidden.

| Source | Why non-deterministic |
|---|---|
| `Math.random` | runtime randomness |
| `Date.now()` / `new Date()` (no arg or system-clock dependent) | current time |
| `new Date(...)` depending on timezone/localization | environment timezone |
| `crypto.getRandomValues` / `crypto.*` | runtime randomness |
| `performance.now` | monotonic clock |

## 3. Static taint analysis

Whether a `Date` call ultimately feeds geometry generation is decided by static data-flow taint analysis.

### 3.1 Sources, sinks, rule

- **Source**: the API calls in §2.
- **Sink**: the three sink categories of §1.2.
- **Verdict**: a propagation path from a source to a sink is a violation (`E_NONDETERMINISTIC_GEOMETRY`).

### 3.2 Propagation

A value is tainted iff any input is tainted; loop-carried variables take the union to a fixed point.

1. Arithmetic / comparison / logical / bitwise: any tainted operand → tainted result.
2. Unary (`-`, `+`, `!`, `~`, increment): tainted operand → tainted result.
3. Array / object literal: any tainted element or property → tainted container.
4. Member access: tainted object → tainted member; tainted computed key → tainted access.
5. Assignment / destructuring: tainted right side → tainted left side.
6. Function call: any tainted argument → tainted return (conservative; known pure built-ins relax per whitelist).
7. Implicit control flow: a tainted `if` / `switch` / `for` / `while` / ternary condition taints **every** assignment target inside the structure.
8. Function params / returns: propagate across bodies; captured closures carry taint.
9. Library code: third-party `@faicad/*` sources pass the same scanner, fixed strict.

### 3.3 Verdicts

- A source value reaching only non-geometry positions (logging, timing, debug) is **allowed**.
- A source value reaching any sink (directly or via §3.2, implicit flow included) is **rejected**.

Allowed:

```js
console.log(Date.now())               // taint reaches console (non-sink) → allowed
const t = Date.now(); console.log(t)  // allowed
```

Rejected:

```js
const w = Date.now()                  // tainted
let part0 = cad.box(w, 10, 10)        // geometry-parameter sink → rejected
```

```js
let r = 10
if (Date.now() > 0) r = 20            // implicit flow: r tainted
let part0 = cad.sphere({ radius: r }) // rejected
```

```js
const t = Math.random()
cad.translate(part0, { offset: [t, 0, 0] }) // rejected
```

### 3.4 Honest boundary

Static analysis **finds** violations; it does not **prove** determinism. It covers explicit and implicit flow across functions and library boundaries, but cannot verify the determinism of engine internals or host-injected resources (fonts / assets / kernels). True equivalence is the job of §5 exit verification.

## 4. Engine and host responsibilities

Beyond the user-code gate, the following non-determinism lives inside the engine or host and is fixed by implementation, not by user-code taint analysis.

- The capability whitelist (`S4_SAFE_GLOBALS`) exposes `Math` / `Date` as whole objects; it must expose only the deterministic `Math` constant and function surface, and no `Date`.
- Shape identities defaulted from random UUIDs must become deterministic (content hash or deterministic ordinal).
- Timestamps written into operation history / timelines must be removed or made deterministic.
- Fonts, assets, and textures must be packaged content-addressed with the source; SDF / mesh / BREP kernel versions must be declared and pinned in the file header.
- The dual backends (AST interpreter vs `new Function`) must align transcendental functions, aliases, `instanceof`, and `for-in` order item by item.

## 5. Exit verification (cross-kernel parity)

1. Each op keeps reference geometry in both BREP and mesh variants.
2. Execute the same `.fai.js` across kernels / engines and compare geometry properties (vertices, normals, volume, area, centroid, bbox) within §1.3.
3. Parity tests (with `initOcctWasm()` in `beforeAll`) follow this role; the comparison threshold aligns to §1.3.
4. Any randomness source must take an explicitly fixed seed; the deterministic PRNG is the reference pattern.