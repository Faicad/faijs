# Agent Note: Motion joints and kinematic queries (P3)

Status: implemented

English | [中文](2026-09-07-assembly-joints-kinematics.zh.md)

## Problem

The assembly layer shipped in P2 is static: constraints position members once (`solveAssembly`), and there is no way to express a mechanism — revolute/prismatic joints with drive values — nor to query its forward kinematics, trajectory, inverse solution, or degree of freedom. Hosts (3d_editor) need per-member poses after `asm.solve()` to animate and export assemblies, and the module and direct executors must agree on the same kinematics channel (R11② single-source discipline). The vendored brepjs source already contains a zero-modification kinematic kernel (`jointFns.js` forward kinematics, `ikFns.js` trajectory/IK, `mechanismDOF`) that faijs did not surface.

## Decision

A serializable joint surface is added under `packages/core/src/api/assembly/` alongside the constraint layer:

- **JointSpec** (`joints.ts`): a JSON-serializable union `{ type, parent, child, … }` — `revolute` / `prismatic` carry `axis: { origin, direction }`, `min` / `max` / `value` in degrees, and optional `offset: { position, rotation }` where `rotation` is the faijs `[x,y,z,w]` quaternion (brepjs internal `[w,x,y,z]` conversion happens only in `pose.ts`). Multi-DOF types (`cylindrical`, `planar`, `spherical`) are **rejected by `buildJoint` with an explicit error** at assembly construction — never a silent downgrade (D-P3-4: per-DOF ranges pending).
- **Validation** (fail-fast in `buildKinematicTree`): empty member names, `parent`/`child` outside `members`, and a child driven by two joints all throw with the member list / duplicate-child context (R7 discipline); a `drive` key that is not a joint child throws (typo, not silent ignore).
- **Solve** (`solveKinematics`): `buildKinematicTree` → vendored `forwardKinematics` → the synthetic `'__asm_root'` key is filtered out; all members get a final pose (`KinematicsPose`), transforms are emitted only for non-identity members (same semantics as the constraint solver).
- **Merge semantics** (D-P3-1, in `solveAssemblyAndKinematics`): the constraint solve runs first, then `solveKinematics`; per-member joint poses **override** the constraint solution for the same member names, and every override is recorded in a warning. Kinematic results do not feed the `converged` / `dof` statistics.
- **Consumption channel**: there is **no `asm.kinematics()` method** — R0 (void, no value) statement shape is preserved. With joints present, the engine writes per-member poses to `ExecutionResult.kinematics: Map<PartName, { position, rotation }>` through a pending channel (`setPendingAssemblyKinematics` / `takePendingAssemblyKinematics`); runtime state stays free of api-layer types (structurally matching `AssemblyKinematicsPose`). **Both executors write it** (module `ExecBookkeeping.kinematics`, direct `kinematicsOut`), locked by J12.
- **Query surface** (`cad.*`, pure, no receiver): `jointTrajectory` (trajectory samples, faijs-order rotations), `inverseKinematics` (target rotation converted `[x,y,z,w]` → brepjs), `mechanismDOF`. They went through the six-step three-source sync (op → namespace keys → `gen-symbol-table.ts` → `api/index.ts` exports → `op-set-consistency.test.ts` green → `gen-ops-api-inventory`).
- **Arg-spec sync**: the five skipped vendored functions (`addJoint`, `forwardKinematics`, `mechanismDOF`, `inverseKinematics`, `jointTrajectory`) had their `reason` updated to the actual destination — `forwardKinematics` in particular now points at `ExecutionResult.kinematics` + `cad.mechanismDOF` / library `solveKinematics` instead of the removed `asm.kinematics()`.
- `assembly({ joints, drive })` accepts the new parameters; codegen roundtrip tests cover joints+drive and multi-DOF text (the text layer does not reject).

## Alternatives considered

- **Add an `asm.kinematics()` method returning a value.** Rejected: `.fai.js` is a declarative replay model; a value-returning member method breaks the R0 statement shape (same reason `asm1.drive()` was dropped). Poses flow through `ExecutionResult` instead.
- **Let the engine run a second kinematic solve.** Rejected: the library merges constraints + kinematics once (`solveAssemblyAndKinematics`) and registers both channels; a second engine-side solve would double-solve and double-register.
- **Ship multi-DOF joints in P3.** Rejected: per-DOF ranges are not yet specified; silent partial support would violate the no-fallback rule — explicit construct-time errors are the contract.
- **Implicitly allow any `drive` key.** Rejected: an unknown key is a typo; ignoring it silently hides the error, so it throws with the joint-children list.
- **Write kinematics from the module executor only.** Rejected: the direct executor is a first-class execution path (R11②); J12 asserts both produce identical kinematics.

## Consequences

- `docs/api-contract.md` §12 gains the kinematic joints contract (JointSpec, drive-override merge semantics, `ExecutionResult.kinematics` channel from both executors, `cad.*` query surface); `docs/ops-api-inventory.md` §6.1 regenerates with the updated skip reasons.
- `ExecutionResult` grows an optional `kinematics` field; hosts read poses from it (read-only consumption in P3 — DOF display via `mechanismDOF`, drive sliders rewrite statement params and replay).
- The vendored `jointFns.js` / `ikFns.js` sources remain untouched (zero-diff on `packages/core/src/vendored`).

## Verification

- `joints.test.ts` (J1/J1b/J2/J3/J4): single-DOF `revolute`/`prismatic` factory mapping, axis passthrough, value clamp, multi-DOF explicit throw, offset quaternion round-trip, duplicate-child and membership/empty-name errors.
- `kinematics.test.ts` (J5–J8): single revolute hand-computed pose, two-stage chain composition, drive clamp, joints-over-constraints override with exactly one warning.
- `joints-ik.test.ts` (J9–J11): planar two-link IK converges and FK(solution) ≈ target, trajectory steps/timing, `mechanismDOF`, browser facade export.
- `packages/tests/faijs/assembly/assembly-kinematics.test.ts` (J12): `.fai.js` replay kinematics equals the library direct call; module and direct executors agree; no-joints assembly leaves `kinematics` undefined.
- `codegen-assembly-constraints.test.ts` gains joints+drive and multi-DOF roundtrips; `op-set-consistency.test.ts` green after symbol-table regeneration (61 entries).
- Full suites: core and `packages/tests` assembly-related suites green (87 core + 8 integration); typecheck/lint/CI run as part of the P3 acceptance.