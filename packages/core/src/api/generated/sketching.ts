/**
 * generated/sketching.ts — 生成文件，勿手改。
 * 由 packages/core/scripts/gen-l3-surface.ts 依据 api/surface/arg-spec.ts 生成（E5/P14 分片）。
 * sketching 模块：1 个投影符号；另有 51 个 skip 登记。
 */
import { defineOp } from '../../define-op'
import { makeBaseBoxBrep as __own_makeBaseBoxBrep } from '../brep-mirror/primitiveFns'

/**
 * makeBaseBox — core 自有实现（生成文件，禁手改；来源 api/surface/arg-spec.ts）。
 * (xLength: number, yLength: number, zLength: number) -> Shape3D
 * 桥接：defineOp({ brep: __own_makeBaseBoxBrep })——core 直连 occt 引擎（§5.4 selfhost），
 * D11 归一在自有实现内部完成（api/brep-mirror/）。
 */
export const makeBaseBox = defineOp({
  brep: __own_makeBaseBoxBrep,
  name: 'makeBaseBox', naming: {"kind":"unmodeled","reason":"construct vocabulary pending Phase 3"}, engines: ["occt"],
})
