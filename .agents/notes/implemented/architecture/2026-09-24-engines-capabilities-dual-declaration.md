# Agent Note: engines and capabilities are independent declaration axes

Status: implemented

English | [中文](2026-09-24-engines-capabilities-dual-declaration.zh.md)

## Problem

`defineOp` carries two declaration fields. `engines` states platform identity — the engines an
implementation can run on. `capabilities` states the kernel capabilities that implementation
needs. An assembly-time assertion in `assertLibConforms` rejected any op declaring both, on the
stated ground that a platform op's capabilities are guaranteed by the platform itself and that
the capability name space holds only "L1-neutral names".

That ground is factually wrong. `BrepCapabilityName` includes `BrepMethodKind`, a union of
per-kernel method names (`isNull`, `dispose`, `chamfer`, `shell`, `loft`, …) — a kernel name
space, not an L1-neutral one. Nothing about declaring a kernel method name from a platform op
is out of bounds.

The two fields answer orthogonal questions: `engines` narrows *which engines* the
implementation runs on; `capabilities` states *which kernel methods* it needs. A platform op
has both answers and they do not conflict.

The exclusion cost real information. The `fuse` compat op depends on `kernel.isNull` and
`kernel.dispose`. Forced to pick one axis, its declaration kept `engines: ['occt']` and dropped
the dependency list, leaving a comment that argued the two fields are complementary while the
same object literal carried only one of them. The capability-coverage guard had to be written
as a sum of two mutually exclusive sets, because an entry could never be counted on both axes.

It also removed an available static guard. Ops that depend on a capability through the neutral
axis alone can be admitted by an engine whose capability declaration over-claims a family
(e.g. a family-level boolean covering a method that engine does not really implement), pass the
static gate, and then fail — or worse, silently return wrong geometry — inside the kernel. That
is precisely the shape the project's static-dispatch rule forbids.

## Decision

The two fields are independent and may be declared together.

- `engines` is an engine whitelist: the op runs only on the listed engines. It is evaluated
  first, before any capability or mode consideration.
- `capabilities` is the implementation's kernel dependency list. It is intersected against the
  matched engine's declaration afterwards.
- Declaring both means "only on these engines, and requiring these capabilities". A declared
  capability that the matched engine lacks still fails statically, before the implementation
  runs — the combination never silently passes.
- `assertLibConforms` no longer rejects the combination. Declaration shape is still validated:
  `capabilities` must be a string array, `engines` must be a non-empty array of known engine
  ids.

## Alternatives considered

- **Keep the exclusion.** Rejected: its stated justification does not hold, and it forces
  authors to discard a truthful dependency list — the opposite of the honest-declaration
  principle the capability tables are built on.
- **Let `engines` win outright — treat `capabilities` as documentary once `engines` is
  present.** Rejected: it drops a static guard. An op declaring a capability its target engine
  lacks would be admitted by the gate and fail inside the kernel, which is the runtime-failure
  shape the static-dispatch rule exists to prevent. Intersecting keeps every declared
  requirement enforceable while costing nothing when the declaration is truthful.
- **Grow the per-kernel method tables so the neutral axis could express the same intent.**
  Not chosen: it is a much larger change (the method union plus both engine declarations) and
  it answers a different question. A declaration axis should not be bypassed by enlarging a
  vocabulary; making the two axes composable fixes the actual defect.

## Consequences

- A platform op can state its identity and its dependencies at once. Ops whose implementation
  genuinely needs named kernel methods no longer have to hide one of the two facts.
- Gate order is observable and pinned by test: on a non-listed engine the engine gate fires
  (the message names the engine and not the capability); on the listed engine the capability
  gate fires (the message names the capability). The implementation body is provably never
  reached in either case — the probe's implementation throws a sentinel that must not appear in
  the failure message.
- The assembly-validation test for the combination includes a negative control: the same
  library without a contract version still throws, proving the op is actually reached by the
  validator rather than skipped.
- The capability-coverage assertion now counts the union of the two axes rather than the sum of
  disjoint sets, so an entry declaring both is counted exactly once.
- The `fuse` dependency list that the exclusion forced out can be restored from the capability
  map; this change deliberately does not restore it, because the per-name list must come from
  the capability map rather than from recollection.
