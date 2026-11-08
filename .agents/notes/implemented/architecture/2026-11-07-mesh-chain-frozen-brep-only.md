# Agent Note: The mesh execution chain is frozen; BREP is the only supported chain

Status: implemented

English | [中文](2026-11-07-mesh-chain-frozen-brep-only.zh.md)

## Problem

The engine ships two execution chains behind one dispatch surface: a manifold-3d mesh chain and an OCCT/brepkit BREP chain. Every dual-op carried both implementations, `auto` mode statically degrades to mesh when the BREP chain breaks, and the standing instructions required every new op to support mesh as the default path. Maintaining two implementations doubled the fix and test surface of every capability, and defects kept accumulating on the mesh side (hardcoded screw pitch, wrong head-height compensation) with no consumer demand justifying the upkeep.

User directive, 2026-11-07: 「最后我要强调一下，mesh链路给我忽略，未来不再维护，只支持brep。文档里写清楚。」

## Decision

**BREP is the only supported and maintained execution chain. The mesh execution chain is frozen.**

- New ops, new capabilities, defect fixes, and new tests land on the BREP implementation only.
- The mesh implementation stays in the tree as a frozen legacy surface: no new capabilities, no defect fixes (known defects are registered where found, not repaired), no new tests. Existing mesh test files remain as a frozen baseline whose only requirement is staying green.
- Keys and parameters added from now on resolve in the shared parameter layer, but their supported and tested target is the BREP chain alone; mesh behavior is undefined, unpromised, and never silently faked.
- The chain-switch mechanism (auto-mode static degradation to mesh) still exists at runtime; a switched-to-mesh segment runs frozen code. New development targets BREP only.
- Mesh as a data representation is a separate fact and is unaffected: `Shape` remains the triangle-mesh payload, SDF products remain mesh-represented, and display tessellation still comes from the engine's tessellation of the BREP model.
- The root instructions (`AGENTS.md`) state the BREP-only support surface; they no longer require mesh support for new ops.

## Alternatives considered

**Keep maintaining both chains.** Rejected by the user directive: nothing on the mesh side justifies continued upkeep, and dual maintenance halves the delivery speed of every capability.

**Delete the mesh implementation outright.** Rejected: existing scripts, `mode:'mesh'` hosts, and SDF products still execute on it; deletion is a breaking sweep that serves no current need. Freezing preserves runtime behavior at zero maintenance cost.

**Relabel mesh as a preview path.** Rejected: mesh is formal data (SDF products), not a preview, per the engine's positioning; relabeling would misrepresent what the chain produces.

## Consequences

- Defects registered on the mesh side (custom-pitch hardcode, head-height compensation) stay open by design: recorded, not fixed.
- Existing mesh test files keep running in CI as a frozen baseline: they must stay green, but no new mesh coverage is written.
- `docs/api-contract.md` keeps describing the dual-chain runtime (modes, `auto` degradation) as current behavior; the freeze is a maintenance stance layered on top, recorded here and in the root instructions.
- Downstream consumers must run the BREP chain for any capability added after 2026-11-07.
