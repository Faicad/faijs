# Third-Party Library Development Guide

English | [中文](library-dev-guide.zh.md)

> This guide covers how to write and port third-party libraries for the faijs ecosystem. A library author writes brepjs-style code (positional parameters, `Result` returns, `Sketcher`/`Blueprint`/`draw` DSL) and registers it through `runtime.registerLib(binding, ns, { compat: true })`.

> Related documents: `docs/api-contract.md` (§ 7.6–7.8 for the three contract surfaces, `compatOp`, and the Result error system), `docs/ops-api-inventory.md` (the `cad.*` script-face API manual).

---

## 1. Three API surfaces at a glance

| Surface | Consumer | Form | Location |
|---|---|---|---|
| ① TS compat face | Library authors (TS code) | brepjs-native: positional params + `Result`; same names/signatures; DSL + combinators | `@faicad/faijs` main export (`packages/core/src/api/compat/`) |
| ② cad script face | `.fai.js` (UI/AI generated) | `cad.*` object params; statement-boundary `Result` unwrap | `cad` namespace (injected via `createRuntime`) |
| ③ Library edge | `registerLib`-registered exports | Library writes pure brepjs code; boundary handles borrow/adopt | `runtime.registerLib(binding, ns, { compat: true })` |

A library author interacts with ① (to import building blocks) and ③ (to register the library for `.fai.js` consumption).

---

## 2. Boundary contract — three rules for library authors

These three rules are the **only** constraints a library author must follow. brepjs ecosystem libraries naturally satisfy them.

### Rule 1: Input handles must not be retained across calls

Inward borrowed views (via `createBorrowedHandle`) are valid **only within the current call**. Derive new handles to return; do not store input handles for later use.

### Rule 2: Returned handle ownership has transferred

When a function returns a solid handle and faijs adopts it (via `adoptEntity`), the library must not call `delete()` on it afterward. The brepjs convention is "return = transfer" — upstream libraries naturally satisfy this.

### Rule 3: Only top-level handles and `geometryFields`-declared fields are adopted

In a return structure, only the top-level handle and fields listed in `geometryFields` are adopted (crossing the boundary into faijs `Shape`). All other embedded handles remain library-private state; cross-call consistency is the library's responsibility.

---

## 3. `geometryFields` — multi-output declaration

When a function returns a structure containing multiple geometry handles (not just a single top-level solid), declare `geometryFields` on the function so the compat boundary knows which fields to adopt:

```ts ignore-check
import { ok, type Result } from '@faicad/faijs'
import type { ValidSolid } from '@faicad/faijs'

interface PlanetaryOutput {
  sun: ValidSolid
  planets: ValidSolid[]
  ring: ValidSolid
}

export function planetary(params: PlanetaryParams): Result<PlanetaryOutput> {
  // ... build sun, planets, ring ...
  return ok({ sun, planets, ring })
}
// Declare which fields carry geometry handles for boundary adoption:
planetary.geometryFields = ['sun', 'planets', 'ring']
```

Without `geometryFields`, the boundary adopts only the top-level return value if it is a handle; structures pass through as plain data (embedded handles stay library-private).

---

## 4. `solidOf` — explicit geometry terminal

For data-centric libraries (like sheetmetal, where `part` is a plain object with an embedded `solid`), provide a `solidOf` function as the explicit geometry terminal — the point where library-private handles cross the boundary into faijs `Shape`:

```ts ignore-check
export function solidOf(part: SheetMetalPart): Result<ValidSolid> {
  return ok(part.solid!)
}
```

This keeps intermediate data flow zero-adoption (no tessellation, no identity-slot allocation) until the explicit terminal, matching display needs naturally.

---

## 5. Minimal porting checklist

### From brepjs to faijs — the ideal case

1. Change all `from 'brepjs'` import specifiers to `from '@faicad/faijs'`.
2. Remove any `registerKernel` calls (faijs manages the kernel — D10 single-instance).
3. Remove any `pinned` arrays or finalizer workarounds (faijs handles adoption lifecycle — R1 fix in `adoptEntity`).
4. Register the library: `runtime.registerLib('mylib', myNamespace, { compat: true })`.

### mech-lib porting (7 items, from the design's §8.3)

| # | Change | Rationale |
|---|---|---|
| 1 | `brepjs` → `@faicad/faijs` in `package.json` + all imports | Package name migration |
| 2 | Remove `registerKernel` call | D10: kernel managed by host |
| 3 | Remove `pinned` array | R1: adoption lifecycle handled by `adoptEntity` |
| 4 | Rename `brepjs-gear.ts` → `gear.ts` | No brepjs names in source |
| 5 | `Result` consumption points: **zero changes** | D1: Result native — library's `isErr`/`map`/`andThen` all work as-is |

### sheetmetal porting

| # | Change | Rationale |
|---|---|---|
| 1 | Delete `compat.ts` (22 deep-path imports) | Replaced by `@faicad/faijs` main export |
| 2 | `brepjs` → `@faicad/faijs` in all 27 file imports | Package name migration |
| 3 | Bend table registration: explicit (no global side effects) | Deterministic registration |
| 4 | Add `solidOf` terminal function | §4: explicit geometry terminal |
| 5 | Add `geometryFields` where needed | §3: multi-output adoption |
| 6 | Remove `pinned` / finalizer workarounds | R1: handled by `adoptEntity` |

---

## 6. Testing the library in `.fai.js`

After registration, the library is callable from `.fai.js`:

```js
import * as gear from 'gear-lib'
let g1 = gear.external({ teeth: 20, moduleSize: 2, thickness: 10 })
let b0 = cad.box({ size: [30, 30, 5] })
let u1 = cad.union(g1, b0)
```

The `compat: true` flag in `registerLib` triggers `admitCompatLib`, which:
1. Runs `assertLibConforms` (contract validation, before wrapping — R8).
2. Wraps each bare function with `compatOp` (borrow → dispatch → call → unwrap → adopt).
3. Registers the library identity for incremental key computation (B2 fix).

Functions already carrying `DUAL_OP_META` (from `defineOp`) pass through unwrapped — the library can mix `defineOp` declarations and plain brepjs functions freely.

---

## 7. Script-face call matrix — what a `.fai.js` statement can actually call

Top-level call arguments are full expressions (`lang/parser.ts`) — **`.fai.js` is a true JS subset at the call site**:

- **Positional arguments of any form, in any mix**: literals (`addHole(p, 'root', 15, 15, 4)`), arrays, declared variables, member access (`hem(p0.solid, spec)`), nested namespace queries, runtime expressions.
- **Multiple object arguments are kept as-is**: `tabAndSlot(p, tabSpec, slotSpec)` works — no overwrite, no merge. The *last* plain object is the options slot (carrying `keep` / `keepHidden`); earlier objects are positional data.

Consequences for authors:

1. **The object-form entry is a recommended style, not a requirement.** Spec-object parameters remain idiomatic for structured configs (`defineOp` D11 dual-form declarations still work), but string-id / scalar / array first parameters are callable from the script face too.
2. **Record *fields* are readable in the script** (`hem(u1.solid, …)`, `allowance(u1.thickness)` — member access is a runtime-evaluated expression). Whole-record passing still works.
3. **Library `err` results are statement failures, not crashes** — `OpError` → `ExecutionResult.failedAt`; earlier statements keep their outputs. Unexpected exceptions (bugs) still propagate out of `execute()`.

Verified against `@faicad/sheetmetal` (whole-package registration, `{ compat: true }`) — every signature shape is callable now:

| Callable | Example |
|---|---|
| spec-object functions | `author(spec)`, `hem(p, spec)` |
| string-id / scalar / array functions | `addHole(p, 'root', 15, 15, 4)`, `allowance(p, 0.44)` |
| member access on variables | `hem(p0.solid, { kFactor: 0.44 })` |
| multiple object arguments | `tabAndSlot(p, tabSpec, slotSpec)` |
| geometry terminal | `unfoldSolid(s1)` — a faijs `Shape` borrows a zero-copy arena view |

`solidOf` remains as an explicit terminal for the TS compat face and library-side use; on the script face it is no longer *required* — member access (`p.solid`) reaches the field directly.
