# Agent Note: sketch contract lands as standing docs; the radian contour face is recorded, not converted

Status: implemented

> **Superseded 2026-10-21** — the "radian contour face is recorded, not converted" decision below was reversed: those slots were not an exception to document but undeclared slots, i.e. holes in the unit system. They now declare `dim: 'angle'` and convert at the op entry. See `.agents/notes/implemented/architecture/2026-10-21-dimensioned-slots-declared.md`.

English | [中文](2026-10-20-sketch-contract-standing-docs.zh.md)

## Problem

A host-driven sketch build surfaced seven faijs documentation gaps, all of them contract facts that cost real debugging time to rediscover: the angle-unit split between the script face and the contour segment face, BREP handle semantics, the canonical ellipse form, the contour extraction rules, where script-face unit constants come from, how to ask which ops run on which engine, and the angle-field registry that drives degree→radian conversion. Two of the seven are not editorial: the contour segment face (`cad.profile` / `cad.sketchOnPlane` / `cad.sketchOnFace` / `cad.sketchOnSurface`, `contours[].segments[].startAngle` / `endAngle`) takes **raw radians** while every other script-face angle is degrees, and nothing in the types or the dimension pass makes passing degrees there fail — it silently produces wrong geometry.

## Decision

`docs/sketch-contract.md` (English / Chinese / i18n record) is the single home for the sketch subsystem contract: the two script-face entries, the API × angle-unit table, the angle-field registry, the canonical ellipse, and the contour extraction rules. `docs/api-contract.md` carries the three engine-boundary facts: BREP handle semantics (§8.6), the script-face unit constants and the dimension pass (§15), and the platform-binding query surface (§7.12). `docs/library-dev-guide.md` links to those two instead of restating them.

The radian contour segment face is **documented as it is and left alone**. Its unit split is a fact about a shipped API surface, not a defect to fix opportunistically; converting it means touching faijs tests, the FCStd translator corpus and the host emitter in one change, which belongs to the unit-system unification work. The doc states the split, marks the two radian rows as outside the unit system, and names the consequence — no error, wrong geometry.

## Alternatives considered

- **Put the sketch facts in `docs/api-contract.md`.** Rejected: api-contract is the engine and runtime contract, and it would absorb a whole subsystem of detail that has nothing to do with dispatch, naming or execution. A dedicated standing doc keeps one home per fact and lets api-contract link.
- **Put them in `docs/ops-api-inventory.md`.** Rejected: that file is generated from op JSDoc and its generator is deprecated, so prose added by hand there would drift from the generator's next run with nothing to catch it.
- **Convert the contour segment face to degrees now.** Rejected: it is a breaking change across three codebases at once, and the decision to unify angle units has to be taken for the whole unit system, not one field.
- **Introduce `Degrees` / `Radians` branded numbers so a wrong unit fails at compile time.** Deferred, not rejected: it is the right end state and is recorded as the ideal in the doc, but it touches every angle-bearing signature at once and is a separate change.
- **Hand-maintain a "which cad ops run on brepkit" table.** Rejected: `engines` is already the only narrowing axis and a second list would be a duplicate fact that silently rots. The documented answer is the existing query surface — `describeLib('cad')` / `libsUnder(engineId)` read the same declaration the dispatcher enforces.

## Consequences

- The angle-unit split, the handle-`0` rule, the canonical ellipse and the closed-loop-only extraction rule now have one authoritative home each, and every other place links to it.
- Nothing in the runtime changed: no op signature, no conversion, no error was added. The gaps were documentation, not behaviour.
- A host emitter now has a named place to check before writing sketch text — which is the whole point, since the cost of these gaps was paid in debugging time on the host side.
