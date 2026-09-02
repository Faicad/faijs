/**
 * compat — brepjs 同名兼容 shim（D12，批次一的桥接面）
 *
 * 设计：docs/plans/2026-09-01-layered-api-architecture.md §D12 / §7.3 / §7.5
 *
 * 移植的钣金源文件只改 import 来源行（`from 'brepjs'` → `from './compat.js'`），
 * Result 消费点零改动。本文件是包内**唯一**桥接点（§9 验收白名单：src 中
 * `kernel/`、`getBackends`、`getSlot` 零命中，compat.ts 除外）——
 * 批次一（纯 2D/数据层）需要的符号以 vendored L1/L2 的同名形态提供：
 *
 * - Result 机制与类型：vendored `core/result.js` / `core/errors.js` /
 *   `core/shapeTypes.js` / `core/validityTypes.js` / `core/types.js`；
 * - 2D/查询 op：直包 vendored L2（`primitiveFns.line/wire/wireLoop`、
 *   `topologyQueryFns.getEdges`、`curveFns.curveStartPoint/curveEndPoint`）——
 *   产出的都是 brepjs 原样句柄形态（同一 occt-wasm 实例，D10），与 3D 批次
 *   经 L3 `cad.*` 的路径不同：批次一不碰 3D 实体，无需 faijs Shape 包装。
 *
 * vec* 纯函数按 §7.5 ⑤ 不映射到 cad 命名空间；批次一各文件未消费 vec*，
 * 待 3D 批次需要时从 vendored `utils/vec3.js` 在此 re-export。
 */

import { ok, err, isOk, isErr, type Result } from '@faicad/faijs-core/vendored/brepjs/core/result.js'
import { validationError, type BrepError } from '@faicad/faijs-core/vendored/brepjs/core/errors.js'
import type { Solid, Wire, Edge, Face, AnyShape } from '@faicad/faijs-core/vendored/brepjs/core/shapeTypes.js'
import { isSolid } from '@faicad/faijs-core/vendored/brepjs/core/shapeTypes.js'
import type { ClosedWire, ValidSolid } from '@faicad/faijs-core/vendored/brepjs/core/validityTypes.js'
import type { Vec3 } from '@faicad/faijs-core/vendored/brepjs/core/types.js'
import type { Bounds3D } from '@faicad/faijs-core/vendored/brepjs/topology/topologyQueryFns.js'
import { getSolids } from '@faicad/faijs-core/vendored/brepjs/topology/topologyQueryFns.js'
import {
  line as brepjsLine,
  wire as brepjsWire,
  wireLoop as brepjsWireLoop,
} from '@faicad/faijs-core/vendored/brepjs/topology/primitiveFns.js'
import { getEdges as brepjsGetEdges } from '@faicad/faijs-core/vendored/brepjs/topology/topologyQueryFns.js'
import {
  curveStartPoint as brepjsCurveStartPoint,
  curveEndPoint as brepjsCurveEndPoint,
} from '@faicad/faijs-core/vendored/brepjs/topology/curveFns.js'

// ── Result 机制（L1 core/result + core/errors，brepjs 同名） ──
export { ok, err, isOk, isErr, validationError }
export type { Result, BrepError }

// ── 类型（L1，brepjs 同名；批次一消费的类型全集） ──
export type { Solid, Wire, Edge, Face, AnyShape, ClosedWire, ValidSolid, Vec3, Bounds3D }

// ── 2D/查询 op（直 re-export vendored L2，保留 brepjs 同名同签名） ──
export { brepjsLine as line, brepjsWire as wire, brepjsWireLoop as wireLoop }
export { brepjsGetEdges as getEdges, getSolids }
export { isSolid }
export { brepjsCurveStartPoint as curveStartPoint, brepjsCurveEndPoint as curveEndPoint }
