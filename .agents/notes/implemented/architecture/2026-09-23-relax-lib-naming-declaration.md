# Agent Note: Library face-naming declaration removed (2026-09-23)

Status: implemented

English | [中文](2026-09-23-relax-lib-naming-declaration.zh.md)

## Decision record

1. **User ruling**: library authors do not need to declare face naming. User's own words: 「给我改掉这个设计。库作者不需要申明这个东西」; 「这两层都很可疑：package.json faijs.naming/namingFor。一个库，几何实体和零件各种各样，怎么可能申明这种垃圾。哪个所谓的申明，明显只适合op」.
2. **Why the old design was wrong**: a library is a black-box part producer — one package declares dozens of functions that output different parts (spurGear, flange, washer…), so one library-level `faijs.naming` (or a per-function `fn.naming`) cannot carry any information. The six Provenance kinds (kernel/construct/identity/subdivide/replicate/unmodeled) are **op-level** rules ("how output faces map to input faces"); they serve the built-in op chain, not libraries. A forced declaration degenerated to `unmodeled` for every library — pure burden, no signal.
3. **Removed entirely** (2026-09-23): `fn.naming` (NamingCarrier), `registerLib({ naming })`, `LibLoaderOptions.namingFor`, `faijs.naming` (three library package.json fields), `readLibNaming` (CLI), `namingFor` + meta naming fetch (browser loader), the hard-fail branch in `admitCompatLib` (Phase 2.11-③).
4. **New behavior**: every bare library function is admitted with a fixed default `unmodeled` provenance — its faces carry no stable identity and face references degrade to geometric matching (surfaceType/normal/center/area). No declaration is read or required. The default reason carries a `default:` prefix so implicit defaults stay distinguishable from an author's explicit unmodeled accounting; nothing is written to stderr (CI stderr-zero-tolerance).
5. **Kept**: op-level naming (`DUAL_OP_META.naming` / roleTable — the only place face naming is declared), the six Provenance kinds, lineage/identity mechanics, `fn.outputs` (multi-output annotation, unrelated to naming), `faijs.autoLift` (execution semantics, unrelated to naming).
6. **Version**: 0.14.1 was not yet published; this is a pre-release design revision, version stays 0.14.1. Tarballs get re-packed.

## Code locations

- `packages/core/src/cad-runtime/admit-compat-lib.ts` — default unmodeled admission, no naming read
- `packages/core/src/cad-runtime/runtime.ts` — `registerLib` signature / namingFor call site removed
- `packages/core/src/cad-runtime/ports.ts` — `LibLoaderOptions.namingFor` removed
- `packages/core/src/cad-runtime/browser-lib-loader.ts` — `namingFor` / meta naming fetch removed (autoLift kept)
- `packages/core/src/node-host/cli.ts` — `readLibNaming` / namingFor removed
- `packages/{fai_cq_gears,fai_cq_warehouse,sheetmetal}/package.json` — `faijs.naming` removed
- `packages/core/src/index.ts` — export comment updated (Provenance export kept)
- `packages/core/src/cad-runtime/admit-compat-lib.test.ts` — re-pinned to default admission
- `docs/plans/2026-09-23-relax-lib-naming-design.md` — design (new)
- `docs/plans/2026-09-22-topology-identity-development-plan.md` §7.2 — 2.11 marked abolished

## Leftovers / follow-ups

- Re-pack 5 tarballs at 0.14.1 (core / cq-compat / fai_cq_gears / fai_cq_warehouse / sheetmetal) and re-install into 3d_editor.
- Verify 3d_editor `c4-brepjs-gear.test.ts` recovers (npm 0.13.2 gears, previously hard-failed, now admitted by default).
- `docs/api-contract.md` / `docs/library-dev-guide.md` were checked and contain no naming-declaration contract — no edit needed.
