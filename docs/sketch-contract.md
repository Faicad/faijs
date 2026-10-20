# faijs Sketch Contract

English | [中文](sketch-contract.zh.md)

> Position: this document records the contract of the sketch subsystem — the two script-face entries, the canonical geometry they exchange, the contour extraction rules, and the angle-unit convention at each face.
>
> Related documents:
> - `docs/api-contract.md` — engine and runtime contract, script-face unit constants, the dimension pass, and the `paramDims` declaration discipline
> - `docs/ops-api-inventory.md` — API manual for writing `.fai.js` code (per-op parameters, generated)

---

## 1. Two script-face entries

| Entry | Input | Processing | Product |
|---|---|---|---|
| `cad.sketch` | `shapes` (semantic primitives) **or** `geoms` (canonical geometry), plus `constraints` | planegcs solve → `extractContours` → placement | planar face; outer wire with `as:'wire'` |
| `cad.profile` / `cad.sketchOnPlane` / `cad.sketchOnFace` / `cad.sketchOnSurface` | `contours` — segment loops (`ProfileLoop[]`) or already-drawn contours (`Blueprint` / `Blueprint[]`) | no solving; the coordinates are used as given | planar face on the target plane / face / surface; outer wire with `as:'wire'` |

`cad.sketch` is BREP-only — the mesh path reports `E_MESH_UNSUPPORTED`. `cad.profile` and `cad.sketchOnPlane` are BREP-only with no engine gate; `cad.sketchOnFace` is engine-neutral (it also runs on the brepkit mesh chain); `cad.sketchOnSurface` declares `engines: ['occt']`.

The two entries meet at one place: a solved `cad.sketch` hands its contours to the same placement core (`buildSketchOnPlaneWith`) that the placement entries call directly.

---

## 2. Angle units

### 2.1 The rule

**No dimensioned slot accepts a bare number.** Every angle-bearing parameter is declared `dim: 'angle'`, so a script must write a quantity — `90 * DEGREE` or `1.5708 * RADIAN`. A bare `90` is rejected (`E_DIM_BARE_NUMBER`).

The unit constants are plain numbers and the angle base unit is the degree — `DEGREE = 1`, `RADIAN = 180/π` — so those two forms denote the same angle and either is accepted.

**Which unit the internals use is not part of the contract.** The sketch library, `geometry2d/` and the kernels all work in radians; each op converts once at its entry and nothing downstream sees degrees. Callers only ever write a quantity, so a future change to the internal unit is invisible to them.

### 2.2 Every angle slot

| API | Angle fields | Declared | Conversion |
|---|---|---|---|
| `cad.sketch` `shapes[]` | `angle` (rect / roundedRect / ellipse / polygon / slot / trapezoid), `a1` `a2` (trapezoid), `a0` `a1` (arc) | `angle` | `anglesToRadians` |
| `cad.sketch` `geoms[]` | `a0` `a1` (arc); `angle` `a0` `a1` (ellipse) | `angle` | `anglesToRadians` |
| `cad.sketch` `constraints[]` | `value` of kind `angle` / `arcAngle` | `angle` | `anglesToRadians` |
| `cad.circleArc` / `cad.ellipseArc` | `startAngle`, `endAngle` | `angle` | — (already degrees) |
| `cad.rotate_euler` | `angles` | `angle` | — |
| `cad.wedge` | `angle` | `angle` | — |
| `cad.profile` / `cad.sketchOnPlane` / `cad.sketchOnFace` / `cad.sketchOnSurface` / `cad.punchHole` | `contours[].segments[]` → `startAngle`, `endAngle` | `angle` | `contourAnglesToRadians` |
| `cad.boolean` | `options.simplifyAngularTolerance` | `angle` | op entry (`fromBase`) |

There is no "raw radians" row any more. Both of the slots that used to be undeclared — contour arc angles and `simplifyAngularTolerance` — now declare `angle` and convert at the boundary, so a bare number there is an error instead of silently wrong geometry.

### 2.3 Where the conversion happens

Each op converts once, at entry, through the unit system (`fromBase(value, 'radian', 'angle')`) rather than a local constant:

- `cad.sketch` → `anglesToRadians` (`packages/core/src/sketch/op.ts`), one pass over `shapes` / `geoms` / `constraints`.
- The contour entries → `contourAnglesToRadians` (`packages/core/src/api/profile.ts`), one pass over `contours[].segments[]`.

`profileSegToCurve` (`packages/core/src/geometry2d/adapt.ts`) and everything below it therefore see radians only — which is why the conversion must stay **at the op entry**: kernel-produced contours (`extractContours`, radians) reach the same helpers through non-script callers, and converting inside the helper would double-convert them.

### 2.4 Where the check runs

`check()` (dry-run) runs the dimension pass and rejects bare numbers. **The `execute()` path currently does not** — see `docs/api-contract.md` §15.3.

---

## 3. Angle-field registry

A degrees value reaches the radian internals only when its field is registered. `SHAPE_ANGLE_KEYS`, `GEOM_ANGLE_KEYS` and `ANGLE_VALUE_CONSTRAINTS` (`packages/core/src/sketch/op.ts`) are the registry `anglesToRadians` walks, keyed by shape / geom / constraint kind.

| Semantic shape kind (`shapes[]`) | Angle fields |
|---|---|
| `rect`, `roundedRect`, `ellipse`, `polygon`, `slot` | `angle` |
| `trapezoid` | `angle`, `a1`, `a2` |
| `arc` | `a0`, `a1` |

| Canonical geom kind (`geoms[]`) | Angle fields |
|---|---|
| `arc` | `a0`, `a1` |
| `ellipse` | `angle`, `a0`, `a1` |

| Constraint kind (`constraints[]`) | Angle field |
|---|---|
| `angle`, `arcAngle` | `value` |

**A kind that gains an angle field must register it.** An unregistered field is skipped by `anglesToRadians`, so a degrees value is consumed as radians — no error, wrong geometry. Nothing checks the registry against the shape declarations, so adding an angle field to a shape kind means adding it here in the same change.

---

## 4. Canonical ellipse

The canonical ellipse requires `major ≥ minor`. `toFreeCadGeoms` (`packages/core/src/sketch/project.ts`) normalizes the input pair: when `rx < ry` the radii swap and the axis direction turns by `+π/2`, giving `major = max(rx, ry)`, `minor = min(rx, ry)` and `rot = angle + π/2` (otherwise `rot = angle`). The focal distance is `c = √(major² − minor²)` and the two foci sit at `(cx ∓ c·cos rot, cy ∓ c·sin rot)` — focus 1 on the **minus** end.

**The major axis is undirected, so `angleXU` only carries meaning modulo π — and the two sides of the solver boundary differ by exactly that π:**

| Side | `angleXU` |
|---|---|
| Push side — `toFreeCadGeoms` writes it | `rot` |
| Read-back side — the planegcs backend recomputes it from the solved foci as `atan2(f1 − centre)` | `rot ± π` |

Both denote the same ellipse. `rx=10, ry=20, angle=30°` (degrees on the script face) normalizes to `major=20, minor=10, rot=120°` and reads back as `angleXU = −60°`; `135°` and `−45°` are likewise one axis.

Two consequences for callers:

1. **Never compare `angleXU` against the input `angle` numerically** — compare modulo π.
2. `fromFreeCadGeoms` maps back as `rx = majorRadius`, `ry = minorRadius`, `angle = angleXU`, so the `angle` a round trip returns is the read-back value, not the value that went in.

---

## 5. Contour extraction

### 5.1 `cad.sketch` — closed loops only

`extractContours` (`packages/core/src/sketch/contour.ts`) chains solved geometry into loops and **keeps closed chains and self-closed circles only; open chains are dropped**. Two endpoints join at `JOIN_TOL = 1e-7`, and construction geometry is excluded up front. When nothing closes, `cad.sketch` fails with `E_SKETCHC_NO_CONTOUR: solved sketch produced no closed loop` — so `as:'wire'` cannot produce an open spine from a lone arc.

### 5.2 The placement entries — contours as given

The placement entries neither solve nor re-chain: `toContourBlueprints` turns each `ProfileLoop` (or drawn `Blueprint`) into one contour and `organiseBlueprints` classifies them (nested = hole, disjoint = separate island) without testing whether a chain closes. Under `as:'face'` an open chain makes no face. Under `as:'wire'`:

- `cad.sketchOnPlane` / `cad.sketchOnFace` / `cad.sketchOnSurface` take the **first** entry — a single chain, open or closed, comes back as that chain, so an open chain becomes an open wire (the sweep-spine path); with multiple disjoint chains only the first is returned, so a multi-part open path has to be joined into one chain first.
- `cad.profile` takes the outer ring of the **largest-area** island and drops hole rings.

The same open chain is therefore rejected by `cad.sketch` and accepted by `cad.sketchOnPlane({ as:'wire' })`: the entries differ in whether contours are derived or given.
