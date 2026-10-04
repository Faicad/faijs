# @faicad/faijs-fasteners

English | [中文](README.zh.md)

Standard fasteners and hardware for faijs: threads, nuts, screws, washers, bearings, sprockets, chains, and fastener holes.

## Origin

This package is a TypeScript port of [cq_warehouse](https://github.com/gadgetguy/cq-warehouse) (v0.8.0), the CadQuery standard-parts library by Maurice Lambert. Geometry semantics, parameter tables (ISO/DIN spec data), and class behavior follow the upstream Python source; the port was verified part-by-part against upstream-generated STEP references (see `fixtures/reference/`).

- Upstream source used for reference: `C:/git/CADQ/cq_warehouse/src`
- License: Apache-2.0 (matching upstream)

## Renaming history

Originally named `@faicad/fai-cq-warehouse` (after the upstream brand); renamed to `@faicad/faijs-fasteners` on 2026-10-02 to match the faijs product-line naming convention and to describe the actual content. The `cq_warehouse` name is retained here as the origin attribution.
