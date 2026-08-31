# Agent Note: mesh engine is formal data, not a preview

Status: implemented

English | [中文](2026-08-30-mesh-engine-position.zh.md)

## Problem

In the reference project brepjs, occt and manifold both implement the same kernel interface, and manifold's mesh output is used only for preview while the exact geometry is produced by an OCCT replay on export. faijs also carries a BREP/mesh dual chain, so it is tempting to copy that framing — mesh as a preview approximation of the "real" brep result. That framing is wrong for this repo: it reduces the mesh chain to a placeholder and would push every UI preview onto a full mesh pipeline.

## Decision

faijs explicitly distinguishes the mesh engine from the brep engine, and the mesh chain is formal (production) data — not a preview and not an approximation placeholder. Some models only exist as mesh: SDF shapes (packages/core/src/sdf) are evaluated by manifold and can only ever be represented in mesh form, so the mesh chain must be first-class. A chain switch is static, not a fallback: when a brep-supported op cannot run on the brep chain, the chain's later part is processed on mesh and the earlier part keeps brep results (see AGENTS.md "BREP/mesh 路径判定红线").

Preview is a UI-layer concern, not a faijs one. faijs exposes mesh operations and their formal data only; whether the host (such as 3d_editor) previews by actually executing the real operation — suitable for cheap/quick features — or by an overlay / ghost for expensive or non-routine ones, is decided in the host per situation and is out of faijs's scope. AGENTS.md "引擎定位（与 brepjs 不同）" establishes that mesh data is formal; it does not prescribe any preview technique.

## Alternatives considered

- **Copy brepjs: mesh = manifold preview only, exact result via OCCT replay on export.** Rejected: it makes the mesh chain a throwaway representation and contradicts models that exist only as mesh (SDF), and it would couple every preview to a full geometric rebuild.
- **Have faijs or the architecture prescribe a preview technique ("must run the op" or "must use an overlay").** Rejected: either direction over-constrains a choice that belongs to the UI layer per situation; faijs does not define preview.
- **Treat mesh as an approximation fallback when brep is unavailable.** Rejected: chain switching in this repo is a static decision (see the red-line rule), and mesh results are official data, not a degraded fallback.

## Consequences

- Mesh is the default, formal data path: mesh op results (e.g. the v1 chamfer plane-cut) are production geometry, usable by later ops and export; they are not preview artifacts.
- BREP remains the optional precise chain for when exact surfaces / STEP export are wanted.
- Preview policy is decided by the host UI per situation — cheap features may execute the real op, expensive ones may use a ghost/overlay; faijs is not involved and does not depend on it.